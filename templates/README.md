# Local reference workbook

The Excel exporter needs the exact user-supplied reference workbook to preserve its sheet names, headers, styles, and formulas. The workbook is deliberately **not committed** to this repository.

On Windows, copy it into this directory with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-reference-workbook.ps1 -SourcePath "C:\path\to\01-btl-mort_rates.xlsx"
```

This creates `templates\01-btl-mort_rates.xlsx`. The app will then export using the supplied workbook format.
