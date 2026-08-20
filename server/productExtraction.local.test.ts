import { describe, expect, it } from "vitest";
import { extractMortgageProductsLocally } from "./productExtraction";

describe("extractMortgageProductsLocally", () => {
  it("creates a review-required record from visible rate, LTV, and term evidence", () => {
    const result = extractMortgageProductsLocally("https://example-lender.test/products", [
      "Buy to Let mortgage products",
      "2 Year Fixed Rate",
      "4.89% fixed rate up to 75% LTV",
      "Product information and eligibility",
    ].join("\n"));

    expect(result.pageClassification).toBe("product_page");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      purpose: "Buy to Let",
      rate: 0.0489,
      maxLtv: 0.75,
      term: 2,
      basis: "Fixed",
      confidence: 0.4,
    });
    expect(result.products[0]?.extractionNotes).toContain("verify");
    expect(result.products[0]?.sourceEvidence).toContain("4.89% fixed rate up to 75% LTV");
  });

  it("does not invent product records where the rendered page contains no rate", () => {
    const result = extractMortgageProductsLocally("https://example-lender.test/about", "Welcome to Example Lender. Contact us for product information.");
    expect(result).toMatchObject({ pageClassification: "no_product_data", products: [] });
    expect(result.additionalNotes[0]).toContain("No rate-bearing rows");
  });
});
