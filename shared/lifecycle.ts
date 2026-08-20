import type { MortgageProductData, ProductLifecycle } from "./lenderTypes";

export type ExistingLifecycleRecord = { fingerprint: string; lifecycle: ProductLifecycle };

/**
 * The supplied workbook’s Additional tab is editorial rather than a rate table.
 * An extractor can deliberately classify a source-supported supplementary record
 * by setting its purpose to the exact value "Additional".
 */
export function isAdditionalRecord(product: MortgageProductData): boolean {
  return product.purpose?.trim().toLowerCase() === "additional";
}

export function lifecycleForObservedRecord(input: { product: MortgageProductData; isKnown: boolean; activeRateProductCount: number }): ProductLifecycle {
  if (isAdditionalRecord(input.product)) return "additional";
  if (input.isKnown) return "current";
  return input.activeRateProductCount === 0 ? "current" : "new";
}

export function withdrawnFingerprints(existing: ExistingLifecycleRecord[], seenFingerprints: Set<string>): string[] {
  return existing
    .filter(record => (record.lifecycle === "current" || record.lifecycle === "new") && !seenFingerprints.has(record.fingerprint))
    .map(record => record.fingerprint);
}
