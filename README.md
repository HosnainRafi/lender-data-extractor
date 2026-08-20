# Lender Data Extractor

This is a **local-first mortgage-product capture workspace**. It opens public lender pages with Chrome/Chromium, retains the rendered-page evidence, extracts reviewable product records, and exports JSON or a workbook based on the supplied `01-btl-mort_rates.xlsx` template.

> **Local manual mode does not need a hosted browser service, hosted AI extraction, S3 storage, or an XLSX input file for every lender.** It stores data, screenshots, and downloads on your computer.

## What you need

| Requirement | Why it is needed |
| --- | --- |
| Node.js 22+ with npm or pnpm | Runs the web application and local file-backed data store. |
| Google Chrome or Chromium | Renders JavaScript lender pages through a real local browser. |
| `01-btl-mort_rates.xlsx` | Needed **only** for strict-format Excel export. |

## Run locally

```bat
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd lender-data-extractor
npm install

:: Start the local-only application — no Docker, database command, API key, or .env file is needed.
npm run dev:local
```

Open the URL printed in the terminal, usually `http://localhost:3000`. The local store is created automatically in `local-data/lender-data.json`. If Chrome is not in a normal location, create a `.env` file containing `BROWSER_EXECUTABLE_PATH=/full/path/to/chrome`; the app recognizes common Windows, macOS, and Linux Chrome paths automatically.

### One-time Excel template setup

The first time you select **Export workbook**, install your original reference file by running this command in the project folder. Replace the source path with wherever you saved the file:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-reference-workbook.ps1 -SourcePath "C:\Users\hp\Downloads\01-btl-mort_rates.xlsx"
```

The helper copies it to `templates\01-btl-mort_rates.xlsx`. Restart `npm run dev:local` only if the app was already open when you ran the helper. JSON export and single-lender scraping do not require this file.

## Use one lender link manually

1. Open the dashboard and select **Add lender link**.
2. Enter the lender name and paste either its **direct product page URL** (best) or its main website URL.
3. Select **Add and run**. Chrome/Chromium renders the page locally; the app saves the visible text and screenshot in `local-artifacts/`.
4. Review the records in **Product review queue**, correct incomplete fields, and mark them approved or edited.
5. Use the lender-row download button for JSON, or use **Export workbook** for the reference-format XLSX file.

You **do not need to give the full XLSX file** to scrape one lender or download JSON. The reference workbook is required only when you want an output file that matches its prescribed sheet names, headers, and formatting. You also do **not** need either Google Sheet for manual use.

## Optional Google Sheet import

The **Sync sheets** control imports the two configured public Google Sheets and uses **column G** as the main website URL and **column J** as the product-page URL. This is optional; direct manual entry is preferable when you want to work one lender at a time.

## Accuracy and website access

The local no-API extractor is deterministic: it looks for visible rate, LTV, term, and product hints in the browser-rendered page. It intentionally assigns **40% confidence** and requires review. It is helpful for structured public product tables, but it cannot honestly be guaranteed to be **90% or 100% correct** across every lender site.

> No tool can reliably collect every website. Login-only portals, CAPTCHAs, WAF/anti-bot challenges, robots restrictions, personalized pricing, PDFs/images, and ambiguous product wording may produce no usable record or require direct manual entry. Do not bypass access controls. Treat the original lender page and your review as the source of truth before publishing or relying on data.

For better consistency without a hosted AI service, use direct product/rate pages instead of homepages, run one lender at a time, preserve the screenshot evidence, and review all records before Excel export.

## Local data and cleanup

| Location | Contents |
| --- | --- |
| `local-data/lender-data.json` | Lenders, jobs, products, review decisions, schedules, and history. |
| `local-artifacts/` | Captured text, screenshots, and exported workbook files. |
| `templates/01-btl-mort_rates.xlsx` | Your local Excel reference template; do not commit it if it is confidential. |

Stop the application with `Ctrl+C`. Delete `local-data/` only if you intentionally want to remove all locally stored lender data.
