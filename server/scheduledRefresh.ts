import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { getRefreshSettingsByTaskUid } from "./lenderDb";
import { runNextScheduledRefreshSegment } from "./jobRunner";

export async function handleScheduledLenderRefresh(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const settings = await getRefreshSettingsByTaskUid(user.taskUid);
    if (!settings || !settings.isEnabled) return res.json({ ok: true, skipped: "disabled-or-orphan" });
    const job = await runNextScheduledRefreshSegment(settings.userId);
    return res.json({ ok: true, jobId: job?.id ?? null, status: job?.status ?? "no-lenders", processed: job?.processedLenders ?? 0, total: job?.totalLenders ?? 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduled lender refresh failed.";
    return res.status(500).json({ error: message, timestamp: new Date().toISOString(), context: { path: req.path } });
  }
}
