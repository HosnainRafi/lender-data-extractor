import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { lenders, productEdits, products, productVersions, refreshSettings, scrapeAttempts, scrapeJobs } from "../drizzle/schema";
import type { MortgageProductData, ProductLifecycle, ReviewStatus } from "../shared/lenderTypes";
import { normalizeLenderName, type ImportedLender } from "./sheetImport";
import { productFingerprint } from "./productExtraction";
import { lifecycleForObservedRecord, withdrawnFingerprints } from "../shared/lifecycle";
import { isLocalMode } from "./localStore";
import * as local from "./localLenderDb";

async function requireDb() {
  const database = await getDb();
  if (!database) throw new Error("Database is unavailable.");
  return database;
}

export async function syncLenders(userId: number, sourceLenders: ImportedLender[]) {
  if (isLocalMode()) return local.syncLenders(userId, sourceLenders);
  const database = await requireDb();
  for (const lender of sourceLenders) {
    await database.insert(lenders).values({
      userId,
      name: lender.name,
      normalizedName: lender.normalizedName,
      mainWebsiteUrl: lender.mainWebsiteUrl,
      productPageUrl: lender.productPageUrl,
      sourceWorkbook: lender.sourceWorkbook,
      sourceRow: lender.sourceRow,
    }).onDuplicateKeyUpdate({
      set: {
        name: lender.name,
        mainWebsiteUrl: lender.mainWebsiteUrl,
        productPageUrl: lender.productPageUrl,
        sourceWorkbook: lender.sourceWorkbook,
        sourceRow: lender.sourceRow,
      },
    });
  }
  return { imported: sourceLenders.length };
}

export async function addManualLender(userId: number, input: { name: string; mainWebsiteUrl?: string | null; productPageUrl?: string | null }) {
  const name = input.name.trim();
  const normalizedName = normalizeLenderName(name);
  if (!normalizedName) throw new Error("A lender name is required.");
  if (!input.mainWebsiteUrl && !input.productPageUrl) throw new Error("Provide a lender website or product-page URL.");
  if (isLocalMode()) return local.addManualLender(userId, input, normalizedName);
  const database = await requireDb();
  await database.insert(lenders).values({
    userId, name, normalizedName, mainWebsiteUrl: input.mainWebsiteUrl ?? null, productPageUrl: input.productPageUrl ?? null,
    sourceWorkbook: "Manual local entry", sourceRow: 0,
  }).onDuplicateKeyUpdate({
    set: { name, mainWebsiteUrl: input.mainWebsiteUrl ?? null, productPageUrl: input.productPageUrl ?? null, sourceWorkbook: "Manual local entry", sourceRow: 0 },
  });
  return (await database.select().from(lenders).where(and(eq(lenders.userId, userId), eq(lenders.normalizedName, normalizedName))).limit(1))[0];
}

export async function getDashboard(userId: number) {
  if (isLocalMode()) return local.getDashboard(userId);
  const database = await requireDb();
  const [lenderRows, productRows, jobRows, errorRows] = await Promise.all([
    database.select().from(lenders).where(eq(lenders.userId, userId)).orderBy(asc(lenders.name)),
    database.select().from(products).where(eq(products.userId, userId)),
    database.select().from(scrapeJobs).where(eq(scrapeJobs.userId, userId)).orderBy(desc(scrapeJobs.requestedAt)).limit(8),
    database.select({ attempt: scrapeAttempts, lenderName: lenders.name })
      .from(scrapeAttempts)
      .innerJoin(lenders, eq(scrapeAttempts.lenderId, lenders.id))
      .where(and(eq(lenders.userId, userId), eq(scrapeAttempts.status, "failed")))
      .orderBy(desc(scrapeAttempts.createdAt)).limit(8),
  ]);
  const productCountByLender = new Map<number, number>();
  productRows.filter(product => product.lifecycle !== "withdrawn").forEach(product => {
    productCountByLender.set(product.lenderId, (productCountByLender.get(product.lenderId) ?? 0) + 1);
  });
  return {
    summary: {
      lenders: lenderRows.length,
      currentProducts: productRows.filter(product => product.lifecycle === "current").length,
      pendingReview: productRows.filter(product => product.reviewStatus === "needs_review").length,
      failedLenders: lenderRows.filter(lender => lender.scrapeStatus === "failed").length,
    },
    lenders: lenderRows.map(lender => ({ ...lender, productCount: productCountByLender.get(lender.id) ?? 0 })),
    jobs: jobRows,
    errors: errorRows,
  };
}

export async function createJob(userId: number, lenderId: number | null, trigger: "manual" | "retry" | "scheduled" | "sheet_sync") {
  if (isLocalMode()) return local.createJob(userId, lenderId, trigger);
  const database = await requireDb();
  const targets = lenderId
    ? await database.select().from(lenders).where(and(eq(lenders.id, lenderId), eq(lenders.userId, userId)))
    : await database.select().from(lenders).where(eq(lenders.userId, userId));
  const runnable = targets.filter(lender => Boolean(lender.productPageUrl || lender.mainWebsiteUrl));
  if (lenderId && runnable.length === 0) throw new Error("The selected lender does not have a runnable URL.");
  const result = await database.insert(scrapeJobs).values({ userId, lenderId, trigger, totalLenders: runnable.length, status: "queued" });
  return { id: Number(result[0].insertId), totalLenders: runnable.length };
}

export async function getJob(userId: number, jobId: number) {
  if (isLocalMode()) return local.getJob(userId, jobId);
  const database = await requireDb();
  return (await database.select().from(scrapeJobs).where(and(eq(scrapeJobs.id, jobId), eq(scrapeJobs.userId, userId))).limit(1))[0] ?? null;
}

export async function getQueuedJob(userId: number) {
  if (isLocalMode()) return local.getQueuedJob(userId);
  const database = await requireDb();
  return (await database.select().from(scrapeJobs).where(and(eq(scrapeJobs.userId, userId), eq(scrapeJobs.status, "queued"))).orderBy(asc(scrapeJobs.requestedAt)).limit(1))[0] ?? null;
}

export async function cancelQueuedJob(userId: number, jobId: number) {
  if (isLocalMode()) return local.cancelQueuedJob(userId, jobId);
  const database = await requireDb();
  const job = await getJob(userId, jobId);
  if (!job) throw new Error("Scrape job not found.");
  if (job.status !== "queued") throw new Error("Only a queued, inactive scrape job can be cancelled.");
  await database.update(scrapeJobs).set({ status: "cancelled", finishedAt: new Date() }).where(and(eq(scrapeJobs.id, jobId), eq(scrapeJobs.userId, userId)));
  return getJob(userId, jobId);
}

export async function listJobTargets(userId: number, jobId: number) {
  if (isLocalMode()) return local.listJobTargets(userId, jobId);
  const job = await getJob(userId, jobId);
  if (!job) throw new Error("Scrape job not found.");
  const database = await requireDb();
  if (job.lenderId) return database.select().from(lenders).where(and(eq(lenders.id, job.lenderId), eq(lenders.userId, userId)));
  return database.select().from(lenders).where(eq(lenders.userId, userId)).orderBy(asc(lenders.id));
}

export async function setJobRunning(jobId: number) {
  if (isLocalMode()) return local.setJobRunning(jobId);
  const database = await requireDb();
  await database.update(scrapeJobs).set({ status: "running", startedAt: new Date() }).where(eq(scrapeJobs.id, jobId));
}

export async function updateJobProgress(jobId: number, patch: { processedLenders: number; successfulLenders: number; failedLenders: number; status: "queued" | "completed" | "failed"; errorMessage?: string | null }) {
  if (isLocalMode()) return local.updateJobProgress(jobId, patch);
  const database = await requireDb();
  await database.update(scrapeJobs).set({ ...patch, finishedAt: patch.status === "completed" || patch.status === "failed" ? new Date() : null }).where(eq(scrapeJobs.id, jobId));
}

export async function markLenderRunning(lenderId: number) {
  if (isLocalMode()) return local.markLenderRunning(lenderId);
  const database = await requireDb();
  await database.update(lenders).set({ scrapeStatus: "running", lastErrorCategory: null, lastErrorMessage: null }).where(eq(lenders.id, lenderId));
}

export async function markLenderResult(lenderId: number, status: "success" | "failed", error?: { category: "blocked" | "timeout" | "empty" | "invalid_url" | "browser" | "extraction" | "unknown"; message: string }) {
  if (isLocalMode()) return local.markLenderResult(lenderId, status, error);
  const database = await requireDb();
  await database.update(lenders).set({
    scrapeStatus: status,
    lastScrapedAt: new Date(),
    lastErrorCategory: error?.category ?? null,
    lastErrorMessage: error?.message ?? null,
  }).where(eq(lenders.id, lenderId));
}

export async function createAttempt(lenderId: number, scrapeJobId: number, targetUrl: string) {
  if (isLocalMode()) return local.createAttempt(lenderId, scrapeJobId, targetUrl);
  const database = await requireDb();
  const result = await database.insert(scrapeAttempts).values({ lenderId, scrapeJobId, targetUrl, status: "pending" });
  return Number(result[0].insertId);
}

export async function completeAttempt(attemptId: number, patch: { status: "success" | "failed"; finalUrl?: string; pageTitle?: string; pageTextKey?: string; screenshotKey?: string; errorCategory?: "blocked" | "timeout" | "empty" | "invalid_url" | "browser" | "extraction" | "unknown"; errorMessage?: string }) {
  if (isLocalMode()) return local.completeAttempt(attemptId, patch);
  const database = await requireDb();
  await database.update(scrapeAttempts).set({ ...patch, completedAt: new Date() }).where(eq(scrapeAttempts.id, attemptId));
}

export async function persistExtractedProducts(userId: number, lenderId: number, scrapeJobId: number, extracted: Array<MortgageProductData & { confidence: number }>) {
  if (isLocalMode()) return local.persistExtractedProducts(userId, lenderId, scrapeJobId, extracted);
  const database = await requireDb();
  const existing = await database.select().from(products).where(and(eq(products.userId, userId), eq(products.lenderId, lenderId)));
  const activeRateProducts = existing.filter(product => product.lifecycle === "current" || product.lifecycle === "new");
  const existingByFingerprint = new Map(existing.map(product => [product.fingerprint, product]));
  const seenFingerprints = new Set<string>();
  let added = 0;
  let updated = 0;
  for (const candidate of extracted) {
    const { confidence, ...data } = candidate;
    const fingerprint = productFingerprint(data);
    seenFingerprints.add(fingerprint);
    const current = existingByFingerprint.get(fingerprint);
    const lifecycle = lifecycleForObservedRecord({ product: data, isKnown: Boolean(current), activeRateProductCount: activeRateProducts.length });
    if (current) {
      await database.update(products).set({ data, confidence: String(confidence), lifecycle, withdrawnAt: null, lastSeenAt: new Date(), latestJobId: scrapeJobId }).where(eq(products.id, current.id));
      await database.insert(productVersions).values({ productId: current.id, scrapeJobId, lifecycle, fingerprint, data });
      updated += 1;
    } else {
      const result = await database.insert(products).values({ userId, lenderId, fingerprint, lifecycle, reviewStatus: "needs_review", confidence: String(confidence), data, latestJobId: scrapeJobId });
      const productId = Number(result[0].insertId);
      await database.insert(productVersions).values({ productId, scrapeJobId, lifecycle, fingerprint, data });
      added += 1;
    }
  }
  let withdrawn = 0;
  const missingActiveFingerprints = new Set(withdrawnFingerprints(existing, seenFingerprints));
  for (const current of activeRateProducts) {
    if (!missingActiveFingerprints.has(current.fingerprint)) continue;
    await database.update(products).set({ lifecycle: "withdrawn", withdrawnAt: new Date(), latestJobId: scrapeJobId }).where(eq(products.id, current.id));
    await database.insert(productVersions).values({ productId: current.id, scrapeJobId, lifecycle: "withdrawn", fingerprint: current.fingerprint, data: current.data });
    withdrawn += 1;
  }
  return { added, updated, withdrawn };
}

export async function getProducts(userId: number, lenderId?: number) {
  if (isLocalMode()) return local.getProducts(userId, lenderId);
  const database = await requireDb();
  const productRows = await database.select().from(products).where(lenderId ? and(eq(products.userId, userId), eq(products.lenderId, lenderId)) : eq(products.userId, userId)).orderBy(desc(products.updatedAt));
  const lenderIds = Array.from(new Set(productRows.map(product => product.lenderId)));
  const lenderRows = lenderIds.length ? await database.select().from(lenders).where(inArray(lenders.id, lenderIds)) : [];
  const names = new Map(lenderRows.map(lender => [lender.id, lender.name]));
  return productRows.map(product => ({ ...product, lenderName: names.get(product.lenderId) ?? "Unknown lender" }));
}

export async function updateProduct(userId: number, productId: number, data: MortgageProductData, reviewStatus: ReviewStatus) {
  if (isLocalMode()) return local.updateProduct(userId, productId, data, reviewStatus);
  const database = await requireDb();
  const current = (await database.select().from(products).where(and(eq(products.id, productId), eq(products.userId, userId))).limit(1))[0];
  if (!current) throw new Error("Product not found.");
  await database.insert(productEdits).values({ productId, userId, previousData: current.data, nextData: data });
  await database.update(products).set({ data, reviewStatus, fingerprint: productFingerprint(data), updatedAt: new Date() }).where(eq(products.id, productId));
}

export async function getRefreshSettings(userId: number) {
  if (isLocalMode()) return local.getRefreshSettings(userId);
  const database = await requireDb();
  return (await database.select().from(refreshSettings).where(eq(refreshSettings.userId, userId)).limit(1))[0] ?? null;
}

export async function saveRefreshSettings(userId: number, input: { cronExpression: string; isEnabled: boolean; scheduleCronTaskUid?: string | null; nextExecutionAt?: Date | null }) {
  if (isLocalMode()) return local.saveRefreshSettings(userId, input);
  const database = await requireDb();
  await database.insert(refreshSettings).values({ userId, ...input }).onDuplicateKeyUpdate({ set: input });
  return getRefreshSettings(userId);
}

export async function getRefreshSettingsByTaskUid(taskUid: string) {
  if (isLocalMode()) return local.getRefreshSettingsByTaskUid(taskUid);
  const database = await requireDb();
  return (await database.select().from(refreshSettings).where(eq(refreshSettings.scheduleCronTaskUid, taskUid)).limit(1))[0] ?? null;
}
