import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { renderReferenceWorkbook } from "./excelExport";
import { extractMortgageProductsLocally } from "./productExtraction";

const TEMPLATE_PATH = "/home/ubuntu/webdev-static-assets/01-btl-mort_rates.xlsx";

function headerRow(sheet: ExcelJS.Worksheet) {
  for (let row = 1; row <= 45; row += 1) {
    if (sheet.getCell(row, 1).value === "Code") return row;
  }
  throw new Error("Expected reference header row.");
}

describe("Chorley local extraction workbook integration", () => {
  it("retains the grouped product code, rate, LTV, and APRC in the reference workbook", async () => {
    const parsed = extractMortgageProductsLocally("https://www.chorleybs.co.uk/intermediary/compare-all", `
Later Life - 2 Year Discount 60% LTV
Initial Interest Rate
4.99%
Maximum Loan To Value (LTV)
60%
Overall Cost for Comparison
7.30%
Product Code
IP469
View details
`);
    const template = await readFile(TEMPLATE_PATH);
    const output = await renderReferenceWorkbook(template, parsed.products.map(data => ({ lenderName: "Chorley Building Society", lifecycle: "current" as const, data })));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output as any);
    const current = workbook.getWorksheet("Current Products")!;
    const productRow = headerRow(current) + 2;

    expect(current.getCell(productRow, 1).value).toBe("IP469");
    expect(current.getCell(productRow, 2).value).toBe("Later Life - 2 Year Discount 60% LTV");
    expect(current.getCell(productRow, 4).value).toBeCloseTo(0.6, 10);
    expect(current.getCell(productRow, 5).value).toBeCloseTo(0.0499, 10);
    expect(current.getCell(productRow, 6).value).toBeCloseTo(0.073, 10);
  });
});
