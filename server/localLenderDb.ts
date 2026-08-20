import type { MortgageProductData, ReviewStatus } from "../shared/lenderTypes";
import { lifecycleForObservedRecord, withdrawnFingerprints } from "../shared/lifecycle";
import { productFingerprint } from "./productExtraction";
import type { ImportedLender } from "./sheetImport";
import { withLocalState, type LocalLender, type LocalProduct } from "./localStore";

const now = () => new Date().toISOString();
const next = (state: Parameters<typeof withLocalState>[0] extends (state: infer S) => unknown ? S : never, key: "lender" | "job" | "attempt" | "product" | "version" | "edit" | "refresh") => state.nextIds[key]++;

function lenderFromImport(state: Parameters<typeof withLocalState>[0] extends (state: infer S) => unknown ? S : never, userId: number, lender: ImportedLender) {
  const timestamp = now();
  const existing = state.lenders.find(item => item.userId === userId && item.normalizedName === lender.normalizedName);
  if (existing) {
    Object.assign(existing, { name: lender.name, mainWebsiteUrl: lender.mainWebsiteUrl, productPageUrl: lender.productPageUrl, sourceWorkbook: lender.sourceWorkbook, sourceRow: lender.sourceRow, updatedAt: timestamp });
    return existing;
  }
  const created: LocalLender = { id: next(state, "lender"), userId, name: lender.name, normalizedName: lender.normalizedName, mainWebsiteUrl: lender.mainWebsiteUrl, productPageUrl: lender.productPageUrl, sourceWorkbook: lender.sourceWorkbook, sourceRow: lender.sourceRow, lastScrapedAt: null, scrapeStatus: "pending", lastErrorCategory: null, lastErrorMessage: null, createdAt: timestamp, updatedAt: timestamp };
  state.lenders.push(created);
  return created;
}

export async function syncLenders(userId: number, entries: ImportedLender[]) {
  return withLocalState(state => { entries.forEach(entry => lenderFromImport(state, userId, entry)); return { imported: entries.length }; });
}

export async function addManualLender(userId: number, input: { name: string; mainWebsiteUrl?: string | null; productPageUrl?: string | null }, normalizedName: string) {
  return withLocalState(state => lenderFromImport(state, userId, { name: input.name.trim(), normalizedName, mainWebsiteUrl: input.mainWebsiteUrl ?? null, productPageUrl: input.productPageUrl ?? null, sourceWorkbook: "Manual local entry", sourceRow: 0 }));
}

export async function getDashboard(userId: number) {
  return withLocalState(state => {
    const lenderRows = state.lenders.filter(item => item.userId === userId).sort((a, b) => a.name.localeCompare(b.name));
    const productRows = state.products.filter(item => item.userId === userId);
    const productCount = new Map<number, number>();
    productRows.filter(item => item.lifecycle !== "withdrawn").forEach(item => productCount.set(item.lenderId, (productCount.get(item.lenderId) ?? 0) + 1));
    const latestFailureByLender = new Map<number, (typeof state.attempts)[number]>();
    state.attempts
      .filter(item => item.status === "failed")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .forEach(attempt => {
        if (!latestFailureByLender.has(attempt.lenderId)) latestFailureByLender.set(attempt.lenderId, attempt);
      });
    return {
      summary: { lenders: lenderRows.length, currentProducts: productRows.filter(item => item.lifecycle === "current").length, pendingReview: productRows.filter(item => item.reviewStatus === "needs_review").length, failedLenders: lenderRows.filter(item => item.scrapeStatus === "failed").length },
      lenders: lenderRows.map(item => ({ ...item, productCount: productCount.get(item.id) ?? 0 })),
      jobs: state.jobs.filter(item => item.userId === userId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, 8),
      errors: Array.from(latestFailureByLender.values()).slice(0, 8).map(attempt => ({ attempt, lenderName: state.lenders.find(item => item.id === attempt.lenderId)?.name ?? "Unknown lender" })),
    };
  });
}

export async function createJob(userId: number, lenderId: number | null, trigger: "manual" | "retry" | "scheduled" | "sheet_sync") {
  return withLocalState(state => {
    const targets = state.lenders.filter(item => item.userId === userId && (lenderId === null || item.id === lenderId) && Boolean(item.productPageUrl || item.mainWebsiteUrl));
    if (lenderId && targets.length === 0) throw new Error("The selected lender does not have a runnable URL.");
    const timestamp = now();
    const job = { id: next(state, "job"), userId, lenderId, trigger, status: "queued" as const, totalLenders: targets.length, processedLenders: 0, successfulLenders: 0, failedLenders: 0, errorMessage: null, requestedAt: timestamp, startedAt: null, finishedAt: null };
    state.jobs.push(job); return { id: job.id, totalLenders: targets.length };
  });
}

export async function getJob(userId: number, jobId: number) { return withLocalState(state => state.jobs.find(item => item.userId === userId && item.id === jobId) ?? null); }
export async function getQueuedJob(userId: number) { return withLocalState(state => state.jobs.filter(item => item.userId === userId && item.status === "queued").sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0] ?? null); }
export async function cancelQueuedJob(userId: number, jobId: number) { return withLocalState(state => { const job = state.jobs.find(item => item.userId === userId && item.id === jobId); if (!job) throw new Error("Scrape job not found."); if (job.status !== "queued") throw new Error("Only a queued, inactive scrape job can be cancelled."); job.status = "cancelled"; job.finishedAt = now(); return job; }); }
export async function listJobTargets(userId: number, jobId: number) { return withLocalState(state => { const job = state.jobs.find(item => item.userId === userId && item.id === jobId); if (!job) throw new Error("Scrape job not found."); return state.lenders.filter(item => item.userId === userId && (job.lenderId === null || item.id === job.lenderId)).sort((a, b) => a.id - b.id); }); }
export async function setJobRunning(jobId: number) { return withLocalState(state => { const job = state.jobs.find(item => item.id === jobId); if (job) { job.status = "running"; job.startedAt = now(); } }); }
export async function updateJobProgress(jobId: number, patch: { processedLenders: number; successfulLenders: number; failedLenders: number; status: "queued" | "completed" | "failed"; errorMessage?: string | null }) { return withLocalState(state => { const job = state.jobs.find(item => item.id === jobId); if (!job) return; Object.assign(job, patch); if (patch.status === "completed" || patch.status === "failed") job.finishedAt = now(); }); }
export async function markLenderRunning(lenderId: number) { return withLocalState(state => { const lender = state.lenders.find(item => item.id === lenderId); if (lender) Object.assign(lender, { scrapeStatus: "running", lastErrorCategory: null, lastErrorMessage: null, updatedAt: now() }); }); }
export async function markLenderResult(lenderId: number, status: "success" | "failed", error?: { category: string; message: string }) { return withLocalState(state => { const lender = state.lenders.find(item => item.id === lenderId); if (lender) Object.assign(lender, { scrapeStatus: status, lastScrapedAt: now(), lastErrorCategory: error?.category ?? null, lastErrorMessage: error?.message ?? null, updatedAt: now() }); }); }
export async function createAttempt(lenderId: number, scrapeJobId: number, targetUrl: string) { return withLocalState(state => { const attempt = { id: next(state, "attempt"), lenderId, scrapeJobId, targetUrl, status: "pending" as const, finalUrl: null, pageTitle: null, pageTextKey: null, screenshotKey: null, errorCategory: null, errorMessage: null, createdAt: now(), completedAt: null }; state.attempts.push(attempt); return attempt.id; }); }
export async function completeAttempt(attemptId: number, patch: { status: "success" | "failed"; finalUrl?: string; pageTitle?: string; pageTextKey?: string; screenshotKey?: string; errorCategory?: string; errorMessage?: string }) { return withLocalState(state => { const attempt = state.attempts.find(item => item.id === attemptId); if (attempt) Object.assign(attempt, patch, { completedAt: now() }); }); }

export async function persistExtractedProducts(userId: number, lenderId: number, scrapeJobId: number, extracted: Array<MortgageProductData & { confidence: number }>) {
  return withLocalState(state => {
    const existing = state.products.filter(item => item.userId === userId && item.lenderId === lenderId);
    const active = existing.filter(item => item.lifecycle === "current" || item.lifecycle === "new"); const fingerprints = new Set<string>(); let added = 0; let updated = 0;
    for (const candidate of extracted) {
      const { confidence, ...data } = candidate; const fingerprint = productFingerprint(data); fingerprints.add(fingerprint); const current = existing.find(item => item.fingerprint === fingerprint); const lifecycle = lifecycleForObservedRecord({ product: data, isKnown: Boolean(current), activeRateProductCount: active.length }); const timestamp = now();
      if (current) { Object.assign(current, { data, confidence: String(confidence), lifecycle, withdrawnAt: null, lastSeenAt: timestamp, latestJobId: scrapeJobId, updatedAt: timestamp }); state.productVersions.push({ id: next(state, "version"), productId: current.id, scrapeJobId, lifecycle, fingerprint, data, observedAt: timestamp }); updated += 1; }
      else { const product: LocalProduct = { id: next(state, "product"), userId, lenderId, fingerprint, lifecycle, reviewStatus: "needs_review", confidence: String(confidence), data, firstSeenAt: timestamp, lastSeenAt: timestamp, withdrawnAt: null, latestJobId: scrapeJobId, createdAt: timestamp, updatedAt: timestamp }; state.products.push(product); state.productVersions.push({ id: next(state, "version"), productId: product.id, scrapeJobId, lifecycle, fingerprint, data, observedAt: timestamp }); added += 1; }
    }
    let withdrawn = 0; for (const current of active) if (withdrawnFingerprints(existing, fingerprints).includes(current.fingerprint)) { current.lifecycle = "withdrawn"; current.withdrawnAt = now(); current.latestJobId = scrapeJobId; state.productVersions.push({ id: next(state, "version"), productId: current.id, scrapeJobId, lifecycle: "withdrawn", fingerprint: current.fingerprint, data: current.data, observedAt: now() }); withdrawn += 1; }
    return { added, updated, withdrawn };
  });
}

export async function getProducts(userId: number, lenderId?: number) { return withLocalState(state => state.products.filter(item => item.userId === userId && (lenderId === undefined || item.lenderId === lenderId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(product => ({ ...product, lenderName: state.lenders.find(item => item.id === product.lenderId)?.name ?? "Unknown lender" }))); }
export async function updateProduct(userId: number, productId: number, data: MortgageProductData, reviewStatus: ReviewStatus) { return withLocalState(state => { const product = state.products.find(item => item.userId === userId && item.id === productId); if (!product) throw new Error("Product not found."); state.productEdits.push({ id: next(state, "edit"), productId, userId, previousData: product.data, nextData: data, editedAt: now() }); Object.assign(product, { data, reviewStatus, fingerprint: productFingerprint(data), updatedAt: now() }); }); }
export async function getRefreshSettings(userId: number) { return withLocalState(state => state.refreshSettings.find(item => item.userId === userId) ?? null); }
export async function saveRefreshSettings(userId: number, input: { cronExpression: string; isEnabled: boolean; scheduleCronTaskUid?: string | null; nextExecutionAt?: Date | string | null }) { return withLocalState(state => { const existing = state.refreshSettings.find(item => item.userId === userId); const value = { cronExpression: input.cronExpression, isEnabled: input.isEnabled, scheduleCronTaskUid: input.scheduleCronTaskUid ?? existing?.scheduleCronTaskUid ?? null, nextExecutionAt: input.nextExecutionAt ? new Date(input.nextExecutionAt).toISOString() : null, updatedAt: now() }; if (existing) { Object.assign(existing, value); return existing; } const created = { id: next(state, "refresh"), userId, ...value }; state.refreshSettings.push(created); return created; }); }
export async function getRefreshSettingsByTaskUid(taskUid: string) { return withLocalState(state => state.refreshSettings.find(item => item.scheduleCronTaskUid === taskUid) ?? null); }
