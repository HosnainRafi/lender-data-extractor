import { afterEach, describe, expect, it } from "vitest";
import { manualChallengeRecoveryAvailability } from "./browserScraper";

const originalLocalMode = process.env.LOCAL_MODE;

afterEach(() => {
  if (originalLocalMode === undefined) delete process.env.LOCAL_MODE;
  else process.env.LOCAL_MODE = originalLocalMode;
});

describe("manual challenge recovery availability", () => {
  it("refuses visible-browser recovery outside local mode", () => {
    process.env.LOCAL_MODE = "false";
    expect(manualChallengeRecoveryAvailability()).toEqual(expect.objectContaining({
      available: false,
      message: expect.stringContaining("run locally"),
    }));
  });

  it("describes the user-completed verification flow when local mode is enabled", () => {
    process.env.LOCAL_MODE = "true";
    const availability = manualChallengeRecoveryAvailability();
    expect(availability.message).toContain("browser window");
    if (availability.available) expect(availability.message).toContain("Complete the challenge yourself");
    else expect(availability.message).toContain("Chrome or Chromium");
  });
});
