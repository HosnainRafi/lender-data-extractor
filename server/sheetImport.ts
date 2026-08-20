import ExcelJS from "exceljs";
import type { LenderSourceLinks } from "../shared/lenderTypes";

type CsvRow = string[];

const SOURCE_SHEETS = [
  { label: "Lender Data Update", id: "1YAHBvkhX83RYZiuEjo4C6l55kdOo6DjkWWlsDzvyNno", gid: "0" },
  { label: "LENDER LIST - FINAL", id: "1Tx0uHOEZqzgB8yufiemO3A6xRzAo0op0WocbQfiIY2A", gid: "1794590520" },
] as const;

export type ImportedLender = LenderSourceLinks & {
  name: string;
  normalizedName: string;
  sourceWorkbook: string;
  sourceRow: number;
};

export type FlexibleImportInput = {
  sourceLabel?: string;
  sourceUrl?: string;
  fileName?: string;
  fileBase64?: string;
};

const LENDER_STOPWORDS =
  /\b(mortgages?|mortgaes?|building\s+societ(?:y|ies)|societ(?:y|ies)|bank|banking|limited|ltd|plc|the|group|uk|co|finance|lending|intermediar(?:y|ies)|for|of|product|products|list|bs)\b/g;

export function normalizeLenderName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LENDER_STOPWORDS, " ")
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

function textCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in (value as Record<string, unknown>)) return String((value as { text: unknown }).text ?? "").trim();
  return String(value).trim();
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

function safePublicDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Provide a public HTTP(S) spreadsheet link.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    throw new Error("Spreadsheet links must point to a public host.");
  }
  return url;
}

function googleCsvExportUrl(value: URL): URL {
  const match = value.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match || value.hostname !== "docs.google.com") return value;
  const gid = value.searchParams.get("gid") ?? "0";
  return new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`);
}

async function downloadSheet(id: string, gid: string): Promise<CsvRow[]> {
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`);
  if (!response.ok) throw new Error(`Google Sheet download failed with status ${response.status}.`);
  return parseCsv((await response.text()).replace(/^\uFEFF/, ""));
}

async function workbookRows(buffer: Buffer): Promise<CsvRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets.find(candidate => candidate.actualRowCount > 0);
  if (!sheet) throw new Error("The workbook does not contain a readable worksheet.");
  const rows: CsvRow[] = [];
  sheet.eachRow({ includeEmpty: false }, row => {
    const values: string[] = [];
    for (let column = 1; column <= row.cellCount; column += 1) values.push(textCell(row.getCell(column).value));
    if (values.some(value => value.length > 0)) rows.push(values);
  });
  return rows;
}

function headerIndex(header: CsvRow, candidates: RegExp[]): number | null {
  const index = header.findIndex(value => candidates.some(candidate => candidate.test(value.trim().toLowerCase())));
  return index === -1 ? null : index;
}

function inferredRowLender(row: CsvRow, sourceWorkbook: string, sourceRow: number, columns: { name: number | null; mainWebsite: number | null; productPage: number | null }): ImportedLender | null {
  const urls = row.map(validWebsite);
  const mainWebsiteUrl = columns.mainWebsite === null ? urls.find(Boolean) ?? null : urls[columns.mainWebsite] ?? null;
  const productPageUrl = columns.productPage === null ? urls.filter(Boolean).find(value => value !== mainWebsiteUrl) ?? null : urls[columns.productPage] ?? null;
  const namedValue = columns.name === null ? row.find(value => value && !validWebsite(value)) ?? "" : row[columns.name] ?? "";
  const name = namedValue.trim();
  const normalizedName = normalizeLenderName(name);
  if (!normalizedName || (!mainWebsiteUrl && !productPageUrl)) return null;
  return { name, normalizedName, mainWebsiteUrl, productPageUrl, resiProductsUrl: null, btlProductsUrl: null, downloadMethod: null, resiDownloadUrl: null, btlDownloadUrl: null, sourceWorkbook, sourceRow };
}

export function inferFlexibleLenders(rows: CsvRow[], sourceWorkbook: string): ImportedLender[] {
  if (rows.length === 0) return [];
  const header = rows[0].map(value => value.trim().toLowerCase());
  const columns = {
    name: headerIndex(header, [/^lender$/, /lender.*name/, /^provider$/, /provider.*name/, /^bank$/, /building.*society/, /^company$/]),
    mainWebsite: headerIndex(header, [/^(main )?(website|site|url)$/, /lender.*(website|url)/, /homepage/]),
    productPage: headerIndex(header, [/product.*(page|url|link)/, /mortgage.*(page|url|link)/, /rate.*(page|url|link)/, /product.*website/]),
  };
  const headerLooksMapped = columns.name !== null || columns.mainWebsite !== null || columns.productPage !== null;
  const firstDataRow = headerLooksMapped ? 1 : 0;
  const imported = new Map<string, ImportedLender>();
  rows.slice(firstDataRow).forEach((row, index) => {
    const lender = inferredRowLender(row, sourceWorkbook, index + firstDataRow + 1, columns);
    if (lender) imported.set(lender.normalizedName, lender);
  });
  return Array.from(imported.values());
}

export async function importFlexibleLenders(input: FlexibleImportInput): Promise<ImportedLender[]> {
  if (!input.fileBase64 && !input.sourceUrl) throw new Error("Choose a CSV/XLSX file or provide a public spreadsheet link.");
  let bytes: Buffer;
  let sourceName = input.sourceLabel?.trim() || input.fileName?.trim() || "Flexible lender source";
  let isWorkbook = /\.xlsx(?:$|[?#])/i.test(input.fileName ?? "");
  if (input.fileBase64) {
    bytes = Buffer.from(input.fileBase64.replace(/^data:[^,]+,/, ""), "base64");
    if (bytes.byteLength > 15 * 1024 * 1024) throw new Error("Spreadsheet files must be 15 MB or smaller.");
  } else {
    const rawUrl = safePublicDownloadUrl(input.sourceUrl!);
    const downloadUrl = googleCsvExportUrl(rawUrl);
    const response = await fetch(downloadUrl, { redirect: "follow" });
    if (!response.ok) throw new Error(`Spreadsheet download failed with status ${response.status}. Make sure the link is public.`);
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > 15 * 1024 * 1024) throw new Error("Spreadsheet files must be 15 MB or smaller.");
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 15 * 1024 * 1024) throw new Error("Spreadsheet files must be 15 MB or smaller.");
    sourceName = input.sourceLabel?.trim() || rawUrl.hostname;
    isWorkbook = /\.xlsx(?:$|[?#])/i.test(downloadUrl.pathname) || response.headers.get("content-type")?.includes("spreadsheetml") === true;
  }
  const rows = isWorkbook ? await workbookRows(bytes) : parseCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  const lenders = inferFlexibleLenders(rows, sourceName);
  if (lenders.length === 0) throw new Error("No lender rows with a name and public website or product URL were found. Use a header such as Lender Name, Website URL, and Product Page URL.");
  return lenders;
}

/**
 * Column layout for the authoritative `LENDER LIST - FINAL` sheet:
 *   0 name | 6 main website | 9 products | 13 resi products | 17 BTL products
 *   22 download method | 23 resi download link | 25 BTL download link
 */
export async function importConfiguredLenders(): Promise<ImportedLender[]> {
  const sourceRows = await Promise.all(SOURCE_SHEETS.map(source => downloadSheet(source.id, source.gid)));
  const statusRows = sourceRows[0] ?? []; // status tracker (may carry fresh product URLs in its NEW section)
  const finalRows = sourceRows[1] ?? []; // authoritative lender list with all URLs + download links

  const imported = new Map<string, ImportedLender>();

  // 1) Authoritative list first: every lender row with any usable URL or download link.
  finalRows.slice(1).forEach((row, offset) => {
    const name = (row[0] ?? "").trim();
    if (!name) return;
    const lender: ImportedLender = {
      name,
      normalizedName: normalizeLenderName(name),
      mainWebsiteUrl: validWebsite(row[6]),
      productPageUrl: validWebsite(row[9]),
      resiProductsUrl: validWebsite(row[13]),
      btlProductsUrl: validWebsite(row[17]),
      downloadMethod: (row[22] ?? "").trim() || null,
      resiDownloadUrl: validWebsite(row[23]),
      btlDownloadUrl: validWebsite(row[25]),
      sourceWorkbook: SOURCE_SHEETS[1].label,
      sourceRow: offset + 2,
    };
    if (!lender.mainWebsiteUrl && !lender.productPageUrl && !lender.resiProductsUrl && !lender.btlProductsUrl && !lender.resiDownloadUrl && !lender.btlDownloadUrl) return;
    imported.set(lender.normalizedName, lender);
  });

  // 2) Status-sheet overlay: rows in the tracker that carry their own URL (the NEW section)
  //    provide the freshest, human-verified product page and take precedence.
  statusRows.slice(1).forEach((row, offset) => {
    const name = (row[1] ?? "").trim();
    if (!name) return;
    const urlsInRow = row.map(validWebsite);
    const rowUrl = urlsInRow.find(Boolean) ?? null;
    if (!rowUrl) return; // no URL in this tracker row; the final sheet already covers it
    const normalizedName = normalizeLenderName(name);
    const existing = imported.get(normalizedName);
    if (existing) {
      existing.productPageUrl = rowUrl;
      existing.sourceWorkbook = `${SOURCE_SHEETS[0].label} + ${SOURCE_SHEETS[1].label}`;
      return;
    }
    imported.set(normalizedName, {
      name,
      normalizedName,
      mainWebsiteUrl: null,
      productPageUrl: rowUrl,
      resiProductsUrl: null,
      btlProductsUrl: null,
      downloadMethod: null,
      resiDownloadUrl: null,
      btlDownloadUrl: null,
      sourceWorkbook: SOURCE_SHEETS[0].label,
      sourceRow: offset + 2,
    });
  });

  return Array.from(imported.values()).filter(lender => lender.mainWebsiteUrl || lender.productPageUrl || lender.resiProductsUrl || lender.btlProductsUrl || lender.resiDownloadUrl || lender.btlDownloadUrl);
}
