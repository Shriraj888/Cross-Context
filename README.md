# 🔄 Cross Context

A browser extension that allows you to seamlessly share conversation history and transfer context between major LLM platforms—**Claude**, **ChatGPT**, **Gemini**, **Grok**, and **Perplexity**—without having to copy-paste or start from scratch.

---

## ✨ Features

- **One-Click Scrape:** Capture conversation transcripts from Claude, ChatGPT, Gemini, Grok, or Perplexity.
- **Context Injection:** Seamlessly paste and format the captured conversation history directly into the text input area of a new target LLM.
- **Local Storage:** All captured conversations are saved locally in your browser's local extension storage.
- **Privacy First:** 100% self-contained. No server-side storage, no database, and no telemetry. All context processing is handled entirely on your device.

---

## 🛠️ Installation (Developer Mode)

Since this extension is not yet published to the Chrome Web Store, you can run it locally in developer mode:

1. **Clone or Download** this repository to your local machine.
2. Open your Google Chrome browser and navigate to `chrome://extensions/`.
3. In the top-right corner, toggle the **"Developer mode"** switch to **ON**.
4. In the top-left corner, click **"Load unpacked"**.
5. Select the folder containing this project (the one containing `manifest.json`).
6. The **Cross Context** extension will now appear in your browser's toolbar!

---

## 📂 Project Structure

```text
cross-context/
├── background.js       # Background service worker (manages messaging and storage)
├── manifest.json       # Extension manifest (defines permissions and entry points)
├── content/
│   ├── content.js      # Main content script injected into LLM pages
│   ├── injectors/      # Injector scripts for pasting formatted history into LLMs
│   └── scrapers/       # Scraper scripts for extracting message history from LLMs
├── popup/
│   ├── popup.html      # UI popup file
│   ├── popup.css       # UI styling
│   └── popup.js        # Logic for displaying saved contexts and launching transfers
├── utils/
│   ├── formatter.js    # Message structuring and LLM handoff prompt formatter
│   └── storage.js      # Chrome local storage utilities
└── icons/              # Extension icons
```

---

## 🔒 Privacy & Security

We take your data privacy seriously:
- **No Remote Servers:** The extension has zero server integrations or network endpoints.
- **No Data Harvesting:** Your conversations are never sent, stored, or analyzed on external servers.
- **Minimal Permissions:** The extension requests host permissions strictly for the supported LLM domains (`claude.ai`, `chatgpt.com`, `gemini.google.com`, `grok.com`, `x.com`, `perplexity.ai`) to read/write context locally.

