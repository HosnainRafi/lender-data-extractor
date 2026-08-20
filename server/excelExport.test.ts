import { copyFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createReferenceWorkbook, getLocalTemplateSetupInstructions, renderReferenceWorkbook } from "./excelExport";
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
  it("provides a copy-and-paste Windows setup command when the local reference workbook is missing", () => {
    const guidance = getLocalTemplateSetupInstructions("C:\\Projects\\lender-data-extractor\\templates\\01-btl-mort_rates.xlsx");

    expect(guidance).toContain("setup-reference-workbook.ps1");
    expect(guidance).toContain("REFERENCE_WORKBOOK_PATH");
    expect(guidance).toContain("C:\\Projects\\lender-data-extractor\\templates\\01-btl-mort_rates.xlsx");
  });

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

  it("writes only the supplied lender’s product rows into a lender-scoped workbook", async () => {
    const template = await readFile(TEMPLATE_PATH);
    const excludedProduct = { ...product, code: "SECOND-EXCLUDED", product: "Other lender product" };
    const output = await renderReferenceWorkbook(template, [{ lenderName: "Selected Lender", lifecycle: "current", data: product }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output as any);
    const current = workbook.getWorksheet("Current Products")!;
    const values = current.getColumn(1).values.map(value => String(value ?? ""));

    expect(values).toContain("TEST-42");
    expect(values).not.toContain(excludedProduct.code!);
    expect(current.getCell(headerRow(current) + 1, 1).value).toBe("Selected Lender");
  });

  it("exports a downloadable local workbook after the reference template is installed at the documented path", async () => {
    const localTemplate = path.resolve(process.cwd(), "templates", "01-btl-mort_rates.xlsx");
    const originalLocalMode = process.env.LOCAL_MODE;
    const originalTemplatePath = process.env.REFERENCE_WORKBOOK_PATH;
    process.env.LOCAL_MODE = "true";
    delete process.env.REFERENCE_WORKBOOK_PATH;
    await copyFile(TEMPLATE_PATH, localTemplate);

    try {
      const exported = await createReferenceWorkbook("http://localhost:3000", [{ lenderName: "Test Lender", lifecycle: "current", data: product }]);
      const artifactPath = path.resolve(process.cwd(), "local-artifacts", exported.key);
      const artifact = await readFile(artifactPath);
      expect(exported.url).toMatch(/^\/local-artifacts\/exports\/lender-data-/);
      expect(artifact.subarray(0, 2).toString()).toBe("PK");
    } finally {
      await rm(localTemplate, { force: true });
      if (originalLocalMode === undefined) delete process.env.LOCAL_MODE;
      else process.env.LOCAL_MODE = originalLocalMode;
      if (originalTemplatePath === undefined) delete process.env.REFERENCE_WORKBOOK_PATH;
      else process.env.REFERENCE_WORKBOOK_PATH = originalTemplatePath;
    }
  });
});
