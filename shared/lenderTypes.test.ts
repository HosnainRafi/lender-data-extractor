import { describe, expect, it } from "vitest";
import { EXPORT_SHEET_NAMES, productToReferenceRow, referenceColumns, type MortgageProductData } from "./lenderTypes";

const product: MortgageProductData = {
  code: "BTL-001",
  product: "Two Year Fixed",
  purpose: "Buy to Let",
  maxLtv: 0.75,
  rate: 0.0499,
  aprc: 0.072,
  productFee: 1995,
  incentives: null,
  cashback: null,
  ercs: "3% year one",
  endDate: "2027-08-31",
  segment: "Portfolio",
  term: 2,
  basis: "Fixed",
  blank: null,
  sourceEvidence: ["https://example.test/products"],
  extractionNotes: null,
};

describe("reference workbook contract", () => {
  it("uses the supplied five-sheet structure", () => {
    expect(EXPORT_SHEET_NAMES).toEqual(["Introduction", "Current Products", "New Products", "Withdrawn Products", "Additional"]);
  });

  it("maps every product field into the exact 15 reference columns", () => {
    const row = productToReferenceRow(product);
    expect(row).toHaveLength(referenceColumns.length);
    expect(row).toEqual(["BTL-001", "Two Year Fixed", "Buy to Let", 0.75, 0.0499, 0.072, 1995, null, null, "3% year one", "2027-08-31", "Portfolio", 2, "Fixed", null]);
  });
});
