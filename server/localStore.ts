import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MortgageProductData } from "../shared/lenderTypes";

export type LocalLender = {
  id: number; userId: number; name: string; normalizedName: string; mainWebsiteUrl: string | null; productPageUrl: string | null;
  sourceWorkbook: string; sourceRow: number | null; lastScrapedAt: string | null; scrapeStatus: "pending" | "running" | "success" | "failed";
  lastErrorCategory: string | null; lastErrorMessage: string | null; createdAt: string; updatedAt: string;
};

export type LocalJob = {
  id: number; userId: number; lenderId: number | null; trigger: "manual" | "retry" | "scheduled" | "sheet_sync";
  status: "queued" | "running" | "completed" | "failed" | "cancelled"; totalLenders: number; processedLenders: number;
  successfulLenders: number; failedLenders: number; errorMessage: string | null; requestedAt: string; startedAt: string | null; finishedAt: string | null;
};

export type LocalAttempt = {
  id: number; lenderId: number; scrapeJobId: number; status: "pending" | "running" | "success" | "failed"; targetUrl: string;
  finalUrl: string | null; pageTitle: string | null; pageTextKey: string | null; screenshotKey: string | null; errorCategory: string | null;
  errorMessage: string | null; createdAt: string; completedAt: string | null;
};

export type LocalProduct = {
  id: number; userId: number; lenderId: number; fingerprint: string; lifecycle: "current" | "new" | "withdrawn" | "additional";
  reviewStatus: "needs_review" | "approved" | "edited"; confidence: string; data: MortgageProductData; firstSeenAt: string; lastSeenAt: string;
  withdrawnAt: string | null; latestJobId: number | null; createdAt: string; updatedAt: string;
};

export type LocalState = {
  version: 1;
  nextIds: { lender: number; job: number; attempt: number; product: number; version: number; edit: number; refresh: number };
  lenders: LocalLender[]; jobs: LocalJob[]; attempts: LocalAttempt[]; products: LocalProduct[];
  productVersions: Array<Record<string, unknown>>; productEdits: Array<Record<string, unknown>>;
  refreshSettings: Array<{ id: number; userId: number; cronExpression: string; isEnabled: boolean; scheduleCronTaskUid: string | null; nextExecutionAt: string | null; updatedAt: string }>;
};

export const isLocalMode = () => process.env.LOCAL_MODE === "true";

function createState(): LocalState {
  return {
    version: 1,
    nextIds: { lender: 1, job: 1, attempt: 1, product: 1, version: 1, edit: 1, refresh: 1 },
    lenders: [], jobs: [], attempts: [], products: [], productVersions: [], productEdits: [], refreshSettings: [],
  };
}

function dataPath() {
  return path.join(process.env.LOCAL_DATA_DIR ?? path.join(process.cwd(), "local-data"), "lender-data.json");
}

function normalizeState(input: Partial<LocalState>): LocalState {
  const base = createState();
  return {
    ...base,
    ...input,
    nextIds: { ...base.nextIds, ...(input.nextIds ?? {}) },
    lenders: input.lenders ?? [], jobs: input.jobs ?? [], attempts: input.attempts ?? [], products: input.products ?? [],
    productVersions: input.productVersions ?? [], productEdits: input.productEdits ?? [], refreshSettings: input.refreshSettings ?? [],
  };
}

async function loadState() {
  try {
    return normalizeState(JSON.parse(await readFile(dataPath(), "utf8")) as Partial<LocalState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createState();
    throw new Error(`Unable to read local data store: ${(error as Error).message}`);
  }
}

async function saveState(state: LocalState) {
  const file = dataPath();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

let serial: Promise<void> = Promise.resolve();

export async function withLocalState<T>(operation: (state: LocalState) => T | Promise<T>): Promise<T> {
  if (!isLocalMode()) throw new Error("The local data store is only available when LOCAL_MODE=true.");
  const run = serial.then(async () => {
    const state = await loadState();
    const result = await operation(state);
    await saveState(state);
    return result;
  });
  serial = run.then(() => undefined, () => undefined);
  return run;
}
