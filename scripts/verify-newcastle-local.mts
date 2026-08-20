import { readFile } from "node:fs/promises";
import { extractMortgageProductsLocally } from "../server/productExtraction";

const sourceUrl = "https://newcastleforintermediaries.co.uk/products/our-product-range";
const pageTextPath = "/home/ubuntu/page_texts/newcastleforintermediaries.co.uk_products_our-product-range.md";
const renderedText = await readFile(pageTextPath, "utf8");
const result = extractMortgageProductsLocally(sourceUrl, renderedText);

const requiredCodes = ["EBRT319", "FIIX773"];
const samples = requiredCodes.map(code => result.products.find(product => product.code === code));
if (samples.some(product => !product)) throw new Error("Expected Newcastle product codes were not extracted from the browser capture.");
if (samples.some(product => product?.rate === null || product?.aprc === null || product?.maxLtv === null)) {
  throw new Error("Newcastle product records were extracted without their required rate, APRC, or LTV fields.");
}

console.log(JSON.stringify({
  pageClassification: result.pageClassification,
  productCount: result.products.length,
  samples,
}, null, 2));
