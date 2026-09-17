# Troubleshooting & FAQ

This guide provides solutions to common issues encountered when using or developing **Cross Context**.

---

## 🔍 Diagnostic Checklist

When encountering unexpected behavior, check the following first:

1. **Active Tab Recognition:** Ensure the URL of the tab is one of the supported domains (`claude.ai`, `chatgpt.com`, `gemini.google.com`, `grok.com`, `x.com/i/grok`, or `perplexity.ai`).
2. **Reload Tab After Updating Extension:** If you updated or reloaded the extension in `chrome://extensions/`, refresh your open LLM tabs (`F5`) so the new content scripts can initialize.
3. **Inspect the Console:**
   - For **scraping or injection** errors: Open the page DevTools (`F12`) on the LLM website and check the **Console** tab.
   - For **Gemini API or storage** errors: Navigate to `chrome://extensions/`, locate Cross Context, and click **service worker** to inspect the background script logs.

---

## ❗ Common Issues & Solutions

### 1. "Scrape found no messages" or Incomplete Scraping
* **Cause:** The host AI platform may have released a new UI layout, or the conversation is virtualized and requires scrolling.
* **Solution:**
  1. Scroll up to the top of the conversation manually to ensure the platform has mounted the message elements into the DOM.
  2. If the platform just received a major redesign, check [`docs/scraping-engine.md`](scraping-engine.md) to update the selector fallbacks in `content/content.js`.

---

### 2. "AI Enhancement Failed: HTTP 404"
* **Cause:** The selected Gemini model has been discontinued by Google.
* **Solution:**
  1. Open the Cross Context popup and click the **Settings (⚙️)** icon in the header.
  2. Check your selected model. Ensure you are using `gemini-3.5-flash` or `gemini-3.6-flash`.
  3. Avoid obsolete models (`gemini-1.5-flash` and `gemini-2.0-flash`), which have been sunset by Google AI Studio.

---

### 3. "AI Enhancement Failed: HTTP 429 (Rate Limit)"
* **Cause:** Google AI Studio's free-tier rate limits (RPM / RPD) were exceeded.
* **Solution:**
  - Cross Context will automatically fall back to deterministic heuristic formatting so your transfer proceeds uninterrupted.
  - Wait 60 seconds before retrying an AI-enhanced scrape, or configure a paid Google Cloud Project key.

---

### 4. "Injection Timed Out" or Text Not Appearing in Compose Box
* **Cause:** The target platform is an SPA that was slow to finish loading its dynamic compose editor.
* **Solution:**
  1. Cross Context actively polls the page for up to 15 seconds. If your network connection is slow, keep the target tab open.
  2. If automated injection fails, click the **Copy Markdown** button in the popup or in the `context.md Preview` card and paste it directly into the target chat.

---

### 5. "Storage Quota Exceeded" Warning
* **Cause:** Chrome extensions using `chrome.storage.local` operate within an allocated storage quota (~10 MB). Saving dozens of screenshots or Base64 images can fill this space.
* **Solution:**
  - Cross Context includes **Quota Auto-Recovery**: it automatically strips heavy Base64 image payloads from older saved contexts while preserving text transcripts.
  - To free up space manually, click the **Trash Can (🗑️)** icon in the popup header to clear all saved contexts.

---

### 6. "Oldest Context Removed to Make Room" Toast
* **Cause:** By default, Cross Context maintains a rolling window of the **10 most recent** conversation snapshots.
* **Solution:**
  - When the 11th context is captured, the oldest context is pruned to prevent uncontrolled storage growth.
  - Export important conversations using the **Download .md** button in the `context.md Preview` tab before they are pruned.

---

## ❓ Frequently Asked Questions

### Does Cross Context upload my chats to a private server?
**No.** All scraping, formatting, deduplication, and storage happen locally inside your browser's private sandbox. If you enable the Gemini AI pipeline, data is transmitted solely between your browser and Google's official Gemini API endpoint using your own API key.

### Can I use Cross Context across different browsers?
Cross Context runs on any Chromium-based browser supporting Manifest V3, including:
- Google Chrome
- Brave Browser
- Microsoft Edge
- Arc Browser
- Opera

### Why are some earlier turns missing in a 100-message chat?
To prevent exceeding the target model's input token limit, Cross Context enforces a safe transfer threshold (~20,000 tokens / 80,000 characters). Earlier messages are pruned on whole message boundaries to ensure that critical recent code snippets, active error traces, and architectural decisions are preserved without broken Markdown fences.
