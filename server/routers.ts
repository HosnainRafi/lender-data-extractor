import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookie } from "cookie";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { createHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { createReferenceWorkbook } from "./excelExport";
import { createAndRunJob, recoverBlockedLender, runJobSegment } from "./jobRunner";
import { addManualLender, cancelQueuedJob, getDashboard, getProducts, getRefreshSettings, saveRefreshSettings, syncLenders, updateProduct } from "./lenderDb";
import { extractMortgageProducts } from "./productExtraction";
import { importConfiguredLenders, importFlexibleLenders } from "./sheetImport";

const productInput = z.object({
  code: z.string().nullable(), product: z.string().min(1), purpose: z.string().nullable(), maxLtv: z.number().nullable(), rate: z.number().nullable(), aprc: z.number().nullable(),
  productFee: z.number().nullable(), incentives: z.string().nullable(), cashback: z.number().nullable(), ercs: z.string().nullable(), endDate: z.string().nullable(), segment: z.string().nullable(),
  term: z.number().nullable(), basis: z.string().nullable(), blank: z.number().nullable(), sourceEvidence: z.array(z.string()), extractionNotes: z.string().nullable(),
});

const cronInput = z.string().regex(/^\d+\s+(\*|\d+(?:-\d+)?(?:\/\d+)?)(?:,\d+)*\s+(\*|\d+(?:-\d+)?(?:\/\d+)?)(?:,\d+)*\s+(\*|\d+(?:-\d+)?(?:\/\d+)?)(?:,\d+)*\s+(\*|\d+(?:-\d+)?(?:\/\d+)?)(?:,\d+)*\s+(\*|\d+(?:-\d+)?(?:\/\d+)?)(?:,\d+)*$/, "Use a six-field UTC cron expression, for example: 0 0 3 * * *");

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  lenders: router({
    dashboard: protectedProcedure.query(({ ctx }) => getDashboard(ctx.user.id)),
    syncSources: protectedProcedure.mutation(async ({ ctx }) => {
      const imported = await importConfiguredLenders();
      return syncLenders(ctx.user.id, imported);
    }),
    importSource: protectedProcedure.input(z.object({ sourceLabel: z.string().trim().max(160).optional(), sourceUrl: z.string().url().optional(), fileName: z.string().trim().max(255).optional(), fileBase64: z.string().max(21_000_000).optional() }).refine(input => Boolean(input.sourceUrl || input.fileBase64), { message: "Choose a file or provide a public spreadsheet link." })).mutation(async ({ ctx, input }) => {
      const imported = await importFlexibleLenders(input);
      return syncLenders(ctx.user.id, imported);
    }),
    addManual: protectedProcedure.input(z.object({ name: z.string().trim().min(2).max(160), mainWebsiteUrl: z.string().url().nullable().optional(), productPageUrl: z.string().url().nullable().optional() }).refine(input => Boolean(input.mainWebsiteUrl || input.productPageUrl), { message: "Provide a lender website or product-page URL." })).mutation(({ ctx, input }) => addManualLender(ctx.user.id, input)),
    run: protectedProcedure.input(z.object({ lenderId: z.number().int().positive().nullable(), trigger: z.enum(["manual", "retry"]).default("manual") })).mutation(({ ctx, input }) => createAndRunJob(ctx.user.id, input.lenderId, input.trigger)),
    recoverBlocked: protectedProcedure.input(z.object({ lenderId: z.number().int().positive() })).mutation(({ ctx, input }) => recoverBlockedLender(ctx.user.id, input.lenderId)),
    continueRun: protectedProcedure.input(z.object({ jobId: z.number().int().positive() })).mutation(({ ctx, input }) => runJobSegment(ctx.user.id, input.jobId)),
    cancelRun: protectedProcedure.input(z.object({ jobId: z.number().int().positive() })).mutation(({ ctx, input }) => cancelQueuedJob(ctx.user.id, input.jobId)),
    products: protectedProcedure.input(z.object({ lenderId: z.number().int().positive().optional() }).optional()).query(({ ctx, input }) => getProducts(ctx.user.id, input?.lenderId)),
    updateProduct: protectedProcedure.input(z.object({ productId: z.number().int().positive(), reviewStatus: z.enum(["needs_review", "approved", "edited"]), data: productInput })).mutation(({ ctx, input }) => updateProduct(ctx.user.id, input.productId, input.data, input.reviewStatus)),
    exportJson: protectedProcedure.input(z.object({ lenderId: z.number().int().positive().optional() }).optional()).query(({ ctx, input }) => getProducts(ctx.user.id, input?.lenderId)),
    exportWorkbook: protectedProcedure.input(z.object({ lenderId: z.number().int().positive().optional() }).optional()).mutation(async ({ ctx, input }) => {
      const host = ctx.req.get("host");
      if (!host) throw new Error("Unable to determine the application origin for the reference template.");
      const forwardedProtocol = ctx.req.headers["x-forwarded-proto"];
      const protocol = typeof forwardedProtocol === "string" ? forwardedProtocol : ctx.req.protocol;
      const products = await getProducts(ctx.user.id, input?.lenderId);
      return createReferenceWorkbook(`${protocol}://${host}`, products);
    }),
  }),
  refresh: router({
    get: protectedProcedure.query(({ ctx }) => getRefreshSettings(ctx.user.id)),
    save: protectedProcedure.input(z.object({ cronExpression: cronInput, isEnabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      const current = await getRefreshSettings(ctx.user.id);
      const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      if (input.isEnabled && !current?.scheduleCronTaskUid) {
        const created = await createHeartbeatJob({ name: `lender-refresh-${ctx.user.id}`, cron: input.cronExpression, path: "/api/scheduled/lender-refresh", payload: {}, description: "Autoscale-safe lender browser refresh" }, sessionToken);
        return saveRefreshSettings(ctx.user.id, { ...input, scheduleCronTaskUid: created.taskUid, nextExecutionAt: created.nextExecutionAt ? new Date(created.nextExecutionAt) : null });
      }
      if (current?.scheduleCronTaskUid) {
        const updated = await updateHeartbeatJob(current.scheduleCronTaskUid, { cron: input.cronExpression, enable: input.isEnabled }, sessionToken);
        return saveRefreshSettings(ctx.user.id, { ...input, scheduleCronTaskUid: current.scheduleCronTaskUid, nextExecutionAt: updated.nextExecutionAt ? new Date(updated.nextExecutionAt) : null });
      }
      return saveRefreshSettings(ctx.user.id, input);
    }),
  }),
});

export type AppRouter = typeof appRouter;
