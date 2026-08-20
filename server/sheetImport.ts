type CsvRow = string[];

const SOURCE_SHEETS = [
  { label: "Lender Data Update", id: "1YAHBvkhX83RYZiuEjo4C6l55kdOo6DjkWWlsDzvyNno", gid: "0" },
  { label: "LENDER LIST - FINAL", id: "1Tx0uHOEZqzgB8yufiemO3A6xRzAo0op0WocbQfiIY2A", gid: "1794590520" },
] as const;

export type ImportedLender = {
  name: string;
  normalizedName: string;
  mainWebsiteUrl: string | null;
  productPageUrl: string | null;
  sourceWorkbook: string;
  sourceRow: number;
};

export function normalizeLenderName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(mortgages?|building society|bank|limited|ltd|plc|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCsv(input: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      if (row.some(cell => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(cell => cell.length > 0)) rows.push(row);
  return rows;
}

function validWebsite(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function downloadSheet(id: string, gid: string): Promise<CsvRow[]> {
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`);
  if (!response.ok) throw new Error(`Google Sheet download failed with status ${response.status}.`);
  return parseCsv((await response.text()).replace(/^\uFEFF/, ""));
}

export async function importConfiguredLenders(): Promise<ImportedLender[]> {
  const sourceRows = await Promise.all(SOURCE_SHEETS.map(source => downloadSheet(source.id, source.gid)));
  const primary = sourceRows[0] ?? [];
  const fallback = sourceRows[1] ?? [];

  // The primary tracker supplies lender names, while the second workbook supplies
  // the fixed URL mapping: column G (index 6) = main website, J (index 9) = products.
  const fallbackByName = new Map<string, ImportedLender>();
  fallback.slice(1).forEach((row, offset) => {
    const name = (row[0] ?? "").trim();
    if (!name) return;
    const normalizedName = normalizeLenderName(name);
    const mainWebsiteUrl = validWebsite(row[6]);
    const productPageUrl = validWebsite(row[9]);
    if (!mainWebsiteUrl && !productPageUrl) return;
    fallbackByName.set(normalizedName, {
      name,
      normalizedName,
      mainWebsiteUrl,
      productPageUrl,
      sourceWorkbook: SOURCE_SHEETS[1].label,
      sourceRow: offset + 2,
    });
  });

  const imported = new Map<string, ImportedLender>();
  primary.slice(1).forEach((row, offset) => {
    const name = (row[1] ?? "").trim();
    if (!name) return;
    const normalizedName = normalizeLenderName(name);
    const fallbackMatch = fallbackByName.get(normalizedName);
    imported.set(normalizedName, {
      name,
      normalizedName,
      mainWebsiteUrl: validWebsite(row[6]) ?? fallbackMatch?.mainWebsiteUrl ?? null,
      productPageUrl: validWebsite(row[9]) ?? fallbackMatch?.productPageUrl ?? null,
      sourceWorkbook: fallbackMatch ? `${SOURCE_SHEETS[0].label} + ${SOURCE_SHEETS[1].label}` : SOURCE_SHEETS[0].label,
      sourceRow: offset + 2,
    });
  });

  fallbackByName.forEach((lender, normalizedName) => {
    if (!imported.has(normalizedName)) imported.set(normalizedName, lender);
  });
  return Array.from(imported.values()).filter(lender => lender.mainWebsiteUrl || lender.productPageUrl);
}
