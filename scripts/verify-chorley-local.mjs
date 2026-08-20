import { captureWithBrowser } from "../server/browserScraper.ts";
import { extractMortgageProductsLocally } from "../server/productExtraction.ts";
import { createReferenceWorkbook } from "../server/excelExport.ts";
import { storagePut } from "../server/storage.ts";

const sourceUrl = "https://www.chorleybs.co.uk/intermediary/compare-all";

process.env.LOCAL_MODE = "true";
process.env.LOCAL_EXTRACTOR = "rules";
process.env.REFERENCE_WORKBOOK_PATH ??= "/home/ubuntu/webdev-static-assets/01-btl-mort_rates.xlsx";

const capture = await captureWithBrowser(sourceUrl);
const extraction = extractMortgageProductsLocally(capture.finalUrl, capture.text);
const target = extraction.products.find(product => product.code === "IP469");

if (!target || target.rate !== 0.0499 || target.maxLtv !== 0.6 || target.aprc !== 0.073) {
  throw new Error(`The expected Chorley product IP469 was not extracted correctly: ${JSON.stringify(target ?? null)}`);
}

const jsonArtifact = await storagePut(
  "exports/chorley-verified-result.json",
  JSON.stringify({
    lender: {
      name: "Chorley Building Society",
      sourceUrl: capture.finalUrl,
      scrapeStatus: "success",
      capturedAt: new Date().toISOString(),
    },
    products: extraction.products,
  }, null, 2),
  "application/json",
);

const workbookArtifact = await createReferenceWorkbook("http://localhost:3001", extraction.products.map(data => ({
  lenderName: "Chorley Building Society",
  lifecycle: "current",
  data,
})));

console.log(JSON.stringify({
  capture: { finalUrl: capture.finalUrl, title: capture.title, textLength: capture.text.length },
  product: target,
  jsonArtifact,
  workbookArtifact,
}, null, 2));
