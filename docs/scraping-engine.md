# Scraping Engine & DOM Resilience

The **Scraping Engine** extracts structured conversation transcripts from single-page application (SPA) chat interfaces. It runs within the isolated page context of [`content/content.js`](file:///content/content.js).

---

## 🎯 Challenges in Modern AI Interfaces

Web-based AI platforms present several scraping hurdles:
1. **Dynamic Class Generation:** Many platforms use hashed, obfuscated CSS-in-JS classes (e.g., `.css-1b9z...`) that change with every deployment.
2. **Layout Thrashing:** Repeatedly querying `element.innerText` or reading dimensions triggers forced layout reflows, causing the browser to freeze on long threads.
3. **Virtualized Lists:** To save memory, platforms like ChatGPT and Claude unload off-screen conversation messages from the DOM when scrolled away.
4. **Interface Chrome Noise:** Copy buttons, thumbs up/down feedback forms, toolbars, and suggested search pills pollute raw extracted text.
5. **CORS on Inline Images:** User-uploaded screenshots or generated diagrams are hosted on protected CDNs that block content script extraction.

---

## 🛡️ The Zero-Thrashing Scraping Session

To extract clean text without triggering browser reflows, Cross Context uses a scoped stylesheet injection:

```javascript
function startScrapingSession() {
  tempStyle = document.createElement('style');
  tempStyle.id = 'cc-scrape-temp-style';
  tempStyle.textContent = `
    .cc-scraping-active button,
    .cc-scraping-active svg,
    .cc-scraping-active [role="button"],
    .cc-scraping-active [class*="action-bar"],
    .cc-scraping-active [class*="toolbar"],
    .cc-scraping-active [class*="copy-button"],
    .cc-scraping-active [data-testid*="copy"],
    .cc-scraping-active [class*="citation"],
    .cc-scraping-active sup {
      display: none !important;
    }
  `;
  document.documentElement.appendChild(tempStyle);
  document.documentElement.classList.add('cc-scraping-active');
}
```

1. **One-Pass Invisibility:** Before reading the DOM, non-content controls (copy icons, citations, action buttons) are hidden in a single CSS pass.
2. **Reflow-Free Extraction:** Reading `innerText` on the message container extracts only meaningful conversational prose without extra cleanup passes.
3. **Session Teardown:** The temporary stylesheet and class are cleanly removed immediately after extraction completes.

---

## 📜 Platform Selector Matrix

Each platform uses a tiered fallback chain to resist vendor frontend updates:

| Platform | Primary Selector | Secondary Fallback | Role Classification |
|----------|------------------|--------------------|---------------------|
| **Claude** | `[data-testid="user-message"]`, `.font-claude-message` | `div.font-user-message`, `div[class*="ChatMessage"]` | Checked via `.font-user-message` class or `data-testid` |
| **ChatGPT** | `[data-message-author-role]` | `article`, `div.text-base` | Read directly from `data-message-author-role="user\|assistant"` |
| **Gemini** | `user-query`, `model-response` | `message-content`, `div[class*="query-content"]` | Tag name (`USER-QUERY` vs `MODEL-RESPONSE`) |
| **Grok** | `div[data-testid*="message"]`, `div.message-bubble` | `div[class*="bubble"]`, `article` | Class checking (`user` vs `assistant`/`grok`) |
| **Perplexity** | `div[class*="query-wrapper"]`, `div[class*="answer-wrapper"]` | `div.markdown`, `div[class*="prose"]` | Container wrapper detection |

### Resilient Fallback Pattern (`resilientQueryAll`)
```javascript
function resilientQueryAll(container, selectorList) {
  for (const selector of selectorList) {
    try {
      const elements = Array.from(container.querySelectorAll(selector));
      if (elements.length > 0) return elements;
    } catch {
      // Continue to next tier if selector syntax fails
    }
  }
  return [];
}
```

---

## 📜 Virtualized Lists & Viewport Scrolling

For conversations exceeding 20+ turns, modern interfaces unmount off-screen messages. 

When scraping begins:
1. The scraper checks the scrollable container's total height and scroll position.
2. It executes a gentle, stepped auto-scroll to the top of the container:
   ```javascript
   container.scrollTo({ top: 0, behavior: 'smooth' });
   ```
3. A `MutationObserver` monitors DOM insertions, waiting for previously virtualized nodes to mount into the document tree before parsing begins.

---

## 📝 Markdown Reconstruction

Raw HTML is converted back into structured Markdown:
- **Code Fences:** Identified via `pre > code`. The scraper extracts the programming language from `class="language-..."` or header badges and wraps code in ```` ```language ... ``` ````.
- **Tables:** `<table>`, `<thead>`, `<tbody>`, `<tr>`, and `<td>` are serialized into GitHub-Flavored Markdown tables.
- **Lists:** Ordered (`<ol>`) and unordered (`<ul>`) lists are translated into numbered (`1. `) and bulleted (`• `) Markdown lines.
- **Emphasis:** `<strong>` and `<b>` become `**bold**`; `<em>` and `<i>` become `*italic*`.

---

## 🖼️ Media Extraction & Safe Proxying

When an inline image or generated SVG is detected:
1. **SVG Elements:** Rendered to an in-memory HTML5 Canvas and compiled into a PNG Data URI.
2. **Remote Images:** Dispatched to the background worker (`FETCH_IMAGE_BASE64`) to bypass page CORS restrictions.
3. **SSRF Guard:** The service worker validates the URL with `isSafeImageUrl()`:
   - Protocol must be `https:`.
   - Host cannot be `localhost`, `127.0.0.1`, `0.0.0.0`, link-local (`169.254.x.x`), or RFC 1918 private subnets.
4. **Optimization:** Images are constrained to a maximum dimension of 1024px and compressed using JPEG at quality `0.82` to keep storage usage low.
