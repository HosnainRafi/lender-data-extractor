import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browserCaptureMode, captureWithBrowser, localBrowserExecutable } from "./browserScraper";

const originalEndpoint = process.env.BROWSER_WS_ENDPOINT;
const originalLocalMode = process.env.LOCAL_MODE;

describe("local Chromium capture", () => {
  beforeEach(() => {
    process.env.BROWSER_WS_ENDPOINT = "wss://should-not-be-used.local";
    process.env.LOCAL_MODE = "true";
  });

  afterEach(() => {
    if (originalEndpoint) process.env.BROWSER_WS_ENDPOINT = originalEndpoint;
    else delete process.env.BROWSER_WS_ENDPOINT;
    if (originalLocalMode) process.env.LOCAL_MODE = originalLocalMode;
    else delete process.env.LOCAL_MODE;
  });

  it.skipIf(!localBrowserExecutable())("launches the local browser and renders a public page without a hosted endpoint", async () => {
    expect(browserCaptureMode()).toBe("local");
    const capture = await captureWithBrowser("https://example.com/");
    expect(capture.finalUrl).toContain("example.com");
    expect(capture.text).toContain("Example Domain");
    expect(capture.screenshot.byteLength).toBeGreaterThan(100);
  }, 60_000);
});
