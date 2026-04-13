import express from "express";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3002;
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send(readFileSync(join(__dirname, "index.html"), "utf-8"));
});

// Fetch a single page
async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return response.text();
}

// Parse HTML and extract data
function parsePage(html, url, format) {
  const $ = cheerio.load(html);

  const title = $("title").text().trim();
  const description = $('meta[name="description"]').attr("content") || "";

  // Extract links and images BEFORE removing elements
  const links = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href && text && !href.startsWith("#") && !href.startsWith("javascript:")) {
      try {
        links.push({ text: text.substring(0, 100), url: new URL(href, url).href });
      } catch {}
    }
  });

  const images = [];
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    const alt = $(el).attr("alt") || "";
    if (src) {
      try { images.push({ src: new URL(src, url).href, alt }); } catch {}
    }
  });

  // Now remove unwanted elements for content extraction
  $("script, style, nav, footer, header, iframe, noscript, svg, [role='banner'], [role='navigation']").remove();

  const mainContent = $("main, article, [role='main']").length
    ? $("main, article, [role='main']").html()
    : $("body").html();

  let content;
  if (format === "markdown") content = turndown.turndown(mainContent || "");
  else if (format === "text") content = $.text().replace(/\s+/g, " ").trim();
  else content = mainContent || $.html();

  return { title, description, url, content, links: links.slice(0, 50), images: images.slice(0, 30) };
}

// Extract same-domain links from a page
function extractInternalLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const found = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname === base.hostname) {
        resolved.hash = "";
        found.add(resolved.href);
      }
    } catch {}
  });

  return [...found];
}

// Single page scrape
app.post("/api/scrape", async (req, res) => {
  const { url, format } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });
  try {
    const html = await fetchPage(url);
    const data = parsePage(html, url, format || "markdown");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Multi-page crawl — stores results in memory per crawl session
const crawlSessions = new Map();

app.post("/api/crawl", async (req, res) => {
  const { url, maxPages = 10, format = "markdown" } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  const crawlId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const limit = Math.min(Math.max(parseInt(maxPages) || 10, 1), 50);

  crawlSessions.set(crawlId, { status: "crawling", pages: [], total: 0, limit, errors: [] });
  res.json({ success: true, crawlId });

  // Crawl in background
  (async () => {
    const session = crawlSessions.get(crawlId);
    const visited = new Set();
    const queue = [url];

    while (queue.length > 0 && session.pages.length < limit) {
      const currentUrl = queue.shift();
      const normalized = currentUrl.replace(/\/$/, "");
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      try {
        const html = await fetchPage(currentUrl);
        const pageData = parsePage(html, currentUrl, format);
        session.pages.push(pageData);
        session.total = session.pages.length;

        // Discover more links
        if (session.pages.length < limit) {
          const newLinks = extractInternalLinks(html, currentUrl);
          for (const link of newLinks) {
            const norm = link.replace(/\/$/, "");
            if (!visited.has(norm) && !queue.includes(link)) {
              queue.push(link);
            }
          }
        }
      } catch (err) {
        session.errors.push({ url: currentUrl, error: err.message });
      }
    }

    session.status = "done";
  })();
});

// Check crawl progress
app.get("/api/crawl/:id", (req, res) => {
  const session = crawlSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Crawl not found" });
  res.json({ success: true, ...session });
});

// Cleanup old sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of crawlSessions) {
    if (session.status === "done" && now - parseInt(id, 36) > 600000) {
      crawlSessions.delete(id);
    }
  }
}, 600000);

app.listen(PORT, () => {
  console.log(`\n  🔥 WebCrawler running at http://localhost:${PORT}\n`);
});
