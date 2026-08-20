CREATE TABLE `lenders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`normalizedName` varchar(255) NOT NULL,
	`mainWebsiteUrl` text,
	`productPageUrl` text,
	`sourceWorkbook` varchar(128) NOT NULL,
	`sourceRow` int,
	`lastScrapedAt` timestamp,
	`scrapeStatus` enum('pending','running','success','failed') NOT NULL DEFAULT 'pending',
	`lastErrorCategory` enum('blocked','timeout','empty','invalid_url','browser','extraction','unknown'),
	`lastErrorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lenders_id` PRIMARY KEY(`id`),
	CONSTRAINT `lenders_user_name_unique` UNIQUE(`userId`,`normalizedName`)
);
--> statement-breakpoint
CREATE TABLE `product_edits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`userId` int NOT NULL,
	`previousData` json NOT NULL,
	`nextData` json NOT NULL,
	`editedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_edits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`scrapeJobId` int NOT NULL,
	`lifecycle` enum('current','new','withdrawn','additional') NOT NULL,
	`fingerprint` varchar(128) NOT NULL,
	`data` json NOT NULL,
	`observedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`lenderId` int NOT NULL,
	`fingerprint` varchar(128) NOT NULL,
	`lifecycle` enum('current','new','withdrawn','additional') NOT NULL DEFAULT 'current',
	`reviewStatus` enum('needs_review','approved','edited') NOT NULL DEFAULT 'needs_review',
	`confidence` decimal(5,4) NOT NULL DEFAULT '0',
	`data` json NOT NULL,
	`firstSeenAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`withdrawnAt` timestamp,
	`latestJobId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_lender_fingerprint_unique` UNIQUE(`lenderId`,`fingerprint`)
);
--> statement-breakpoint
CREATE TABLE `refresh_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`cronExpression` varchar(64) NOT NULL DEFAULT '0 0 3 * * *',
	`isEnabled` boolean NOT NULL DEFAULT false,
	`scheduleCronTaskUid` varchar(65),
	`nextExecutionAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `refresh_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_settings_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `scrape_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lenderId` int NOT NULL,
	`scrapeJobId` int NOT NULL,
	`status` enum('pending','running','success','failed') NOT NULL,
	`targetUrl` text NOT NULL,
	`finalUrl` text,
	`pageTitle` varchar(512),
	`pageTextKey` varchar(512),
	`screenshotKey` varchar(512),
	`errorCategory` enum('blocked','timeout','empty','invalid_url','browser','extraction','unknown'),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `scrape_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scrape_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`lenderId` int,
	`trigger` enum('manual','retry','scheduled','sheet_sync') NOT NULL DEFAULT 'manual',
	`status` enum('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
	`totalLenders` int NOT NULL DEFAULT 0,
	`processedLenders` int NOT NULL DEFAULT 0,
	`successfulLenders` int NOT NULL DEFAULT 0,
	`failedLenders` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`finishedAt` timestamp,
	CONSTRAINT `scrape_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `lenders_user_status_idx` ON `lenders` (`userId`,`scrapeStatus`);--> statement-breakpoint
CREATE INDEX `product_edits_product_idx` ON `product_edits` (`productId`,`editedAt`);--> statement-breakpoint
CREATE INDEX `product_versions_product_idx` ON `product_versions` (`productId`,`observedAt`);--> statement-breakpoint
CREATE INDEX `product_versions_job_idx` ON `product_versions` (`scrapeJobId`);--> statement-breakpoint
CREATE INDEX `products_user_lifecycle_idx` ON `products` (`userId`,`lifecycle`);--> statement-breakpoint
CREATE INDEX `products_lender_idx` ON `products` (`lenderId`);--> statement-breakpoint
CREATE INDEX `refresh_settings_task_uid_idx` ON `refresh_settings` (`scheduleCronTaskUid`);--> statement-breakpoint
CREATE INDEX `scrape_attempts_lender_created_idx` ON `scrape_attempts` (`lenderId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `scrape_attempts_job_idx` ON `scrape_attempts` (`scrapeJobId`);--> statement-breakpoint
CREATE INDEX `scrape_jobs_user_status_idx` ON `scrape_jobs` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `scrape_jobs_lender_idx` ON `scrape_jobs` (`lenderId`);