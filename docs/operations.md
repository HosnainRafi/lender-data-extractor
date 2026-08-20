# Lender Data Extractor — Operations Guide

## Source synchronization contract

The application synchronizes the two user-supplied Google Sheets through their public CSV export endpoints. It uses **column G** (zero-based index `6`) as the lender main website URL and **column J** (zero-based index `9`) as the product page URL. The primary sheet contributes the lender directory and the second sheet is used as a normalized-name fallback when a URL is missing. Only `http` and `https` URLs are accepted; other protocols and malformed values are ignored.

## Browser-only capture workflow

Every lender capture runs through the configured remote Chromium connection. The application navigates with a browser session, waits for rendered body text, captures a full-page screenshot, records a normalized text artifact, and then requests a schema-constrained AI extraction. It does not use a plain HTTP-page-fetch fallback. The persisted job model limits each request to six lender captures so the process remains compatible with Autoscale request timeouts; unprocessed lenders stay queued for the next manual continuation or scheduled tick.

## Extraction, review, and exports

Each extracted record stores source evidence, extraction confidence, and review status. Reviewers can correct data before export and download all product data as JSON. A deliberately identified supplementary record is classified as **additional** and remains available to review and JSON export; it is not forced into a mortgage-rate table because the supplied **Additional** tab is editorial source material. The Excel exporter starts from the supplied `01-btl-mort_rates.xlsx` template and modifies only the **Current Products**, **New Products**, and **Withdrawn Products** sheets. It retains the supplied **Introduction** and **Additional** sheets unchanged, along with the reference sheet names, headers, templates, and number formats.

## Refresh scheduling on Autoscale hosting

The Refresh panel accepts a six-field UTC cron expression. When enabled, the scheduled endpoint authenticates the platform cron call and runs one persisted queue segment. This is durable and restart-safe, but it is not an always-resident worker: large lender lists may require multiple ticks or manual **Continue** actions. The dashboard exposes queued progress and allows cancellation only while a job is inactive.

## Known access limitations

No technical solution can guarantee capture of every public lender page. Sites that require account login, multi-factor authentication, CAPTCHA completion, explicit consent, bot-allowlisting, or a licensed data feed may block the remote browser. The dashboard records these cases as blocked, timeout, empty, browser, or extraction failures and provides one-click retry after the upstream condition is resolved. Always confirm that the lender’s terms, robots policy, and applicable data-use rules allow the intended collection and refresh frequency.

## Verification completed

The project test suite verifies source CSV quoting and G/J alignment, lender-name normalization, the five required workbook sheet names, the 15-column product mapping, reference workbook headers, template font preservation, and unchanged support-sheet values. Desktop and mobile dashboard layouts were also reviewed after the final build.
