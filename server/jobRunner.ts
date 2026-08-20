import { captureAfterManualVerification, captureWithBrowser, BrowserCaptureError } from "./browserScraper";
import { extractFromDownloadLinks } from "./downloadExtraction";
import { extractMortgageProducts } from "./productExtraction";
import { storagePut } from "./storage";
import {
  completeAttempt,
  createAttempt,
  createJob,
  getJob,
  getQueuedJob,
  listJobTargets,
  markLenderResult,
  markLenderRunning,
  persistExtractedProducts,
  setJobRunning,
  updateJobProgress,
} from "./lenderDb";

// Autoscale jobs must finish within a single request. Remaining lenders are
// persisted as a queued job and are resumed by a user action or the next cron tick.
const LENDERS_PER_REQUEST = 6;

type FailureCategory = "blocked" | "timeout" | "empty" | "invalid_url" | "browser" | "extraction" | "unknown";

type LenderTarget = {
  id: number;
  name: string;
  mainWebsiteUrl: string | null;
  productPageUrl: string | null;
  resiProductsUrl?: string | null;
  btlProductsUrl?: string | null;
  resiDownloadUrl?: string | null;
  btlDownloadUrl?: string | null;
};

function downloadLinks(lender: LenderTarget): string[] {
  return [lender.resiDownloadUrl, lender.btlDownloadUrl].filter((value): value is string => Boolean(value));
}

function productUrlCandidates(lender: LenderTarget): string[] {
  return [lender.productPageUrl, lender.resiProductsUrl, lender.btlProductsUrl, lender.mainWebsiteUrl].filter((value): value is string => Boolean(value));
}

function errorDetails(error: unknown): { category: FailureCategory; message: string } {
  if (error instanceof BrowserCaptureError) return { category: error.category, message: error.message };
  if (error instanceof Error) return { category: "extraction", message: error.message.slice(0, 1500) };
  return { category: "unknown", message: "The scrape failed with an unknown error." };
}

export async function runJobSegment(userId: number, jobId: number) {
  const job = await getJob(userId, jobId);
  if (!job) throw new Error("Scrape job not found.");
  if (job.status === "completed" || job.status === "cancelled") return job;

  const targets = (await listJobTargets(userId, jobId)) as LenderTarget[];
  if (targets.length === 0) {
    await updateJobProgress(jobId, { processedLenders: 0, successfulLenders: 0, failedLenders: 0, status: "completed" });
    return getJob(userId, jobId);
  }
  await setJobRunning(jobId);

  let processed = job.processedLenders;
  let successes = job.successfulLenders;
  let failures = job.failedLenders;
  const segment = targets.slice(processed, processed + LENDERS_PER_REQUEST);

  for (const lender of segment) {
    const downloads = downloadLinks(lender);
    const candidates = productUrlCandidates(lender);
    const targetUrl = downloads[0] ?? candidates[0];
    if (!targetUrl) {
      failures += 1;
      processed += 1;
      await markLenderResult(lender.id, "failed", { category: "invalid_url", message: "No browser-capturable product or website URL is available." });
      continue;
    }
    const attemptId = await createAttempt(lender.id, jobId, targetUrl);
    await markLenderRunning(lender.id);
    try {
      let capture: Awaited<ReturnType<typeof captureWithBrowser>> | null = null;
      let extraction: Awaited<ReturnType<typeof extractMortgageProducts>>;

      // Prefer direct product-data downloads (JSON / CSV / XLSX / PDF) when the
      // source sheet provides them; fall back to a rendered browser page otherwise.
      if (downloads.length > 0) {
        const downloaded = await extractFromDownloadLinks(downloads);
        if (downloaded.products.length > 0) {
          extraction = { products: downloaded.products, additionalNotes: downloaded.notes, pageClassification: "product_page" };
        } else if (candidates[0]) {
          capture = await captureWithBrowser(candidates[0]);
          extraction = await extractMortgageProducts(lender.name, capture.finalUrl, capture.text);
        } else {
          extraction = { products: [], additionalNotes: downloaded.notes, pageClassification: "no_product_data" };
        }
      } else {
        capture = await captureWithBrowser(candidates[0]!);
        extraction = await extractMortgageProducts(lender.name, capture.finalUrl, capture.text);
      }

      const safePrefix = `scrapes/lender-${lender.id}/job-${jobId}-${Date.now()}`;
      if (capture) {
        const [textAsset, screenshotAsset] = await Promise.all([
          storagePut(`${safePrefix}.txt`, capture.text, "text/plain; charset=utf-8"),
          storagePut(`${safePrefix}.png`, capture.screenshot, "image/png"),
        ]);
        await completeAttempt(attemptId, { status: "success", finalUrl: capture.finalUrl, pageTitle: capture.title, pageTextKey: textAsset.key, screenshotKey: screenshotAsset.key });
      } else {
        const evidenceText = extraction.products.map(product => JSON.stringify(product)).join("\n") || extraction.additionalNotes.join("\n");
        const textAsset = await storagePut(`${safePrefix}.download.txt`, evidenceText, "text/plain; charset=utf-8");
        await completeAttempt(attemptId, { status: "success", finalUrl: targetUrl, pageTitle: lender.name, pageTextKey: textAsset.key });
      }
      await persistExtractedProducts(userId, lender.id, jobId, extraction.products);
      await markLenderResult(lender.id, "success");
      successes += 1;
    } catch (error) {
      const failure = errorDetails(error);
      await completeAttempt(attemptId, { status: "failed", errorCategory: failure.category, errorMessage: failure.message });
      await markLenderResult(lender.id, "failed", failure);
      failures += 1;
    }
    processed += 1;
  }

  const finished = processed >= targets.length;
  await updateJobProgress(jobId, {
    processedLenders: processed,
    successfulLenders: successes,
    failedLenders: failures,
    status: finished ? "completed" : "queued",
  });
  return getJob(userId, jobId);
}

export async function createAndRunJob(userId: number, lenderId: number | null, trigger: "manual" | "retry" | "scheduled" | "sheet_sync") {
  const job = await createJob(userId, lenderId, trigger);
  return runJobSegment(userId, job.id);
}

/** Runs the existing persistence and extraction flow after a user verifies a blocked page in a visible local browser. */
export async function recoverBlockedLender(userId: number, lenderId: number) {
  const job = await createJob(userId, lenderId, "retry");
  const lender = (await listJobTargets(userId, job.id))[0] as LenderTarget | undefined;
  if (!lender) throw new Error("The selected lender is no longer available for recovery.");
  const candidates = productUrlCandidates(lender);
  const targetUrl = candidates[0];
  if (!targetUrl) throw new Error("The selected lender has no browser-capturable URL.");

  await setJobRunning(job.id);
  const attemptId = await createAttempt(lender.id, job.id, targetUrl);
  await markLenderRunning(lender.id);
  try {
    const capture = await captureAfterManualVerification(targetUrl);
    const safePrefix = `scrapes/lender-${lender.id}/job-${job.id}-${Date.now()}`;
    const [textAsset, screenshotAsset] = await Promise.all([
      storagePut(`${safePrefix}.txt`, capture.text, "text/plain; charset=utf-8"),
      storagePut(`${safePrefix}.png`, capture.screenshot, "image/png"),
    ]);
    const extraction = await extractMortgageProducts(lender.name, capture.finalUrl, capture.text);
    await persistExtractedProducts(userId, lender.id, job.id, extraction.products);
    await completeAttempt(attemptId, { status: "success", finalUrl: capture.finalUrl, pageTitle: capture.title, pageTextKey: textAsset.key, screenshotKey: screenshotAsset.key });
    await markLenderResult(lender.id, "success");
    await updateJobProgress(job.id, { processedLenders: 1, successfulLenders: 1, failedLenders: 0, status: "completed" });
  } catch (error) {
    const failure = errorDetails(error);
    await completeAttempt(attemptId, { status: "failed", errorCategory: failure.category, errorMessage: failure.message });
    await markLenderResult(lender.id, "failed", failure);
    await updateJobProgress(job.id, { processedLenders: 1, successfulLenders: 0, failedLenders: 1, status: "completed" });
    throw error;
  }
  return getJob(userId, job.id);
}

export async function runNextScheduledRefreshSegment(userId: number) {
  const queued = await getQueuedJob(userId);
  if (queued) return runJobSegment(userId, queued.id);
  return createAndRunJob(userId, null, "scheduled");
}
