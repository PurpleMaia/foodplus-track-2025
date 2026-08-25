// PARKED: Playwright/www fallback for the main bill-list report.
//
// The data.capitol.hawaii.gov copy of advreport.aspx intermittently crashes with
// HTTP 500. This module fetched the same report from www.capitol.hawaii.gov using a
// real browser (Chromium via Playwright) to clear Cloudflare. It is disabled for now:
// from the Dokku host, www returned HTTP 403 to headless Chromium (Cloudflare bot
// management / datacenter-IP block), so the fallback did not actually work.
//
// Kept as commented code so it can be revived once the Cloudflare 403 is resolved
// (e.g. awaiting the JS challenge, a residential/proxy egress, or a fixed data host).
// The consumer (server/services/scraping/all-bills.js) has a matching parked block.

// import { chromium } from 'playwright';
// import { getRandomUserAgent, MAIN_LIST_TIMEOUT } from './config.js';
//
// /**
//  * Fetch the main bill-list report HTML using a real browser.
//  *
//  * The `data.capitol.hawaii.gov` copy of `advreport.aspx` intermittently crashes
//  * server-side (HTTP 500). The identical report on `www.capitol.hawaii.gov` works,
//  * but that host is behind Cloudflare's bot management, which plain axios cannot
//  * pass. Chromium executes the Cloudflare JS challenge and carries the clearance
//  * cookie, so it can reach the working `www` report.
//  *
//  * @param {string} url - the original report URL (typically pointed at the `data` host)
//  * @returns {Promise<string>} the rendered page HTML, for the caller to parse with cheerio
//  */
// export async function fetchListHtmlViaBrowser(url) {
//   // Route to the Cloudflare-fronted host that actually serves the report.
//   const wwwUrl = url.replace('data.capitol.hawaii.gov', 'www.capitol.hawaii.gov');
//
//   console.log(`[ALL BILLS] Falling back to Playwright against ${wwwUrl}`);
//
//   const browser = await chromium.launch({ headless: true });
//   try {
//     const context = await browser.newContext({ userAgent: getRandomUserAgent() });
//     const page = await context.newPage();
//     const response = await page.goto(wwwUrl, {
//       waitUntil: 'domcontentloaded',
//       timeout: MAIN_LIST_TIMEOUT,
//     });
//
//     const status = response?.status();
//     if (status && status >= 400) {
//       throw new Error(`Playwright fallback got HTTP ${status} from ${wwwUrl}`);
//     }
//
//     return await page.content();
//   } finally {
//     await browser.close();
//   }
// }
