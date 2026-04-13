import express from "express";
import { CheerioCrawler, PlaywrightCrawler, Configuration, RequestQueue } from "crawlee";
import { load } from "cheerio";
import TurndownService from "turndown";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3002;
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const config = new Configuration({ persistStorage: false, purgeOnStart: true });
Configuration.getGlobalConfig().set("persistStorage", false);
Configuration.getGlobalConfig().set("purgeOnStart", true);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/", (_, res) => res.send(readFileSync(join(__dirname, "index.html"), "utf-8")));

let counter = 0;

async function fetchPage(url) {
  let html = null;
  const uid = `c-${Date.now()}-${++counter}`;

  // Try CheerioCrawler first
  try {
    const queue = await RequestQueue.open(uid);
    await queue.addRequest({ url, uniqueKey: uid });
    html = await new Promise((resolve, reject) => {
      let result = null;
      const crawler = new CheerioCrawler({
        requestQueue: queue,
        maxRequestsPerCrawl: 1,
        maxRequestRetries: 1,
        requestHandlerTimeoutSecs: 20,
        async requestHandler({ body }) {
          result = typeof body === "string" ? body : body.toString();
        },
        async failedRequestHandler(_, error) {
          reject(new Error(error?.message || "Fetch failed"));
        },
      });
      crawler.run().then(() => resolve(result)).catch(reject);
    });
  } catch { html = null; }

  if (html && isSPA(html)) html = null;

  // Fallback to PlaywrightCrawler
  if (!html) {
    console.log(`  ↳ Using browser for ${url}`);
    const bid = `b-${Date.now()}-${++counter}`;
    const bq = await RequestQueue.open(bid);
    await bq.addRequest({ url, uniqueKey: bid });
    html = await new Promise((resolve, reject) => {
      let result = null;
      const crawler = new PlaywrightCrawler({
        requestQueue: bq,
        maxRequestsPerCrawl: 1,
        maxRequestRetries: 1,
        requestHandlerTimeoutSecs: 30,
        headless: true,
        launchContext: { launchOptions: { args: ["--no-sandbox", "--disable-setuid-sandbox"] } },
        async requestHandler({ page }) {
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(2000);
          result = await page.content();
        },
        async failedRequestHandler(_, error) {
          reject(new Error(error?.message || "Browser fetch failed"));
        },
      });
      crawler.run().then(() => resolve(result)).catch(reject);
    });
  }

  if (!html) throw new Error(`Could not fetch ${url}`);
  return { html };
}

function isSPA(html) {
  const $ = load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const hasRoot = $("#root, #app, #__next, #__nuxt").length > 0;
  const hasScripts = $("script[src]").length > 0;
  return hasRoot && hasScripts && bodyText.length < 200;
}

function analyzeSEO(html, url) {
  const $ = load(html);
  const issues = [], passed = [], warnings = [];
  const title = $("title").text().trim();
  if (!title) issues.push("Missing page title");
  else if (title.length < 30) warnings.push(`Title too short (${title.length} chars, aim for 30-60)`);
  else if (title.length > 60) warnings.push(`Title too long (${title.length} chars, aim for 30-60)`);
  else passed.push(`Title length OK (${title.length} chars)`);
  const desc = $('meta[name="description"]').attr("content") || "";
  if (!desc) issues.push("Missing meta description");
  else if (desc.length < 70) warnings.push(`Meta description too short (${desc.length} chars, aim for 70-160)`);
  else if (desc.length > 160) warnings.push(`Meta description too long (${desc.length} chars, aim for 70-160)`);
  else passed.push(`Meta description length OK (${desc.length} chars)`);
  const h1s = $("h1"), h2s = $("h2");
  if (h1s.length === 0) issues.push("Missing H1 tag");
  else if (h1s.length > 1) warnings.push(`Multiple H1 tags (${h1s.length})`);
  else passed.push("Single H1 tag present");
  if (h2s.length === 0) warnings.push("No H2 tags found"); else passed.push(`${h2s.length} H2 tag(s) found`);
  const imgs = $("img"), imgsNoAlt = $("img:not([alt]), img[alt='']");
  if (imgs.length > 0 && imgsNoAlt.length > 0) warnings.push(`${imgsNoAlt.length}/${imgs.length} images missing alt text`);
  else if (imgs.length > 0) passed.push(`All ${imgs.length} images have alt text`);
  const canonical = $('link[rel="canonical"]').attr("href") || "";
  if (!canonical) warnings.push("Missing canonical URL"); else passed.push("Canonical URL set");
  const viewport = $('meta[name="viewport"]').attr("content") || "";
  if (!viewport) issues.push("Missing viewport meta tag"); else passed.push("Viewport meta tag present");
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogDesc = $('meta[property="og:description"]').attr("content") || "";
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  if (!ogTitle && !ogDesc) warnings.push("Missing Open Graph tags");
  else if (!ogImage) warnings.push("Missing og:image"); else passed.push("Open Graph tags present");
  const twCard = $('meta[name="twitter:card"]').attr("content") || "";
  if (!twCard) warnings.push("Missing Twitter Card meta"); else passed.push("Twitter Card meta present");
  const lang = $("html").attr("lang") || "";
  if (!lang) warnings.push("Missing lang attribute"); else passed.push(`Language set: ${lang}`);
  const robots = $('meta[name="robots"]').attr("content") || "";
  if (robots && (robots.includes("noindex") || robots.includes("nofollow"))) warnings.push(`Robots: ${robots}`);
  const base = new URL(url);
  let intLinks = 0, extLinks = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    try { new URL(href, url).hostname === base.hostname ? intLinks++ : extLinks++; } catch {}
  });
  const jsonLd = $('script[type="application/ld+json"]');
  if (jsonLd.length > 0) passed.push(`Structured data (${jsonLd.length} block(s))`); else warnings.push("No structured data (JSON-LD)");
  if (url.startsWith("https://")) passed.push("HTTPS enabled"); else issues.push("Not using HTTPS");
  const score = Math.max(0, Math.min(100, 100 - (issues.length * 15) - (warnings.length * 5) + (passed.length * 2)));
  return { score, title: title || "(missing)", description: desc || "(missing)", canonical, lang, ogTitle, ogDesc, ogImage,
    headings: { h1: h1s.length, h2: h2s.length, h3: $("h3").length, h4: $("h4").length },
    links: { internal: intLinks, external: extLinks }, images: { total: imgs.length, missingAlt: imgsNoAlt.length },
    issues, warnings, passed };
}

function parsePage(html, url, format) {
  const $ = load(html);
  const title = $("title").text().trim();
  const description = $('meta[name="description"]').attr("content") || "";
  const links = [], images = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href"), text = $(el).text().trim();
    if (href && text && !href.startsWith("#") && !href.startsWith("javascript:"))
      try { links.push({ text: text.substring(0, 100), url: new URL(href, url).href }); } catch {}
  });
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src"), alt = $(el).attr("alt") || "";
    if (src) try { images.push({ src: new URL(src, url).href, alt }); } catch {}
  });
  const seo = analyzeSEO(html, url);
  $("script, style, nav, footer, header, iframe, noscript, svg, [role='banner'], [role='navigation']").remove();
  const mainContent = $("main, article, [role='main']").length ? $("main, article, [role='main']").html() : $("body").html();
  let content;
  if (format === "markdown") content = turndown.turndown(mainContent || "");
  else if (format === "text") content = $.text().replace(/\s+/g, " ").trim();
  else content = mainContent || $.html();
  return { title, description, url, content, links: links.slice(0, 50), images: images.slice(0, 30), seo };
}

function extractInternalLinks(html, baseUrl) {
  const $ = load(html);
  const base = new URL(baseUrl);
  const found = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
    try { const r = new URL(href, baseUrl); if (r.hostname === base.hostname) { r.hash = ""; found.add(r.href); } } catch {}
  });
  return [...found];
}

app.post("/api/scrape", async (req, res) => {
  let { url, format } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
  try { new URL(url); } catch { return res.status(400).json({ success: false, error: "Invalid URL" }); }
  try {
    const { html } = await fetchPage(url);
    res.json({ success: true, data: parsePage(html, url, format || "markdown") });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

const crawlSessions = new Map();

app.post("/api/crawl", async (req, res) => {
  let { url, maxPages = 10, format = "markdown" } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
  try { new URL(url); } catch { return res.status(400).json({ success: false, error: "Invalid URL" }); }
  const crawlId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const limit = Math.min(Math.max(parseInt(maxPages) || 10, 1), 50);
  crawlSessions.set(crawlId, { status: "crawling", pages: [], total: 0, limit, errors: [] });
  res.json({ success: true, crawlId });
  (async () => {
    const session = crawlSessions.get(crawlId);
    const visited = new Set(), queue = [url];
    while (queue.length > 0 && session.pages.length < limit) {
      const cur = queue.shift(), norm = cur.replace(/\/$/, "");
      if (visited.has(norm)) continue;
      visited.add(norm);
      try {
        const { html } = await fetchPage(cur);
        session.pages.push(parsePage(html, cur, format));
        session.total = session.pages.length;
        if (session.pages.length < limit) {
          for (const link of extractInternalLinks(html, cur)) {
            const n = link.replace(/\/$/, "");
            if (!visited.has(n) && !queue.includes(link)) queue.push(link);
          }
        }
      } catch (err) { session.errors.push({ url: cur, error: err.message }); }
    }
    session.status = "done";
  })();
});

app.get("/api/crawl/:id", (req, res) => {
  const s = crawlSessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Crawl not found" });
  res.json({ success: true, ...s });
});

setInterval(() => {
  for (const [id, s] of crawlSessions) {
    if (s.status === "done" && Date.now() - parseInt(id, 36) > 600000) crawlSessions.delete(id);
  }
}, 600000);

app.listen(PORT, () => console.log(`\n  🔥 WebCrawler running at http://localhost:${PORT}\n`));
