import path from "node:path";
import { rm } from "node:fs/promises";

const projectPath = process.cwd();
const verificationRoot = path.join(projectPath, ".verification", "newcastle-job");
process.env.LOCAL_MODE = "true";
if (process.argv.includes("--optional-ai")) delete process.env.LOCAL_EXTRACTOR;
else process.env.LOCAL_EXTRACTOR = "rules";
process.env.LOCAL_DATA_DIR = path.join(verificationRoot, "data");
process.env.LOCAL_ARTIFACT_DIR = path.join(verificationRoot, "artifacts");

await rm(verificationRoot, { recursive: true, force: true });

const lenderDb = await import("../server/lenderDb");
const { createAndRunJob } = await import("../server/jobRunner");

const userId = 987654;
const productPageUrl = process.argv.includes("--legacy-url")
  ? "http://www.newcastleis.co.uk/products.aspx?ref=www.criteriahub.co.uk"
  : "https://newcastleforintermediaries.co.uk/products/our-product-range";
const lender = await lenderDb.addManualLender(userId, {
  name: "Newcastle for Intermediaries",
  productPageUrl,
});
const job = await createAndRunJob(userId, lender.id, "manual");
const products = await lenderDb.getProducts(userId, lender.id);
const dashboard = await lenderDb.getDashboard(userId);
const persistedLender = dashboard.lenders.find(row => row.id === lender.id);

const representative = products.find(product => product.data.code === "EBRT319");
if (job.successfulLenders !== 1 || products.length === 0 || !representative || persistedLender?.productCount !== products.length) {
  throw new Error(`Newcastle end-to-end job did not persist expected products: ${JSON.stringify({ job, productCount: products.length, persistedLender }, null, 2)}`);
}

console.log(JSON.stringify({
  job: { id: job.id, status: job.status, successfulLenders: job.successfulLenders, failedLenders: job.failedLenders },
  persistedProductCount: products.length,
  dashboardProductCount: persistedLender.productCount,
  representative: representative.data,
}, null, 2));
