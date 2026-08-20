# Source Inspection Notes

## Google Sheets

The primary source is **Lender Data Update** (`1YAHBvkhX83RYZiuEjo4C6l55kdOo6DjkWWlsDzvyNno`, `gid=0`). Its visible rows identify lenders and a status/comment workflow. Several rows are marked as lacking data updates or missing downloadable product links, confirming the application needs page-capture diagnostics, review controls, retries, and non-silent failure states.

The secondary source is **LENDER LIST - FINAL** (`1Tx0uHOEZqzgB8yufiemO3A6xRzAo0op0WocbQfiIY2A`, `gid=1794590520`). It contains many category tabs, including Mortgage and several product-specific views. It is available as a read-only shared sheet in the inspected browser session.

For product imports, the application will preserve the user-specified mapping: **column G is the main lender website URL and column J is the product page URL**. The implementation must use the standard Google Sheets export endpoint only for the two source sheets; lender data itself will be captured only through the configured browser engine.

## Observed constraints

Some lenders expose products only in client-rendered pages or via website-specific flows. The app will record blocked, timed-out, inaccessible, and empty-page outcomes explicitly. It cannot ethically or reliably promise to defeat CAPTCHAs, authenticated pages, or access controls; those sources will require a permitted session or manual review.
