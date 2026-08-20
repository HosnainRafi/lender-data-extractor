export const EXPORT_SHEET_NAMES = [
  "Introduction",
  "Current Products",
  "New Products",
  "Withdrawn Products",
  "Additional",
] as const;

export type ExportSheetName = (typeof EXPORT_SHEET_NAMES)[number];

export type ProductLifecycle = "current" | "new" | "withdrawn" | "additional";
export type ReviewStatus = "needs_review" | "approved" | "edited";

export type MortgageProductData = {
  code: string | null;
  product: string;
  purpose: string | null;
  maxLtv: number | null;
  rate: number | null;
  aprc: number | null;
  productFee: number | null;
  incentives: string | null;
  cashback: number | null;
  ercs: string | null;
  endDate: string | null;
  segment: string | null;
  term: number | null;
  basis: string | null;
  blank: number | null;
  sourceEvidence: string[];
  extractionNotes: string | null;
};

export type ExtractedMortgageProduct = MortgageProductData & {
  confidence: number;
};

export type ExtractedProductsResponse = {
  products: ExtractedMortgageProduct[];
  additionalNotes: string[];
  pageClassification: "product_page" | "document" | "blocked" | "no_product_data";
};

export const referenceColumns = [
  "Code",
  "Product",
  "Purpose",
  "Max. LTV",
  "Rate",
  "APRC",
  "Product Fee",
  "Incentives",
  "Cashback",
  "ERCs",
  "End Date",
  "Segment",
  "Term",
  "Basis",
  "Blank",
] as const;

export function productToReferenceRow(product: MortgageProductData): Array<string | number | null> {
  return [
    product.code,
    product.product,
    product.purpose,
    product.maxLtv,
    product.rate,
    product.aprc,
    product.productFee,
    product.incentives,
    product.cashback,
    product.ercs,
    product.endDate,
    product.segment,
    product.term,
    product.basis,
    product.blank,
  ];
}
