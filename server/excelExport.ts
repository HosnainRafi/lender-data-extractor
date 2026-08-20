import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { storagePut } from "./storage";
import { productToReferenceRow, type MortgageProductData } from "../shared/lenderTypes";

const REFERENCE_TEMPLATE_PATH = "/manus-storage/01-btl-mort_rates_fbd27c56.xlsx";
const DEFAULT_LOCAL_TEMPLATE_PATH = path.resolve(process.cwd(), "templates", "01-btl-mort_rates.xlsx");

export type ExportProduct = {
  lenderName: string;
  lifecycle: "current" | "new" | "withdrawn" | "additional";
  data: MortgageProductData;
};

type RowTemplate = { height?: number; cells: Array<{ style: Partial<ExcelJS.Style>; numFmt?: string }> };

function captureRowTemplate(worksheet: ExcelJS.Worksheet, rowNumber: number): RowTemplate {
  const row = worksheet.getRow(rowNumber);
  return {
    ...(row.height !== undefined ? { height: row.height } : {}),
    cells: Array.from({ length: 16 }, (_, index) => {
      const cell = row.getCell(index + 1);
      return { style: structuredClone(cell.style), numFmt: cell.numFmt };
    }),
  };
}

function applyRowTemplate(row: ExcelJS.Row, template: RowTemplate) {
  if (template.height !== undefined) row.height = template.height;
  template.cells.forEach((templateCell, index) => {
    const cell = row.getCell(index + 1);
    cell.style = structuredClone(templateCell.style);
    if (templateCell.numFmt) cell.numFmt = templateCell.numFmt;
  });
}

function findHeaderRow(worksheet: ExcelJS.Worksheet): number {
  for (let row = 1; row <= Math.min(worksheet.rowCount, 45); row += 1) {
    if (worksheet.getCell(row, 1).value === "Code" && worksheet.getCell(row, 2).value === "Product") return row;
  }
  throw new Error(`Reference header could not be found on ${worksheet.name}.`);
}

function populateProductSheet(worksheet: ExcelJS.Worksheet, products: ExportProduct[]) {
  const headerRow = findHeaderRow(worksheet);
  const groupTemplate = captureRowTemplate(worksheet, headerRow + 1);
  const productTemplate = captureRowTemplate(worksheet, headerRow + 2);
  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    worksheet.getRow(rowNumber).values = [];
  }

  const grouped = new Map<string, ExportProduct[]>();
  products.forEach(product => grouped.set(product.lenderName, [...(grouped.get(product.lenderName) ?? []), product]));
  if (grouped.size === 0) grouped.set("No extracted records", []);

  let nextRow = headerRow + 1;
  grouped.forEach((groupProducts, lenderName) => {
    const groupRow = worksheet.getRow(nextRow);
    groupRow.values = new Array(16).fill(null);
    applyRowTemplate(groupRow, groupTemplate);
    groupRow.getCell(1).value = lenderName;
    groupRow.getCell(12).value = groupProducts[0]?.data.segment ?? "";
    groupRow.getCell(13).value = 0;
    groupRow.getCell(14).value = 0;
    groupRow.getCell(15).value = 0;
    groupRow.getCell(16).value = 0;
    nextRow += 1;
    groupProducts.forEach(product => {
      const row = worksheet.getRow(nextRow);
      row.values = productToReferenceRow(product.data);
      applyRowTemplate(row, productTemplate);
      row.getCell(16).value = { formula: `IF(A${row.number}=0,0,1)` };
      nextRow += 1;
    });
  });
}

export async function renderReferenceWorkbook(template: Buffer, products: ExportProduct[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as any);

  populateProductSheet(workbook.getWorksheet("Current Products")!, products.filter(product => product.lifecycle === "current"));
  populateProductSheet(workbook.getWorksheet("New Products")!, products.filter(product => product.lifecycle === "new"));
  populateProductSheet(workbook.getWorksheet("Withdrawn Products")!, products.filter(product => product.lifecycle === "withdrawn"));

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output) as unknown as Buffer;
}

export async function createReferenceWorkbook(origin: string, products: ExportProduct[]) {
  let template: Buffer;
  if (process.env.LOCAL_MODE === "true") {
    const templatePath = process.env.REFERENCE_WORKBOOK_PATH ?? DEFAULT_LOCAL_TEMPLATE_PATH;
    if (!existsSync(templatePath)) throw new Error(`Reference workbook not found at ${templatePath}. Copy 01-btl-mort_rates.xlsx into templates/ or set REFERENCE_WORKBOOK_PATH.`);
    template = await readFile(templatePath);
  } else {
    const templateResponse = await fetch(new URL(REFERENCE_TEMPLATE_PATH, origin));
    if (!templateResponse.ok) throw new Error(`Reference workbook template could not be loaded (${templateResponse.status}).`);
    template = Buffer.from(await templateResponse.arrayBuffer()) as unknown as Buffer;
  }
  const output = await renderReferenceWorkbook(template, products);
  return storagePut(`exports/lender-data-${new Date().toISOString().slice(0, 10)}.xlsx`, output, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
