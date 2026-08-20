import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addManualLender, completeAttempt, createAttempt, createJob, getDashboard, getProducts, persistExtractedProducts } from "./lenderDb";
import { renderReferenceWorkbook } from "./excelExport";
import type { MortgageProductData } from "../shared/lenderTypes";

let dataDirectory = "";
let previousMode: string | undefined;
let previousDirectory: string | undefined;

beforeEach(async () => {
  previousMode = process.env.LOCAL_MODE;
  previousDirectory = process.env.LOCAL_DATA_DIR;
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "lender-local-store-"));
  process.env.LOCAL_MODE = "true";
  process.env.LOCAL_DATA_DIR = dataDirectory;
});

afterEach(async () => {
  if (previousMode === undefined) delete process.env.LOCAL_MODE;
  else process.env.LOCAL_MODE = previousMode;
  if (previousDirectory === undefined) delete process.env.LOCAL_DATA_DIR;
  else process.env.LOCAL_DATA_DIR = previousDirectory;
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("file-backed local lender persistence", () => {
  it("stores a manual lender and its queued browser job without MySQL", async () => {
    const lender = await addManualLender(1, {
      name: "Example Lender",
      productPageUrl: "https://example.com/products",
    });
    const job = await createJob(1, lender.id, "manual");
    const dashboard = await getDashboard(1);
    const saved = JSON.parse(await readFile(path.join(dataDirectory, "lender-data.json"), "utf8")) as {
      lenders: Array<{ name: string }>;
      jobs: Array<{ id: number; status: string }>;
    };

    expect(lender.name).toBe("Example Lender");
    expect(job.totalLenders).toBe(1);
    expect(dashboard.summary.lenders).toBe(1);
    expect(saved.lenders).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Example Lender" })]));
    expect(saved.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ id: job.id, status: "queued" })]));
  });

  it("shows only the latest blocked failure per lender in the dashboard exception list", async () => {
    const lender = await addManualLender(1, {
      name: "Alternative Bridging Corporation Ltd",
      productPageUrl: "https://example.com/products",
    });
    const job = await createJob(1, lender.id, "manual");
    const firstAttempt = await createAttempt(lender.id, job.id, "https://example.com/products");
    const secondAttempt = await createAttempt(lender.id, job.id, "https://example.com/products");
    await completeAttempt(firstAttempt, { status: "failed", errorCategory: "blocked", errorMessage: "First access challenge." });
    await completeAttempt(secondAttempt, { status: "failed", errorCategory: "blocked", errorMessage: "Second access challenge." });

    const dashboard = await getDashboard(1);

    expect(dashboard.errors).toHaveLength(1);
    expect(dashboard.errors[0]).toMatchObject({
      lenderName: "Alternative Bridging Corporation Ltd",
      attempt: { status: "failed", errorCategory: "blocked" },
    });
  });

  it("retrieves and exports products for only the selected lender", async () => {
    const firstLender = await addManualLender(1, { name: "First Lender", productPageUrl: "https://example.com/first" });
    const secondLender = await addManualLender(1, { name: "Second Lender", productPageUrl: "https://example.com/second" });
    const firstJob = await createJob(1, firstLender.id, "manual");
    const secondJob = await createJob(1, secondLender.id, "manual");
    const product = (code: string): MortgageProductData & { confidence: number } => ({
      code, product: `${code} mortgage`, purpose: "Buy to Let", maxLtv: 0.75, rate: 0.0499, aprc: 0.072,
      productFee: null, incentives: null, cashback: null, ercs: null, endDate: null, segment: null, term: 2,
      basis: "Fixed", blank: null, sourceEvidence: [code], extractionNotes: null, confidence: 0.75,
    });
    await persistExtractedProducts(1, firstLender.id, firstJob.id, [product("FIRST-ONLY")]);
    await persistExtractedProducts(1, secondLender.id, secondJob.id, [product("SECOND-EXCLUDED")]);

    const selectedProducts = await getProducts(1, firstLender.id);
    const template = await readFile("/home/ubuntu/webdev-static-assets/01-btl-mort_rates.xlsx");
    const output = await renderReferenceWorkbook(template, selectedProducts.map(item => ({ lenderName: item.lenderName, lifecycle: item.lifecycle, data: item.data })));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output as any);
    const values = workbook.getWorksheet("Current Products")!.getColumn(1).values.map(value => String(value ?? ""));

    expect(selectedProducts).toHaveLength(1);
    expect(selectedProducts[0]).toMatchObject({ lenderId: firstLender.id, lenderName: "First Lender", data: { code: "FIRST-ONLY" } });
    expect(values).toContain("First Lender");
    expect(values).toContain("FIRST-ONLY");
    expect(values).not.toContain("Second Lender");
    expect(values).not.toContain("SECOND-EXCLUDED");
  });
});
