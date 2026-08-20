import { describe, expect, it } from "vitest";
import { normalizeLenderName, parseCsv } from "./sheetImport";

describe("Google Sheet source parsing", () => {
  it("preserves quoted commas and the fixed G/J positions in CSV rows", () => {
    const rows = parseCsv('Name,B,C,D,E,F,Website,H,I,Products\n"Alpha, Mortgage",,,,,,https://alpha.example,,,https://alpha.example/products\n');
    expect(rows[1]?.[0]).toBe("Alpha, Mortgage");
    expect(rows[1]?.[6]).toBe("https://alpha.example");
    expect(rows[1]?.[9]).toBe("https://alpha.example/products");
  });

  it("normalizes common lender legal suffixes for matching across both sources", () => {
    expect(normalizeLenderName("The Alpha Mortgages Ltd")).toBe("alpha");
    expect(normalizeLenderName("ALPHA-BANK PLC")).toBe("alpha");
  });
});
