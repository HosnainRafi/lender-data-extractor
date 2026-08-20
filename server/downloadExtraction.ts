import ExcelJS from "exceljs";
import type { MortgageProductData } from "../shared/lenderTypes";
import { parseCsv } from "./sheetImport";
import { BROWSER_USER_AGENT } from "./browserScraper";

export type ParsedProduct = MortgageProductData & { confidence: number };

export type DownloadParseResult = {
  products: ParsedProduct[];
  notes: string[];
  format: "json" | "csv" | "xlsx" | "pdf" | "unknown";
};

const DOWNLOAD_NOTE = "Parsed from a direct product-data download; verify against the source file before export.";

type Row = Record<string, unknown>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function textCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in (value as Record<string, unknown>)) {
    return String((value as { text: unknown }).text ?? "").trim();
  }
  return String(value).trim();
}

function norm(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function numberFrom(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/[£$€,\s]/g, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parses a percentage that may appear as "5.23%", "5.23", 5.23, or 0.0523. */
function percentFrom(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const hasPercent = raw.includes("%");
  const num = numberFrom(raw.replace(/%/g, ""));
  if (num === null) return null;
  if (hasPercent) return num / 100;
  return num > 1 ? num / 100 : num;
}

type ProductField = keyof MortgageProductData;

const FIELD_PATTERNS: Array<{ field: ProductField; pattern: RegExp }> = [
  { field: "code", pattern: /^product\s*code$|^productcode$|^code$|^reference$|^ref$|^proposition\s*code$/ },
  { field: "product", pattern: /^product$|^product\s*name$|^scheme$|^name$|^title$|^product\s*description$/ },
  { field: "purpose", pattern: /^purpose$|^loan\s*purpose$/ },
  { field: "maxLtv", pattern: /^ltv$|^max\s*ltv$|^max(?:imum)?\s*ltv$|^loan\s*to\s*value$|^max(?:imum)?\s*loan\s*to\s*value$/ },
  { field: "rate", pattern: /^rate$|^initial\s*rate$|^initial\s*interest\s*rate$|^interest\s*rate$|^interest\s*rate\s*1$|^rate\s*1$|^pay\s*rate$|^current\s*rate$/ },
  { field: "aprc", pattern: /^aprc$|^overall\s*cost\s*for\s*comparison$|^comparison\s*rate$/ },
  { field: "productFee", pattern: /^fee$|^product\s*fee$|^completion\s*fee$|^arrangement\s*fee$/ },
  { field: "incentives", pattern: /^incentive$|^incentives$/ },
  { field: "cashback", pattern: /^cashback$|^cash\s*back$/ },
  { field: "ercs", pattern: /^erc$|^ercs$|^erc\s*ranks?$|^early\s*repayment|^redemption\s*(charge|penalt)/ },
  { field: "endDate", pattern: /^end\s*date$|^until$|^initial\s*period\s*end$|^revert\s*date$|^rate\s*1\s*end\s*date$|^interest\s*rate\s*end\s*date$/ },
  { field: "segment", pattern: /^segment$/ },
  { field: "term", pattern: /^term$|^initial\s*period$|^product\s*term$/ },
  { field: "basis", pattern: /^basis$|^rate\s*type$|^rate\s*1\s*type$|^interest\s*rate\s*type$/ },
];

function matchField(key: string): ProductField | null {
  const normalized = norm(key).replace(/[^a-z0-9 ]+/g, " ");
  for (const { field, pattern } of FIELD_PATTERNS) {
    if (pattern.test(normalized)) return field;
  }
  return null;
}

function enrichFromName(data: MortgageProductData): MortgageProductData {
  const nameText = (data.product ?? "").toLowerCase();
  if (data.term === null || data.term === undefined) {
    const match = nameText.match(/\b(\d{1,2})\s*(?:year|yr)\b/);
    if (match) data.term = Number(match[1]);
  }
  if (!data.basis) {
    if (/\btracker\b/.test(nameText)) data.basis = "Tracker";
    else if (/\bdiscount\b/.test(nameText)) data.basis = "Discount";
    else if (/\bfixed\b/.test(nameText)) data.basis = "Fixed";
  }
  if (!data.purpose && /\b(?:buy\s*to\s*let|btl)\b/.test(nameText)) data.purpose = "Buy to Let";
  return data;
}

function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => String(item ?? "").trim()).filter(Boolean).join("; ");
  return String(value ?? "").trim();
}

function normalizeBasis(value: string): string {
  const text = value.toLowerCase();
  if (/\btracker\b/.test(text)) return "Tracker";
  if (/\bdiscount\b/.test(text)) return "Discount";
  if (/\bfixed\b/.test(text)) return "Fixed";
  if (/\bsvr\b/.test(text)) return "SVR";
  if (/\bvariable\b/.test(text)) return "Variable";
  return value.trim();
}

function synthesizeProductName(mapped: Partial<MortgageProductData>): string | null {
  const parts: string[] = [];
  if (mapped.term !== null && mapped.term !== undefined) parts.push(`${mapped.term} Year`);
  if (mapped.basis) parts.push(mapped.basis);
  if (!parts.length) return null;
  return `${parts.join(" ")} Rate`;
}

function rowToProduct(row: Row): ParsedProduct | null {
  const mapped: Partial<MortgageProductData> = { blank: null };
  const evidence: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    const field = matchField(key);
    if (!field) continue;
    const text = valueText(value);
    if (!text) continue;
    evidence.push(`${key}: ${text}`);
    switch (field) {
      case "code": mapped.code = text; break;
      case "product": mapped.product = text; break;
      case "purpose": mapped.purpose = text; break;
      case "maxLtv": mapped.maxLtv = percentFrom(value); break;
      case "rate": mapped.rate = percentFrom(value); break;
      case "aprc": mapped.aprc = percentFrom(value); break;
      case "productFee": mapped.productFee = numberFrom(value); break;
      case "incentives": mapped.incentives = text; break;
      case "cashback": mapped.cashback = numberFrom(value); break;
      case "ercs": mapped.ercs = text; break;
      case "endDate": mapped.endDate = text; break;
      case "segment": mapped.segment = text; break;
      case "term": mapped.term = numberFrom(value); break;
      case "basis": mapped.basis = normalizeBasis(text); break;
    }
  }
  const code = mapped.code?.trim() || null;
  const product = mapped.product?.trim() || synthesizeProductName(mapped) || null;
  if (!product && !code) return null;
  const data = enrichFromName({
    code,
    product: product ?? code ?? "Product",
    purpose: mapped.purpose ?? null,
    maxLtv: mapped.maxLtv ?? null,
    rate: mapped.rate ?? null,
    aprc: mapped.aprc ?? null,
    productFee: mapped.productFee ?? null,
    incentives: mapped.incentives ?? null,
    cashback: mapped.cashback ?? null,
    ercs: mapped.ercs ?? null,
    endDate: mapped.endDate ?? null,
    segment: mapped.segment ?? null,
    term: mapped.term ?? null,
    basis: mapped.basis ?? null,
    blank: null,
    sourceEvidence: evidence.slice(0, 14),
    extractionNotes: DOWNLOAD_NOTE,
  });
  const confidence = data.rate !== null ? 0.9 : 0.6;
  return { ...data, confidence };
}

function collectArrays(value: unknown, depth: number, out: Row[][]): void {
  if (depth > 5) return;
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isObject)) {
      out.push(value as Row[]);
    } else {
      value.forEach(item => collectArrays(item, depth + 1, out));
    }
    return;
  }
  if (isObject(value)) {
    for (const child of Object.values(value)) collectArrays(child, depth + 1, out);
  }
}

function productsFromJson(data: unknown): ParsedProduct[] {
  const arrays: Row[][] = [];
  collectArrays(data, 0, arrays);
  let best: ParsedProduct[] = [];
  let bestScore = 0;
  for (const array of arrays) {
    const products = array.map(rowToProduct).filter((item): item is ParsedProduct => item !== null);
    if (products.length === 0) continue;
    const withRate = products.filter(item => item.rate !== null).length;
    // Prefer the array that yields the most priced products; otherwise the largest named set.
    const score = withRate > 0 ? withRate * 1000 + products.length : products.length;
    if (score > bestScore) {
      bestScore = score;
      best = products;
    }
  }
  return best;
}

function productsFromTabular(rows: string[][]): ParsedProduct[] {
  if (rows.length < 2) return [];
  const header = rows[0].map(value => String(value ?? "").trim());
  const fieldColumns = header.map((text, index) => ({ text, index, field: matchField(text) }));
  if (fieldColumns.every(column => column.field === null)) return [];
  const products: ParsedProduct[] = [];
  for (const row of rows.slice(1)) {
    const record: Row = {};
    for (const column of fieldColumns) {
      if (column.field) record[column.text || `column_${column.index}`] = row[column.index];
    }
    const product = rowToProduct(record);
    if (product) products.push(product);
  }
  return products;
}

function detectFormat(url: string, contentType: string | null): "json" | "csv" | "xlsx" | "pdf" | "unknown" {
  const ct = (contentType ?? "").toLowerCase();
  const path = url.toLowerCase().split("?")[0].split("#")[0];
  if (ct.includes("json") || path.endsWith(".json")) return "json";
  if (ct.includes("pdf") || path.endsWith(".pdf")) return "pdf";
  if (ct.includes("spreadsheetml") || ct.includes("excel") || path.endsWith(".xlsx") || path.endsWith(".xls")) return "xlsx";
  if (ct.includes("csv") || path.endsWith(".csv")) return "csv";
  return "unknown";
}

async function parsePdf(buffer: Buffer): Promise<string> {
  let pdfParse: ((data: Buffer) => Promise<{ text: string }>) | undefined;
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const module = require("pdf-parse");
    pdfParse = (module?.default ?? module) as (data: Buffer) => Promise<{ text: string }>;
  } catch {
    return "";
  }
  if (!pdfParse) return "";
  try {
    const result = await pdfParse(buffer);
    return result.text ?? "";
  } catch {
    return "";
  }
}

export async function extractFromDownload(url: string): Promise<DownloadParseResult> {
  const response = await fetch(url, {
    headers: { "user-agent": BROWSER_USER_AGENT, accept: "*/*" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Download failed with status ${response.status}.`);
  const contentType = response.headers.get("content-type");
  const buffer = Buffer.from(await response.arrayBuffer());
  let format = detectFormat(url, contentType);

  // Sniff when the extension/content-type is ambiguous.
  if (format === "unknown") {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
    if (text.startsWith("[") || text.startsWith("{")) {
      format = "json";
    } else if (text.includes(",") || text.includes("\n")) {
      format = "csv";
    } else {
      return { products: [], notes: ["The download could not be recognized as JSON, CSV, XLSX, or PDF."], format: "unknown" };
    }
  }

  if (format === "json") {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
    if (!text) return { products: [], notes: ["The product-data download was empty."], format };
    try {
      const data = JSON.parse(text);
      const products = productsFromJson(data);
      return { products, notes: products.length ? [] : ["No recognizable product records were found in the JSON download."], format };
    } catch {
      return { products: [], notes: ["The JSON download could not be parsed."], format };
    }
  }

  if (format === "csv") {
    const rows = parseCsv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
    const products = productsFromTabular(rows);
    return { products, notes: products.length ? [] : ["No recognizable product rows were found in the CSV download."], format };
  }

  if (format === "xlsx") {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as never);
      const sheet = workbook.worksheets.find(candidate => candidate.actualRowCount > 0);
      if (!sheet) return { products: [], notes: ["The workbook does not contain a readable worksheet."], format };
      const rows: string[][] = [];
      sheet.eachRow({ includeEmpty: false }, row => {
        const values: string[] = [];
        for (let column = 1; column <= row.cellCount; column += 1) {
          values.push(textCell(row.getCell(column).value));
        }
        if (values.some(value => value.length > 0)) rows.push(values);
      });
      const products = productsFromTabular(rows);
      return { products, notes: products.length ? [] : ["No recognizable product rows were found in the workbook download."], format };
    } catch {
      return { products: [], notes: ["The XLSX download could not be parsed."], format };
    }
  }

  if (format === "pdf") {
    const text = await parsePdf(buffer);
    if (!text.trim()) return { products: [], notes: ["The PDF download could not be read as text (a PDF text extractor is required)."], format };
    return { products: [], notes: [text], format };
  }

  return { products: [], notes: ["The download format is not supported."], format };
}

/** Downloads and parses every direct download link, returning combined products plus notes. */
export async function extractFromDownloadLinks(links: Array<string | null | undefined>): Promise<DownloadParseResult> {
  const unique = Array.from(new Set(links.filter((link): link is string => Boolean(link))));
  const products: ParsedProduct[] = [];
  const notes: string[] = [];
  const formats = new Set<DownloadParseResult["format"]>();
  for (const link of unique) {
    try {
      const result = await extractFromDownload(link);
      formats.add(result.format);
      for (const product of result.products) {
        const key = `${product.code ?? ""}|${product.product}|${product.rate ?? ""}`.toLowerCase();
        if (!products.some(existing => `${existing.code ?? ""}|${existing.product}|${existing.rate ?? ""}`.toLowerCase() === key)) {
          products.push(product);
        }
      }
      if (result.notes.length) notes.push(...result.notes);
    } catch (error) {
      notes.push(`Download link ${link} failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return { products, notes, format: formats.size ? Array.from(formats).join("+") as DownloadParseResult["format"] : "unknown" };
}
