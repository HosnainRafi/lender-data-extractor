ALTER TABLE `lenders`
  ADD COLUMN `resiProductsUrl` text NULL AFTER `productPageUrl`,
  ADD COLUMN `btlProductsUrl` text NULL AFTER `resiProductsUrl`,
  ADD COLUMN `downloadMethod` text NULL AFTER `btlProductsUrl`,
  ADD COLUMN `resiDownloadUrl` text NULL AFTER `downloadMethod`,
  ADD COLUMN `btlDownloadUrl` text NULL AFTER `resiDownloadUrl`;
