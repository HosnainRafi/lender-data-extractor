import { boolean, decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import type { MortgageProductData } from "../shared/lenderTypes";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const scrapeStatusValues = ["pending", "running", "success", "failed"] as const;
export const jobStatusValues = ["queued", "running", "completed", "failed", "cancelled"] as const;
export const jobTriggerValues = ["manual", "retry", "scheduled", "sheet_sync"] as const;
export const errorCategoryValues = ["blocked", "timeout", "empty", "invalid_url", "browser", "extraction", "unknown"] as const;
export const lifecycleValues = ["current", "new", "withdrawn", "additional"] as const;
export const reviewStatusValues = ["needs_review", "approved", "edited"] as const;

export const lenders = mysqlTable("lenders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  normalizedName: varchar("normalizedName", { length: 255 }).notNull(),
  mainWebsiteUrl: text("mainWebsiteUrl"),
  productPageUrl: text("productPageUrl"),
  sourceWorkbook: varchar("sourceWorkbook", { length: 128 }).notNull(),
  sourceRow: int("sourceRow"),
  lastScrapedAt: timestamp("lastScrapedAt"),
  scrapeStatus: mysqlEnum("scrapeStatus", scrapeStatusValues).notNull().default("pending"),
  lastErrorCategory: mysqlEnum("lastErrorCategory", errorCategoryValues),
  lastErrorMessage: text("lastErrorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("lenders_user_status_idx").on(table.userId, table.scrapeStatus),
  uniqueIndex("lenders_user_name_unique").on(table.userId, table.normalizedName),
]);

export const scrapeJobs = mysqlTable("scrape_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  lenderId: int("lenderId"),
  trigger: mysqlEnum("trigger", jobTriggerValues).notNull().default("manual"),
  status: mysqlEnum("status", jobStatusValues).notNull().default("queued"),
  totalLenders: int("totalLenders").notNull().default(0),
  processedLenders: int("processedLenders").notNull().default(0),
  successfulLenders: int("successfulLenders").notNull().default(0),
  failedLenders: int("failedLenders").notNull().default(0),
  errorMessage: text("errorMessage"),
  requestedAt: timestamp("requestedAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
}, table => [
  index("scrape_jobs_user_status_idx").on(table.userId, table.status),
  index("scrape_jobs_lender_idx").on(table.lenderId),
]);

export const scrapeAttempts = mysqlTable("scrape_attempts", {
  id: int("id").autoincrement().primaryKey(),
  lenderId: int("lenderId").notNull(),
  scrapeJobId: int("scrapeJobId").notNull(),
  status: mysqlEnum("status", scrapeStatusValues).notNull(),
  targetUrl: text("targetUrl").notNull(),
  finalUrl: text("finalUrl"),
  pageTitle: varchar("pageTitle", { length: 512 }),
  pageTextKey: varchar("pageTextKey", { length: 512 }),
  screenshotKey: varchar("screenshotKey", { length: 512 }),
  errorCategory: mysqlEnum("errorCategory", errorCategoryValues),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, table => [
  index("scrape_attempts_lender_created_idx").on(table.lenderId, table.createdAt),
  index("scrape_attempts_job_idx").on(table.scrapeJobId),
]);

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  lenderId: int("lenderId").notNull(),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
  lifecycle: mysqlEnum("lifecycle", lifecycleValues).notNull().default("current"),
  reviewStatus: mysqlEnum("reviewStatus", reviewStatusValues).notNull().default("needs_review"),
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull().default("0"),
  data: json("data").$type<MortgageProductData>().notNull(),
  firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  withdrawnAt: timestamp("withdrawnAt"),
  latestJobId: int("latestJobId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("products_lender_fingerprint_unique").on(table.lenderId, table.fingerprint),
  index("products_user_lifecycle_idx").on(table.userId, table.lifecycle),
  index("products_lender_idx").on(table.lenderId),
]);

export const productVersions = mysqlTable("product_versions", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  scrapeJobId: int("scrapeJobId").notNull(),
  lifecycle: mysqlEnum("lifecycle", lifecycleValues).notNull(),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
  data: json("data").$type<MortgageProductData>().notNull(),
  observedAt: timestamp("observedAt").defaultNow().notNull(),
}, table => [
  index("product_versions_product_idx").on(table.productId, table.observedAt),
  index("product_versions_job_idx").on(table.scrapeJobId),
]);

export const productEdits = mysqlTable("product_edits", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  userId: int("userId").notNull(),
  previousData: json("previousData").$type<MortgageProductData>().notNull(),
  nextData: json("nextData").$type<MortgageProductData>().notNull(),
  editedAt: timestamp("editedAt").defaultNow().notNull(),
}, table => [index("product_edits_product_idx").on(table.productId, table.editedAt)]);

export const refreshSettings = mysqlTable("refresh_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  cronExpression: varchar("cronExpression", { length: 64 }).notNull().default("0 0 3 * * *"),
  isEnabled: boolean("isEnabled").notNull().default(false),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  nextExecutionAt: timestamp("nextExecutionAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("refresh_settings_user_unique").on(table.userId),
  index("refresh_settings_task_uid_idx").on(table.scheduleCronTaskUid),
]);
