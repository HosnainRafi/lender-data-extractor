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

/** Local deterministic parser for users who do not want a hosted AI service. */
export function extractMortgageProductsLocally(sourceUrl: string, renderedText: string): ExtractedProductsResponse {
  const lines = renderedText.split(/\n+/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const unique = new Set<string>();
  const products = lines.flatMap((line, index) => {
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
      code: null, product, purpose: /buy.?to.?let|btl/i.test(surrounding) ? "Buy to Let" : null,
      maxLtv: asFraction(ltv?.[1]), rate: asFraction(rate[1]), aprc: null, productFee: null, incentives: null, cashback: null, ercs: null,
      endDate: null, segment: null, term: term ? Number(term[1]) : null, basis: /tracker/i.test(surrounding) ? "Tracker" : /fixed/i.test(surrounding) ? "Fixed" : null,
      blank: null, sourceEvidence: [line], extractionNotes: "Local rule-based extraction; verify against the captured lender page before export.", confidence: 0.4,
    }];
  });
  return { products, additionalNotes: products.length ? [] : ["No rate-bearing rows were recognized by the local rule parser."], pageClassification: products.length ? "product_page" : "no_product_data" };
}

export async function extractMortgageProducts(lenderName: string, sourceUrl: string, renderedText: string): Promise<ExtractedProductsResponse> {
  if (process.env.LOCAL_EXTRACTOR === "rules") return extractMortgageProductsLocally(sourceUrl, renderedText);
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
