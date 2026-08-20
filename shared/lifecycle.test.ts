import { describe, expect, it } from "vitest";
import { lifecycleForObservedRecord, withdrawnFingerprints } from "./lifecycle";
import type { MortgageProductData } from "./lenderTypes";

const rateProduct: MortgageProductData = { code: "A", product: "Two Year Fixed", purpose: "Buy to Let", maxLtv: 0.75, rate: 0.05, aprc: null, productFee: null, incentives: null, cashback: null, ercs: null, endDate: null, segment: null, term: 2, basis: "Fixed", blank: null, sourceEvidence: [], extractionNotes: null };

describe("product lifecycle change detection", () => {
  it("classifies first observed, repeated, and later unseen rate products correctly", () => {
    expect(lifecycleForObservedRecord({ product: rateProduct, isKnown: false, activeRateProductCount: 0 })).toBe("current");
    expect(lifecycleForObservedRecord({ product: rateProduct, isKnown: true, activeRateProductCount: 3 })).toBe("current");
    expect(lifecycleForObservedRecord({ product: rateProduct, isKnown: false, activeRateProductCount: 3 })).toBe("new");
    expect(withdrawnFingerprints([{ fingerprint: "repeated", lifecycle: "current" }, { fingerprint: "missing", lifecycle: "new" }, { fingerprint: "supplement", lifecycle: "additional" }], new Set(["repeated", "supplement"]))).toEqual(["missing"]);
  });

  it("keeps deliberately marked supplementary source records out of rate-product lifecycle buckets", () => {
    const additional: MortgageProductData = { ...rateProduct, code: null, product: "Tracker rate floor", purpose: "Additional", rate: null, maxLtv: null, term: null, basis: null };
    expect(lifecycleForObservedRecord({ product: additional, isKnown: false, activeRateProductCount: 5 })).toBe("additional");
    expect(lifecycleForObservedRecord({ product: additional, isKnown: true, activeRateProductCount: 5 })).toBe("additional");
  });
});
