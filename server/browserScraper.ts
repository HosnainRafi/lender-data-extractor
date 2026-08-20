import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

export type BrowserCapture = {
  finalUrl: string;
  title: string;
  text: string;
  screenshot: Uint8Array;
};

export class BrowserCaptureError extends Error {
  constructor(message: string, public readonly category: "blocked" | "timeout" | "empty" | "invalid_url" | "browser" = "browser") {
    super(message);
  }
}

const BLOCKED_MARKERS = ["captcha", "verify you are human", "access denied", "unusual traffic", "cf-chl-", "just a moment", "perimeterx"];
const LOCAL_BROWSER_CANDIDATES = [
  process.env.BROWSER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter((value): value is string => Boolean(value));

function validateUrl(url: string): URL {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Only HTTP(S) URLs can be captured.");
    return parsed;
  } catch {
    throw new BrowserCaptureError("The lender source URL is invalid.", "invalid_url");
  }
}

export function localBrowserExecutable(): string | undefined {
  return LOCAL_BROWSER_CANDIDATES.find(candidate => existsSync(candidate));
}

export function browserCaptureMode(): "remote" | "local" | "unconfigured" {
  if (process.env.LOCAL_MODE !== "true" && process.env.BROWSER_WS_ENDPOINT) return "remote";
  return localBrowserExecutable() ? "local" : "unconfigured";
}

export async function captureWithBrowser(targetUrl: string): Promise<BrowserCapture> {
  validateUrl(targetUrl);
  let browser: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
  let disconnectOnly = false;
  try {
    if (process.env.LOCAL_MODE !== "true" && process.env.BROWSER_WS_ENDPOINT) {
      browser = await puppeteer.connect({ browserWSEndpoint: process.env.BROWSER_WS_ENDPOINT });
      disconnectOnly = true;
    } else {
      const executablePath = localBrowserExecutable();
      if (!executablePath) throw new BrowserCaptureError("No local Chromium executable was found. Install Google Chrome or Chromium and set BROWSER_EXECUTABLE_PATH.", "browser");
      browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
    await page.setUserAgent("Mozilla/5.0 (compatible; MortgageDataExtractor/1.0; +local browser capture)");
    page.setDefaultNavigationTimeout(45_000);
    page.setDefaultTimeout(45_000);
    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 45_000 });
    await page.waitForFunction(() => document.body?.innerText?.trim().length > 40, { timeout: 12_000 }).catch(() => undefined);

    const snapshot = await page.evaluate(() => ({ title: document.title.trim(), text: (document.body?.innerText ?? "").replace(/\s{3,}/g, "\n\n").trim(), htmlHint: document.documentElement.innerHTML.slice(0, 20_000).toLowerCase() }));
    const normalized = `${snapshot.title}\n${snapshot.text}\n${snapshot.htmlHint}`.toLowerCase();
    if (BLOCKED_MARKERS.some(marker => normalized.includes(marker))) throw new BrowserCaptureError("The lender page presented an access challenge or anti-bot block.", "blocked");
    if (snapshot.text.length < 40) throw new BrowserCaptureError("The rendered lender page did not contain readable product data.", "empty");
    const screenshot = await page.screenshot({ type: "png", fullPage: true, captureBeyondViewport: false });
    return { finalUrl: page.url(), title: snapshot.title || "Untitled lender page", text: snapshot.text, screenshot: new Uint8Array(screenshot) };
  } catch (error) {
    if (error instanceof BrowserCaptureError) throw error;
    const message = error instanceof Error ? error.message : "Browser capture failed.";
    if (/timeout|navigation timeout/i.test(message)) throw new BrowserCaptureError("The browser capture timed out while rendering the lender page.", "timeout");
    throw new BrowserCaptureError(message, "browser");
  } finally {
    if (disconnectOnly) await browser?.disconnect().catch(() => undefined);
    else await browser?.close().catch(() => undefined);
  }
}
