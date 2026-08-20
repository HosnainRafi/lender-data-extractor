import { describe, expect, it, vi } from "vitest";
import { extractFromDownload } from "./downloadExtraction";

describe("downloadExtraction", () => {
  it("parses a flat JSON product array with code, rate, LTV, and APRC", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        products: [
          { productCode: "P100", productName: "2 Year Fixed Rate", initialRate: "5.25%", ltv: "75%", aprc: "6.1%", productFee: "£999" },
          { productCode: "P101", productName: "5 Year Fixed Rate", initialRate: "4.99%", ltv: "60%", aprc: "6.0%", productFee: "£1,495" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as typeof globalThis.fetch;
    try {
      const result = await extractFromDownload("https://example.test/products.json");
      expect(result.format).toBe("json");
      expect(result.products).toHaveLength(2);
      expect(result.products[0]).toMatchObject({
        code: "P100",
        product: "2 Year Fixed Rate",
        productFee: 999,
        term: 2,
        basis: "Fixed",
        confidence: 0.9,
      });
      expect(result.products[0]?.rate).toBeCloseTo(0.0525, 10);
      expect(result.products[0]?.maxLtv).toBeCloseTo(0.75, 10);
      expect(result.products[0]?.aprc).toBeCloseTo(0.061, 10);
      expect(result.products[1]).toMatchObject({ code: "P101", productFee: 1495 });
      expect(result.products[1]?.rate).toBeCloseTo(0.0499, 10);
      expect(result.products[1]?.maxLtv).toBeCloseTo(0.6, 10);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses a CSV download with a header row", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Product Code,Product,Initial Rate,LTV,APRC,Product Fee\nBTL001,Buy to Let 2yr Fixed,5.89%,75%,6.7%,\"£1,250\"\n", { status: 200, headers: { "content-type": "text/csv" } }),
    ) as typeof globalThis.fetch;
    try {
      const result = await extractFromDownload("https://example.test/products.csv");
      expect(result.format).toBe("csv");
      expect(result.products).toHaveLength(1);
      expect(result.products[0]).toMatchObject({
        code: "BTL001",
        product: "Buy to Let 2yr Fixed",
        productFee: 1250,
        purpose: "Buy to Let",
        basis: "Fixed",
        term: 2,
      });
      expect(result.products[0]?.rate).toBeCloseTo(0.0589, 10);
      expect(result.products[0]?.maxLtv).toBeCloseTo(0.75, 10);
      expect(result.products[0]?.aprc).toBeCloseTo(0.067, 10);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports an empty result for an unrecognized download", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html>not a product file</html>", { status: 200, headers: { "content-type": "text/html" } }),
    ) as typeof globalThis.fetch;
    try {
      const result = await extractFromDownload("https://example.test/download");
      expect(result.products).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
