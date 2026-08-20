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

  it("groups Chorley-style labeled fields into complete records instead of emitting field labels as products", () => {
    const result = extractMortgageProductsLocally("https://www.chorleybs.co.uk/intermediary/compare-all", [
      "Later Life - 2 Year Discount 60% LTV",
      "Initial Interest Rate",
      "4.99%",
      "Maximum Loan To Value (LTV)",
      "60%",
      "Overall Cost for Comparison",
      "7.30%",
      "Product Code",
      "IP469",
      "View details",
      "Buy to Let - 5 Year Fixed Rate 75% LTV",
      "Initial Interest Rate",
      "5.39%",
      "Maximum Loan To Value (LTV)",
      "75%",
      "Overall Cost for Comparison",
      "7.90%",
      "Product Code",
      "IP501",
      "View details",
    ].join("\n"));

    expect(result).toMatchObject({ pageClassification: "product_page", additionalNotes: [] });
    expect(result.products).toHaveLength(2);
    const laterLife = result.products.find(product => product.code === "IP469");
    const buyToLet = result.products.find(product => product.code === "IP501");
    expect(laterLife).toMatchObject({
      product: "Later Life - 2 Year Discount 60% LTV",
      code: "IP469",
      maxLtv: 0.6,
      aprc: 0.073,
      term: 2,
      basis: "Discount",
      purpose: null,
      confidence: 0.75,
    });
    expect(laterLife?.rate).toBeCloseTo(0.0499, 10);
    expect(buyToLet).toMatchObject({
      product: "Buy to Let - 5 Year Fixed Rate 75% LTV",
      code: "IP501",
      maxLtv: 0.75,
      aprc: 0.079,
      term: 5,
      basis: "Fixed",
      purpose: "Buy to Let",
      confidence: 0.75,
    });
    expect(buyToLet?.rate).toBeCloseTo(0.0539, 10);
    expect(result.products.map(product => product.product)).not.toEqual(expect.arrayContaining([
      "Initial Interest Rate",
      "Overall Cost for Comparison",
      "Product Code",
    ]));
  });

  it("groups Newcastle compact product cards where the code is followed by the title and labeled values", () => {
    const result = extractMortgageProductsLocally("https://newcastleforintermediaries.co.uk/products/our-product-range", [
      "EBRT319",
      "2 Year Base Rate Tracker",
      "Until 30 November 2028",
      "Initial rate",
      "4.35%",
      "SVR",
      "6.31%",
      "APRC",
      "6.20%",
      "LTV",
      "80%",
      "Product fee",
      "£999",
      "Incentives",
      "10% overpayments",
      "Full product details",
      "FIIX773",
      "5 Year Fixed Rate",
      "Until 30 November 2031",
      "Initial rate",
      "5.15%",
      "SVR",
      "6.31%",
      "APRC",
      "6.00%",
      "LTV",
      "80%",
      "Product fee",
      "£999",
      "Full product details",
    ].join("\n"));

    expect(result).toMatchObject({ pageClassification: "product_page", additionalNotes: [] });
    expect(result.products).toHaveLength(2);
    const tracker = result.products.find(product => product.code === "EBRT319");
    const fixed = result.products.find(product => product.code === "FIIX773");
    expect(tracker).toMatchObject({ product: "2 Year Base Rate Tracker", aprc: 0.062, maxLtv: 0.8, productFee: 999, term: 2, basis: "Tracker", confidence: 0.82 });
    expect(fixed).toMatchObject({ product: "5 Year Fixed Rate", aprc: 0.06, maxLtv: 0.8, productFee: 999, term: 5, basis: "Fixed", confidence: 0.82 });
    expect(tracker?.rate).toBeCloseTo(0.0435, 10);
    expect(fixed?.rate).toBeCloseTo(0.0515, 10);
  });

  it("does not invent product records where the rendered page contains no rate", () => {
    const result = extractMortgageProductsLocally("https://example-lender.test/about", "Welcome to Example Lender. Contact us for product information.");
    expect(result).toMatchObject({ pageClassification: "no_product_data", products: [] });
    expect(result.additionalNotes[0]).toContain("No rate-bearing rows");
  });
});
