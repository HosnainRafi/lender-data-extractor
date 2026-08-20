import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";

const [jsonPath, workbookPath] = process.argv.slice(2);
if (!jsonPath || !workbookPath) throw new Error("Usage: pnpm tsx scripts/inspect-chorley-artifacts.mjs <json-path> <xlsx-path>");

const result = JSON.parse(await readFile(jsonPath, "utf8"));
const product = result.products.find(candidate => candidate.code === "IP469");
if (!product || product.product !== "Later Life - 2 Year Discount 60% LTV" || product.rate !== 0.0499 || product.maxLtv !== 0.6 || product.aprc !== 0.073) {
  throw new Error(`Corrected Chorley JSON verification failed: ${JSON.stringify(product ?? null)}`);
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(await readFile(workbookPath));
const sheet = workbook.getWorksheet("Current Products");
if (!sheet) throw new Error("Current Products sheet was not found.");
let header = 0;
for (let row = 1; row <= 45; row += 1) {
  if (sheet.getCell(row, 1).value === "Code") {
    header = row;
    break;
  }
}
const productRow = header + 2;
const row = {
  code: sheet.getCell(productRow, 1).value,
  product: sheet.getCell(productRow, 2).value,
  maxLtv: sheet.getCell(productRow, 4).value,
  rate: sheet.getCell(productRow, 5).value,
  aprc: sheet.getCell(productRow, 6).value,
};
if (row.code !== "IP469" || row.product !== "Later Life - 2 Year Discount 60% LTV" || row.maxLtv !== 0.6 || row.rate !== 0.0499 || row.aprc !== 0.073) {
  throw new Error(`Corrected Chorley workbook verification failed: ${JSON.stringify(row)}`);
}

console.log(JSON.stringify({ lender: result.lender.name, jsonProduct: product, workbookRow: row }, null, 2));
