# Local verification record

The original local browser workflow was verified with a manually submitted lender URL and local Chromium capture of `https://example.com`. The app persisted a local operator, lender, successful scrape attempt, extracted evidence keys, and filesystem screenshot/text artifacts.

The current local mode replaces that database dependency with the repository-local JSON store at `local-data/lender-data.json`. A separate no-Docker smoke test covers the final local workflow.
