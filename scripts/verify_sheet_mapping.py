from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from urllib.request import urlopen


SHEETS = [
    {
        "label": "Lender Data Update",
        "id": "1YAHBvkhX83RYZiuEjo4C6l55kdOo6DjkWWlsDzvyNno",
        "gid": "0",
    },
    {
        "label": "LENDER LIST - FINAL",
        "id": "1Tx0uHOEZqzgB8yufiemO3A6xRzAo0op0WocbQfiIY2A",
        "gid": "1794590520",
    },
]
OUTPUT = Path("/home/ubuntu/lender-data-extractor/docs/sheet-column-verification.json")


def download_header(sheet_id: str, gid: str) -> list[str]:
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    with urlopen(url, timeout=30) as response:
        decoded = response.read().decode("utf-8-sig")
    reader = csv.reader(io.StringIO(decoded))
    return next(reader)


def main() -> None:
    report = []
    for source in SHEETS:
        headers = download_header(source["id"], source["gid"])
        report.append(
            {
                "source": source["label"],
                "spreadsheet_id": source["id"],
                "gid": source["gid"],
                "column_g_index": 7,
                "column_g_header": headers[6] if len(headers) > 6 else None,
                "column_j_index": 10,
                "column_j_header": headers[9] if len(headers) > 9 else None,
                "column_count": len(headers),
            }
        )
    OUTPUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(OUTPUT)


if __name__ == "__main__":
    main()
