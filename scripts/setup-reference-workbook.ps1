param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$destinationDirectory = Join-Path $projectRoot "templates"
$destinationPath = Join-Path $destinationDirectory "01-btl-mort_rates.xlsx"

if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
  throw "Workbook not found: $SourcePath"
}

New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
Copy-Item -LiteralPath $SourcePath -Destination $destinationPath -Force
Write-Host "Reference workbook installed: $destinationPath"
Write-Host "Restart npm run dev:local if it is already running, then choose Export workbook."
