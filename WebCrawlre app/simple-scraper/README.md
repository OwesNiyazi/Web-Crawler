# 🔥 WebCrawler

A lightweight web scraper and crawler built with Node.js. Scrape a single page or crawl an entire website — extract content as Markdown, HTML, or plain text.

## Project Structure

```
simple-scraper/
├── server.js          # Express backend — API routes, scraping & crawling logic
├── index.html         # Frontend UI — single-page app with dark theme
├── package.json       # Dependencies and scripts
├── package-lock.json  # Locked dependency versions
└── README.md
```

## Features

- **Single Page Scrape** — Fetch any URL and extract its content, links, and images
- **Multi-Page Crawl** — Crawl up to 50 pages from a domain with real-time progress tracking
- **Output Formats** — Markdown (default), HTML, or plain text
- **Content Extraction** — Strips nav, footer, scripts, and other noise to get the main content
- **Link & Image Discovery** — Extracts all links and images with resolved URLs
- **Copy to Clipboard** — One-click copy for content, links, or entire crawl results

## Tech Stack

- **Backend**: Node.js, Express
- **HTML Parsing**: Cheerio
- **Markdown Conversion**: Turndown
- **Frontend**: Vanilla HTML/CSS/JS (no framework)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+ (uses native `fetch`)

### Installation

```bash
cd simple-scraper
npm install
```

### Run

```bash
npm start
```

The app will be available at **http://localhost:3002**

## API Endpoints

### `POST /api/scrape`

Scrape a single page.

| Parameter | Type   | Default    | Description                        |
|-----------|--------|------------|------------------------------------|
| `url`     | string | (required) | The URL to scrape                  |
| `format`  | string | `markdown` | Output format: `markdown`, `html`, `text` |

### `POST /api/crawl`

Start a multi-page crawl. Returns a `crawlId` for polling progress.

| Parameter  | Type   | Default    | Description                        |
|------------|--------|------------|------------------------------------|
| `url`      | string | (required) | Starting URL                       |
| `format`   | string | `markdown` | Output format                      |
| `maxPages` | number | `10`       | Max pages to crawl (1–50)          |

### `GET /api/crawl/:id`

Check crawl progress and get results.

## How It Works

1. **Fetch** — Downloads the page HTML with a browser-like User-Agent
2. **Parse** — Uses Cheerio to extract title, meta description, links, and images
3. **Clean** — Removes scripts, styles, nav, footer, and other non-content elements
4. **Convert** — Transforms the main content to the requested format (Markdown via Turndown)
5. **Crawl** (multi-page) — Discovers same-domain links and queues them for scraping up to the page limit

## License

MIT
