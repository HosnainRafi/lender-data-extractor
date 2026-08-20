import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { renderReferenceWorkbook } from "./excelExport";
import { EXPORT_SHEET_NAMES, type MortgageProductData } from "../shared/lenderTypes";

const TEMPLATE_PATH = "/home/ubuntu/webdev-static-assets/01-btl-mort_rates.xlsx";
const product: MortgageProductData = {
  code: "TEST-42", product: "Reference Fidelity Test", purpose: "Buy to Let", maxLtv: 0.75, rate: 0.0499, aprc: 0.072,
  productFee: 1995, incentives: null, cashback: null, ercs: "3%", endDate: "2027-08-31", segment: "Portfolio", term: 2,
  basis: "Fixed", blank: null, sourceEvidence: ["https://example.test"], extractionNotes: null,
};

function headerRow(sheet: ExcelJS.Worksheet) {
  for (let row = 1; row <= 45; row += 1) if (sheet.getCell(row, 1).value === "Code") return row;
  throw new Error("Expected reference header row.");
}

describe("reference workbook export", () => {
  it("preserves the supplied worksheet structure, support-sheet values, headers, and product-row formatting", async () => {
    const template = await readFile(TEMPLATE_PATH);
    const source = new ExcelJS.Workbook();
    await source.xlsx.load(template as any);
    const output = await renderReferenceWorkbook(template, [{ lenderName: "Test Lender", lifecycle: "current", data: product }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output as any);

    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(EXPORT_SHEET_NAMES);
    const current = workbook.getWorksheet("Current Products")!;
    const sourceCurrent = source.getWorksheet("Current Products")!;
    const header = headerRow(current);
    const sourceHeader = headerRow(sourceCurrent);
    expect(current.getRow(header).values).toEqual(sourceCurrent.getRow(sourceHeader).values);
    expect(current.getCell(header + 2, 1).value).toBe("TEST-42");
    expect(current.getCell(header + 2, 2).value).toBe("Reference Fidelity Test");
    expect(current.getCell(header + 2, 2).style.font).toEqual(sourceCurrent.getCell(sourceHeader + 2, 2).style.font);
    expect(workbook.getWorksheet("Introduction")!.getCell("A1").value).toEqual(source.getWorksheet("Introduction")!.getCell("A1").value);
    expect(workbook.getWorksheet("Additional")!.getCell("B5").value).toEqual(source.getWorksheet("Additional")!.getCell("B5").value);
  });
});
