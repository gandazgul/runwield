---
name: ketch
description: >
    Web search, library documentation lookup, and URL content extraction via the ketch CLI.
    Use ketch search when the user asks for current information, facts, or topics that require
    searching the web. Use ketch docs when the user asks about library APIs, frameworks, or
    package documentation. Use ketch scrape when the user provides a URL and wants the page
    content extracted as clean markdown. Do not use for general file reading, git operations,
    or tasks unrelated to web search, docs lookup, or scraping.
compatibility: Requires ketch CLI v0.8.0+ installed and available in PATH. Needs internet access.
allowed-tools: Bash(ketch:*) Bash(jq:*)
metadata:
    version: "1.0"
---

# Ketch

Web search, library documentation lookup, and URL scraping via the ketch CLI.

## When to use

- **search** — the user needs current information, facts, or web results not in your training data.
- **docs** — the user asks about a library, framework, or package API and you need up-to-date documentation.
- **scrape** — the user provides one or more URLs and wants clean markdown content extracted.

## General flags (all commands)

- `--json` — output as JSON instead of markdown/text. Use when you need to parse or filter results programmatically.

---

## search — Web Search

```bash
ketch search "<query>" [flags]
```

Backends: `brave` (default), `ddg`, `searxng`

### Common flags

| Flag                   | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `-b, --backend <name>` | Search backend: brave, ddg, searxng                  |
| `-l, --limit <n>`      | Max results (default 5)                              |
| `--scrape`             | Scrape full content from each result                 |
| `--max-chars <n>`      | Truncate output to N chars (0 = unlimited)           |
| `--minimal`            | One result per line: URL\tTitle\tSnippet             |
| `--trim`               | Strip markdown formatting, keep plain text           |
| `--searxng-url <url>`  | SearXNG instance URL (default http://localhost:8081) |

### Examples

```bash
# Basic web search
ketch search "next.js app router tutorial"

# More results with full content scraped
ketch search "rust async runtime comparison" --limit 10 --scrape

# DuckDuckGo backend, minimal output
ketch search "latest python release" -b ddg --minimal

# JSON output for programmatic use
ketch search "openapi specification" --json | jq '.results[].url'
```

### Tips

- Use `--scrape` when the user needs the actual article content, not just search snippets.
- Use `--limit 10` or higher when the user wants a broad survey of sources.
- Use `--minimal` when you only need URLs and titles to pass to another tool.

---

## docs — Library Documentation

```bash
ketch docs "<query>" [flags]
```

Backends: `context7` (default), `local`

### Common flags

| Flag                   | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `-b, --backend <name>` | Docs backend: context7, local                   |
| `-l, --limit <n>`      | Max results (default 5)                         |
| `--library <id>`       | Context7 library ID (skip name resolution)      |
| `--resolve`            | Resolve library name to ID instead of searching |
| `--tokens <n>`         | Context7 token budget (default 4000)            |
| `--minimal`            | One result per line: URL\tLibrary\tSnippet      |

### Examples

```bash
# Search Context7 docs for a library
ketch docs "react hooks useEffect"

# Resolve a library name to its Context7 ID
ketch docs "next.js" --resolve

# Search a specific library by ID
ketch docs "middleware" --library "/vercel/next.js"

# Higher token budget for detailed docs
ketch docs "tailwind configuration" --tokens 8000
```

### Tips

- If you know the Context7 library ID, pass `--library` to skip the resolve step and get faster results.
- Use `--resolve` first when you are unsure of the exact library identifier.
- Context7 is preferred for API docs; use `local` only if a local FTS5 index is configured.

---

## scrape — URL Content Extraction

```bash
ketch scrape <url...> | <file> | <json-array> [flags]
```

Automatically detects input type: multiple args, JSON array, file, stdin pipe, or single URL.

### Common flags

| Flag                | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `--concurrency <n>` | Max concurrent requests (default 5)                           |
| `--max-chars <n>`   | Truncate output to N chars (0 = unlimited)                    |
| `--raw`             | Output raw HTML instead of markdown                           |
| `--select <css>`    | CSS selector to extract specific elements (skips readability) |
| `--trim`            | Strip markdown formatting, keep plain text                    |
| `--no-cache`        | Bypass the page cache                                         |
| `--no-llms-txt`     | Disable automatic /llms.txt detection for bare domains        |

### Examples

```bash
# Scrape a single URL
ketch scrape https://example.com/article

# Scrape multiple URLs
ketch scrape https://a.com/page1 https://b.com/page2

# Scrape from a file
ketch scrape urls.txt

# Pipe URLs
printf "https://example.com\nhttps://example.org" | ketch scrape

# Extract specific element only
ketch scrape https://example.com/docs --select "article.main-content"

# Raw HTML
ketch scrape https://example.com --raw
```

### Tips

- Use `--select` when you need a specific part of the page (e.g., an article body) and the default readability
  extraction is too noisy.
- Use `--no-cache` when you need the freshest version of a page.
- For many URLs, pipe them in or use a file to avoid shell argument limits.

---

## Combining commands

Pipe search results into scrape to fetch full content from discovered URLs:

```bash
# Get URLs from search, then scrape them
urls=$(ketch search "topic" --minimal | cut -f1)
printf "%s\n" "$urls" | ketch scrape
```

Or use `--scrape` directly on search for convenience.
