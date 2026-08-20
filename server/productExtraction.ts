import crypto from "crypto";
import { invokeLLM } from "./_core/llm";
import type { ExtractedProductsResponse, MortgageProductData } from "../shared/lenderTypes";

const productSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: ["string", "null"] }, product: { type: "string" }, purpose: { type: ["string", "null"] },
          maxLtv: { type: ["number", "null"] }, rate: { type: ["number", "null"] }, aprc: { type: ["number", "null"] },
          productFee: { type: ["number", "null"] }, incentives: { type: ["string", "null"] }, cashback: { type: ["number", "null"] },
          ercs: { type: ["string", "null"] }, endDate: { type: ["string", "null"] }, segment: { type: ["string", "null"] },
          term: { type: ["number", "null"] }, basis: { type: ["string", "null"] }, blank: { type: ["number", "null"] },
          sourceEvidence: { type: "array", items: { type: "string" } }, extractionNotes: { type: ["string", "null"] }, confidence: { type: "number" },
        },
        required: ["code", "product", "purpose", "maxLtv", "rate", "aprc", "productFee", "incentives", "cashback", "ercs", "endDate", "segment", "term", "basis", "blank", "sourceEvidence", "extractionNotes", "confidence"],
      },
    },
    additionalNotes: { type: "array", items: { type: "string" } },
    pageClassification: { type: "string", enum: ["product_page", "document", "blocked", "no_product_data"] },
  },
  required: ["products", "additionalNotes", "pageClassification"],
} as const;

const LOCAL_EXTRACTION_NOTE = "Local rule-based extraction; verify against the captured lender page before export.";

function asFraction(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value.replace(",", ""));
  return Number.isFinite(numeric) ? numeric / 100 : null;
}

function nearbyProductName(lines: string[], index: number): string {
  const line = lines[index] ?? "";
  const withoutRate = line.replace(/\b\d{1,2}(?:\.\d{1,3})?\s*%/g, "").replace(/\b\d{1,3}(?:\.\d+)?\s*%?\s*ltv\b/gi, "").replace(/\s{2,}/g, " ").trim();
  if (withoutRate.length >= 5 && withoutRate.length <= 120) return withoutRate;
  return lines.slice(Math.max(0, index - 2), index).reverse().find(candidate => candidate.length >= 5 && candidate.length <= 120) ?? "Mortgage product";
}

type LabeledField = "rate" | "maxLtv" | "aprc" | "code" | "details";

function labeledFieldFor(line: string): LabeledField | null {
  const normalized = line.replace(/[:\s]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (/^(?:initial )?(?:interest )?rate$/.test(normalized) || /^(?:initial|introductory) rate$/.test(normalized)) return "rate";
  if (/^(?:maximum )?loan to value(?: \(ltv\))?$/.test(normalized) || /^max(?:imum)? ltv$/.test(normalized)) return "maxLtv";
  if (/^(?:overall cost for comparison|aprc)$/.test(normalized)) return "aprc";
  if (/^(?:product )?(?:code|reference|id)$/.test(normalized)) return "code";
  if (/^(?:view|see) details$/.test(normalized)) return "details";
  return null;
}

function percentageFromValue(value: string | undefined): number | null {
  return asFraction(value?.match(/\b(\d{1,3}(?:\.\d{1,3})?)\s*%/)?.[1]);
}

function titleBeforeLabel(lines: string[], labelIndex: number): string | null {
  const title = lines[labelIndex - 1]?.trim();
  if (!title || labeledFieldFor(title) || /^\d{1,3}(?:\.\d{1,3})?\s*%$/.test(title)) return null;
  return title.length >= 3 && title.length <= 220 ? title : null;
}

function labeledBlockProducts(lines: string[]): Array<MortgageProductData & { confidence: number }> {
  const products: Array<MortgageProductData & { confidence: number }> = [];

  for (let rateLabelIndex = 0; rateLabelIndex < lines.length; rateLabelIndex += 1) {
    if (labeledFieldFor(lines[rateLabelIndex]) !== "rate") continue;

    const product = titleBeforeLabel(lines, rateLabelIndex);
    if (!product) continue;

    let endIndex = lines.length;
    let endField: LabeledField | null = null;
    for (let cursor = rateLabelIndex + 1; cursor < lines.length; cursor += 1) {
      const field = labeledFieldFor(lines[cursor]);
      if (field === "details" || field === "rate") {
        endIndex = cursor;
        endField = field;
        break;
      }
    }

    const values: Partial<Record<Exclude<LabeledField, "details">, string>> = {};
    for (let cursor = rateLabelIndex; cursor < endIndex; cursor += 1) {
      const field = labeledFieldFor(lines[cursor]);
      if (!field || field === "details") continue;
      const value = lines[cursor + 1];
      if (!value || labeledFieldFor(value)) continue;
      values[field] = value;
    }

    const rate = percentageFromValue(values.rate);
    if (rate === null) continue;

    const term = product.match(/\b(\d{1,2})\s*(?:year|yr)\b/i);
    const evidence: string[] = [product, `Initial Interest Rate: ${values.rate}`];
    if (values.maxLtv) evidence.push(`Maximum Loan To Value (LTV): ${values.maxLtv}`);
    if (values.aprc) evidence.push(`Overall Cost for Comparison: ${values.aprc}`);
    if (values.code) evidence.push(`Product Code: ${values.code}`);

    products.push({
      code: values.code?.trim() || null,
      product,
      purpose: /\b(?:buy\s*to\s*let|btl)\b/i.test(product) ? "Buy to Let" : null,
      maxLtv: percentageFromValue(values.maxLtv),
      rate,
      aprc: percentageFromValue(values.aprc),
      productFee: null,
      incentives: null,
      cashback: null,
      ercs: null,
      endDate: null,
      segment: null,
      term: term ? Number(term[1]) : null,
      basis: /\btracker\b/i.test(product) ? "Tracker" : /\bdiscount\b/i.test(product) ? "Discount" : /\bfixed\b/i.test(product) ? "Fixed" : null,
      blank: null,
      sourceEvidence: evidence,
      extractionNotes: LOCAL_EXTRACTION_NOTE,
      confidence: 0.75,
    });

    if (endField === "details") rateLabelIndex = Math.max(rateLabelIndex, endIndex - 1);
  }

  return products;
}

function compactProductCardProducts(lines: string[]): Array<MortgageProductData & { confidence: number }> {
  const products: Array<MortgageProductData & { confidence: number }> = [];
  const seen = new Set<string>();
  const isProductCode = (line: string | undefined) => /^(?=.*\d)[A-Z][A-Z0-9-]{3,}$/i.test(line?.trim() ?? "");

  for (let rateLabelIndex = 0; rateLabelIndex < lines.length; rateLabelIndex += 1) {
    if (lines[rateLabelIndex].trim().toLowerCase() !== "initial rate") continue;

    const codeIndex = Array.from({ length: Math.min(rateLabelIndex, 8) }, (_, offset) => rateLabelIndex - offset - 1)
      .find(index => isProductCode(lines[index]));
    if (codeIndex === undefined) continue;

    const code = lines[codeIndex].trim();
    const product = lines[codeIndex + 1]?.trim();
    if (!product || labeledFieldFor(product) || /^(?:until|initial rate|svr|aprc|ltv|product fee|incentives)$/i.test(product)) continue;

    let endIndex = lines.length;
    for (let cursor = rateLabelIndex + 1; cursor < lines.length; cursor += 1) {
      if (/^full product details$/i.test(lines[cursor]) || isProductCode(lines[cursor])) {
        endIndex = cursor;
        break;
      }
    }

    const valueAfter = (label: string) => {
      const labelIndex = lines.slice(codeIndex, endIndex).findIndex(line => line.trim().toLowerCase() === label);
      return labelIndex === -1 ? undefined : lines[codeIndex + labelIndex + 1];
    };
    const rateValue = valueAfter("initial rate");
    const rate = percentageFromValue(rateValue);
    if (rate === null) continue;

    const key = `${code}|${product}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const ltvValue = valueAfter("ltv");
    const aprcValue = valueAfter("aprc");
    const feeValue = valueAfter("product fee");
    const until = lines.slice(codeIndex, rateLabelIndex).find(line => /^until\s+/i.test(line));
    const term = product.match(/\b(\d{1,2})\s*(?:year|yr)\b/i);
    const evidence = [code, product, `Initial rate: ${rateValue}`];
    if (aprcValue) evidence.push(`APRC: ${aprcValue}`);
    if (ltvValue) evidence.push(`LTV: ${ltvValue}`);
    if (feeValue) evidence.push(`Product fee: ${feeValue}`);
    if (until) evidence.push(until);

    products.push({
      code,
      product,
      purpose: /\b(?:buy\s*to\s*let|btl)\b/i.test(product) ? "Buy to Let" : null,
      maxLtv: percentageFromValue(ltvValue),
      rate,
      aprc: percentageFromValue(aprcValue),
      productFee: feeValue ? Number(feeValue.replace(/[^0-9.]/g, "")) || null : null,
      incentives: null,
      cashback: null,
      ercs: null,
      endDate: until?.replace(/^until\s+/i, "") ?? null,
      segment: null,
      term: term ? Number(term[1]) : null,
      basis: /\btracker\b/i.test(product) ? "Tracker" : /\bdiscount\b/i.test(product) ? "Discount" : /\bfixed\b/i.test(product) ? "Fixed" : null,
      blank: null,
      sourceEvidence: evidence,
      extractionNotes: LOCAL_EXTRACTION_NOTE,
      confidence: 0.82,
    });

    rateLabelIndex = Math.max(rateLabelIndex, endIndex - 1);
  }

  return products;
}

function lineByLineRateProducts(lines: string[]): Array<MortgageProductData & { confidence: number }> {
  const unique = new Set<string>();
  return lines.flatMap((line, index) => {
    const rate = line.match(/\b(\d{1,2}(?:\.\d{1,3})?)\s*%/);
    if (!rate) return [];
    const surrounding = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join(" ");
    const ltv = surrounding.match(/\b(\d{1,3}(?:\.\d+)?)\s*%?\s*ltv\b/i);
    const term = surrounding.match(/\b([235])\s*(?:year|yr)\b/i);
    const product = nearbyProductName(lines, index);
    const key = `${product}|${rate[1]}|${ltv?.[1] ?? ""}`.toLowerCase();
    if (unique.has(key)) return [];
    unique.add(key);
    return [{
      code: null,
      product,
      purpose: /buy.?to.?let|btl/i.test(surrounding) ? "Buy to Let" : null,
      maxLtv: asFraction(ltv?.[1]),
      rate: asFraction(rate[1]),
      aprc: null,
      productFee: null,
      incentives: null,
      cashback: null,
      ercs: null,
      endDate: null,
      segment: null,
      term: term ? Number(term[1]) : null,
      basis: /tracker/i.test(surrounding) ? "Tracker" : /fixed/i.test(surrounding) ? "Fixed" : null,
      blank: null,
      sourceEvidence: [line],
      extractionNotes: LOCAL_EXTRACTION_NOTE,
      confidence: 0.4,
    }];
  });
}

/** Local deterministic parser for users who do not want a hosted AI service. */
export function extractMortgageProductsLocally(sourceUrl: string, renderedText: string): ExtractedProductsResponse {
  const lines = renderedText.split(/\n+/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const compactProducts = compactProductCardProducts(lines);
  const labeledProducts = compactProducts.length > 0 ? [] : labeledBlockProducts(lines);
  const products = compactProducts.length > 0 ? compactProducts : labeledProducts.length > 0 ? labeledProducts : lineByLineRateProducts(lines);
  return { products, additionalNotes: products.length ? [] : ["No rate-bearing rows were recognized by the local rule parser."], pageClassification: products.length ? "product_page" : "no_product_data" };
}

export async function extractMortgageProducts(lenderName: string, sourceUrl: string, renderedText: string): Promise<ExtractedProductsResponse> {
  const deterministic = extractMortgageProductsLocally(sourceUrl, renderedText);
  const highConfidenceDeterministicProducts = deterministic.products.filter(product => product.confidence >= 0.75);
  if (process.env.LOCAL_EXTRACTOR === "rules" || highConfidenceDeterministicProducts.length > 0) {
    return highConfidenceDeterministicProducts.length > 0
      ? { ...deterministic, products: highConfidenceDeterministicProducts, pageClassification: "product_page", additionalNotes: deterministic.additionalNotes }
      : deterministic;
  }
  const boundedText = renderedText.slice(0, 80_000);
  const response = await invokeLLM({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: "You extract mortgage products from lender pages into a strict JSON schema. Return only products explicitly evidenced in the rendered page text. Do not invent missing values. Rates and APRC must be decimal fractions (5.23% becomes 0.0523); Max LTV must be a fraction (75% becomes 0.75). Keep each sourceEvidence item a short, verbatim page excerpt that supports the record. Product names must not be empty. Use null where source evidence is absent. For a lender-supported supplementary record that is not itself a priced mortgage product, set purpose to the exact value Additional; otherwise never use that value." },
      { role: "user", content: `Lender: ${lenderName}\nSource: ${sourceUrl}\n\nRendered page text:\n${boundedText}` },
    ],
    response_format: { type: "json_schema", json_schema: { name: "mortgage_products", strict: true, schema: productSchema } },
    reasoning: { effort: "low" },
  });
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("The extraction model returned no structured content.");
  const parsed = JSON.parse(content) as ExtractedProductsResponse;
  parsed.products = parsed.products.filter(product => product.product.trim().length > 0).map(product => ({ ...product, confidence: Math.max(0, Math.min(1, product.confidence)) }));
  return parsed;
}

export function productFingerprint(data: MortgageProductData): string {
  const stable = [data.code, data.product, data.purpose, data.maxLtv, data.rate, data.productFee, data.term, data.basis].map(value => value ?? "").join("|").toLowerCase();
  return crypto.createHash("sha256").update(stable).digest("hex");
}
