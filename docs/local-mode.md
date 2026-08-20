# Local-only operating model

Run `pnpm dev:local` to use the application without Docker, MySQL, hosted browser, hosted LLM, hosted authentication, or hosted artifact storage services. The app creates a local operator identity, launches a local Chrome/Chromium process, uses the deterministic parser, stores evidence under `local-artifacts/`, and serves those files through the local application. Lenders, jobs, products, review edits, and settings persist automatically in `local-data/lender-data.json`.

The local deterministic parser is deliberately review-first. It scans browser-rendered text for percentage rates, nearby LTV, term, and fixed/tracker terminology. It produces 40% confidence records and must not be interpreted as an automated verification of lender pricing or eligibility.

The supplied workbook is not a scraping input. It is needed only when an exact-format Excel export is required. In Windows PowerShell, from the project folder, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-reference-workbook.ps1 -SourcePath "C:\path\to\01-btl-mort_rates.xlsx"
```

This safely copies the workbook to `templates\01-btl-mort_rates.xlsx` without committing it to Git. JSON and dashboard review work with a manually entered lender URL alone.
