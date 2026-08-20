import puppeteer from "puppeteer-core";

export type BrowserCapture = {
  finalUrl: string;
  title: string;
  text: string;
  screenshot: Uint8Array;
};

export class BrowserCaptureError extends Error {
  constructor(
    message: string,
    public readonly category: "blocked" | "timeout" | "empty" | "invalid_url" | "browser" = "browser"
  ) {
    super(message);
  }
}

const BLOCKED_MARKERS = [
  "captcha",
  "verify you are human",
  "access denied",
  "unusual traffic",
  "cf-chl-",
  "just a moment",
  "perimeterx",
];

function validateUrl(url: string): URL {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only HTTP(S) URLs can be captured.");
    }
    return parsed;
  } catch {
    throw new BrowserCaptureError("The lender source URL is invalid.", "invalid_url");
  }
}

export async function captureWithBrowser(targetUrl: string): Promise<BrowserCapture> {
  validateUrl(targetUrl);
  const endpoint = process.env.BROWSER_WS_ENDPOINT;
  if (!endpoint) {
    throw new BrowserCaptureError("The server browser endpoint is not configured.", "browser");
  }

  let browser: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
  try {
    browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
    await page.setUserAgent("Mozilla/5.0 (compatible; MortgageDataExtractor/1.0; +https://manus.space)");
    page.setDefaultNavigationTimeout(45_000);
    page.setDefaultTimeout(45_000);

    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 45_000 });
    await page.waitForFunction(() => document.body?.innerText?.trim().length > 40, { timeout: 12_000 }).catch(() => undefined);

    const snapshot = await page.evaluate(() => ({
      title: document.title.trim(),
      text: (document.body?.innerText ?? "").replace(/\s{3,}/g, "\n\n").trim(),
      htmlHint: document.documentElement.innerHTML.slice(0, 20_000).toLowerCase(),
    }));
    const normalized = `${snapshot.title}\n${snapshot.text}\n${snapshot.htmlHint}`.toLowerCase();
    if (BLOCKED_MARKERS.some(marker => normalized.includes(marker))) {
      throw new BrowserCaptureError("The lender page presented an access challenge or anti-bot block.", "blocked");
    }
    if (snapshot.text.length < 40) {
      throw new BrowserCaptureError("The rendered lender page did not contain readable product data.", "empty");
    }

    const screenshot = await page.screenshot({ type: "png", fullPage: true, captureBeyondViewport: false });
    return {
      finalUrl: page.url(),
      title: snapshot.title || "Untitled lender page",
      text: snapshot.text,
      screenshot: new Uint8Array(screenshot),
    };
  } catch (error) {
    if (error instanceof BrowserCaptureError) throw error;
    const message = error instanceof Error ? error.message : "Browser capture failed.";
    if (/timeout|navigation timeout/i.test(message)) {
      throw new BrowserCaptureError("The browser capture timed out while rendering the lender page.", "timeout");
    }
    throw new BrowserCaptureError(message, "browser");
  } finally {
    await browser?.disconnect().catch(() => undefined);
  }
}
