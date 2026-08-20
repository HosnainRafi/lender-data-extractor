import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { importFlexibleLenders, inferFlexibleLenders } from "./sheetImport";

describe("flexible lender-source intake", () => {
  it("detects lender name, main website, and product-page headers without fixed G/J positions", () => {
    const lenders = inferFlexibleLenders([
      ["Provider Name", "Notes", "Website URL", "Mortgage Product Page URL"],
      ["Beverley Building Society", "direct source", "https://beverleybs.co.uk", "https://beverleybs.co.uk/intermediaries/mortgages"],
    ], "User CSV");

    expect(lenders).toEqual([expect.objectContaining({
      name: "Beverley Building Society",
      normalizedName: "beverley",
      mainWebsiteUrl: "https://beverleybs.co.uk/",
      productPageUrl: "https://beverleybs.co.uk/intermediaries/mortgages",
      sourceWorkbook: "User CSV",
      sourceRow: 2,
    })]);
  });

  it("reads an uploaded XLSX file and maps a provider/homepage/product-link workbook", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sources");
    sheet.addRow(["Provider", "Homepage", "Mortgage Product Link"]);
    sheet.addRow(["Example Lender", "https://example.test", "https://example.test/products"]);
    const bytes = await workbook.xlsx.writeBuffer();

    const lenders = await importFlexibleLenders({
      fileName: "my-lender-list.xlsx",
      fileBase64: Buffer.from(bytes).toString("base64"),
    });

    expect(lenders).toEqual([expect.objectContaining({
      name: "Example Lender",
      mainWebsiteUrl: "https://example.test/",
      productPageUrl: "https://example.test/products",
      sourceWorkbook: "my-lender-list.xlsx",
    })]);
  });
});
