import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addManualLender, createJob, getDashboard } from "./lenderDb";

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
});
