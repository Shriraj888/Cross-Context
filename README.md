<p align="center">
  <img src="icons/logo.png" alt="Cross Context Logo" width="128" height="128">
</p>

# Cross Context

### The Universal Context Bridge & Portability Layer for Large Language Models

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](manifest.json)
[![Manifest Version](https://img.shields.io/badge/Manifest-V3-orange.svg)](manifest.json)
[![Zero Cloud](https://img.shields.io/badge/Cloud-100%25%20Local-purple.svg)](docs/architecture.md)

<p align="center">
  <a href="https://chatgpt.com"><img src="https://img.shields.io/badge/ChatGPT-74aa9c?style=for-the-badge&logo=openai&logoColor=white" alt="ChatGPT"></a>
  <a href="https://claude.ai"><img src="https://img.shields.io/badge/Claude-d97706?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude"></a>
  <a href="https://gemini.google.com"><img src="https://img.shields.io/badge/Gemini-8b5cf6?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Gemini"></a>
  <a href="https://grok.com"><img src="https://img.shields.io/badge/Grok-000000?style=for-the-badge&logo=x&logoColor=white" alt="Grok"></a>
  <a href="https://perplexity.ai"><img src="https://img.shields.io/badge/Perplexity-20B2AA?style=for-the-badge&logo=perplexity&logoColor=white" alt="Perplexity"></a>
</p>

---

## 📖 What is Cross Context?

**Cross Context** is an open-source browser extension that eliminates AI vendor lock-in and context fragmentation. When you hit rate limits, context window caps, or want to leverage a different model's strengths, Cross Context captures your active session state and transfers it seamlessly into your target AI platform.

Everything runs **100% locally** in your browser sandbox without remote servers, subscription fees, or data collection.

---

## ✨ Key Features

- 🔄 **Cross-LLM Continuity:** Instantly migrate conversations between Claude, ChatGPT, Gemini, Grok, and Perplexity.
- 📄 **File-Based Context Injection:** Generates in-memory `context.md` files attached directly to target uploaders via the HTML5 `DataTransfer` API, avoiding bloated chat prompts.
- 🧠 **Optional AI Distillation:** Two-pass Gemini synthesis extracts technical facts, active bugs, and architectural decisions, appending the verbatim transcript underneath.
- ⚡ **Zero-Thrashing Scraping:** Parses single-page chat UIs with scoped CSS hiding rules that prevent browser layout thrashing and UI jitter.
- 🏷️ **Sequential Context IDs:** Uniquely tags each snapshot (`con_01`, `con_02`) to prevent target models from confusing project histories.
- ✂️ **Boundary-Safe Truncation:** Respects safe transfer budgets by trimming older turns on whole message boundaries, preventing split code fences.
- 🧩 **Multi-Session Merger:** Select multiple saved context snapshots and synthesize them into a unified project briefing.
- 🛡️ **Privacy-First & Secure:** Strict host permissions, no third-party tracking, and built-in SSRF guards against malicious internal IP URLs.

---

## 🚀 Quick Start

### 1. Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Shriraj888/Cross-Context.git
   cd Cross-Context
   ```
2. **Open Extensions page:** Navigate to `chrome://extensions/` in Chrome, Brave, Edge, or Opera.
3. **Enable Developer Mode:** Toggle the **Developer mode** switch in the top-right corner.
4. **Load Unpacked:** Click **Load unpacked** in the top-left corner and select the cloned `Cross-Context` directory.

---

## 🎯 How to Use

```
 ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
 │ 1. Scrape State │  ──>  │ 2. Pick Target  │  ──>  │ 3. Auto-Restore │
 │   (Claude / AI) │       │ (e.g. ChatGPT)  │       │  (File Attached)│
 └─────────────────┘       └─────────────────┘       └─────────────────┘
```

1. **Open an Active Chat:** Open any ongoing conversation on Claude, ChatGPT, Gemini, Grok, or Perplexity.
2. **Capture Context:** Click the **Cross Context** toolbar icon and select **Scrape Context** (or **AI Handoff** if Gemini API is configured).
3. **Select Target Platform:** Choose your destination AI from the target buttons.
4. **Click Transfer:** Cross Context opens the destination tab, attaches `context-con_01.md`, types the companion handoff prompt, and restores continuity with zero copy-pasting.

---

## ⚙️ Configuration (Optional AI Synthesis)

To enable Gemini-powered distillation alongside verbatim transcripts:
1. Click the **Settings (⚙️)** icon in the popup header.
2. Enter your [Google AI Studio Gemini API Key](https://aistudio.google.com/).
3. Select your model: `gemini-3.5-flash` (recommended default) or `gemini-3.6-flash`.
4. Click **Save Settings**.

---

## 🏗️ Architecture Overview

Cross Context is designed around Chrome MV3's native separation of concerns:

```
┌────────────────────────────────────────────────────────┐
│ UI Layer: Popup (popup.html, popup.js, popup.css)      │
└───────────────────────────┬────────────────────────────┘
                            │ chrome.runtime.sendMessage
┌───────────────────────────▼────────────────────────────┐
│ Background Layer: Service Worker (background.js)       │
│ • Storage Controller  • Image Proxy  • Gemini Pipeline │
└───────────────────────────┬────────────────────────────┘
                            │ chrome.scripting
┌───────────────────────────▼────────────────────────────┐
│ Content Layer: Single-File Dispatcher (content.js)     │
│ • DOM Scrapers  • Dual-Mode Injector  • Shadow Overlay │
└────────────────────────────────────────────────────────┘
```

*For complete technical architectural details and sequence diagrams, see [docs/architecture.md](docs/architecture.md).*

---

## 📂 Project Structure

```text
Cross-Context/
├── manifest.json              # Extension metadata and MV3 permission declarations
├── background.js              # Service worker managing state, proxy fetches, and AI pipeline
├── LICENSE                    # MIT License
├── README.md                  # Project overview and quick start guide
├── CONTRIBUTING.md            # Contributor workflows and selector maintenance guidelines
├── CHANGELOG.md               # Version release history
├── icons/                     # Extension branding and toolbar icons
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── logo.png
├── content/                   # Scripts running in target LLM page contexts
│   └── content.js             # Monolithic content script (scrapers, injectors, preview overlay)
├── popup/                     # Obsidian & electric cyan user interface
│   ├── popup.html             # Popup DOM structure
│   ├── popup.css              # Custom styling, toast animations, and radar scanner
│   └── popup.js               # Event controllers, context cards, and settings modal
├── utils/                     # Modular helpers
│   ├── formatter.js           # Markdown prompt assembly and message-boundary truncation
│   └── storage.js             # Async storage wrappers for runtime messaging
└── docs/                      # Technical deep-dive documentation
    ├── architecture.md        # Detailed 3-layer architecture & Mermaid diagrams
    ├── context-engineering.md # Scoring heuristics, Jaccard dedup & token safety
    ├── ai-enhancement-pipeline.md # Two-pass Gemini distillation & schema specifications
    ├── scraping-engine.md     # Platform selectors, DOM resilience & media extraction
    ├── injection-engine.md    # File drop DataTransfer simulation & fallback text injection
    ├── troubleshooting.md    # Common errors, model fixes, and debugging FAQ
    └── api-reference.md       # Internal runtime message contracts and storage schemas
```

---

## 📚 Technical Documentation

Explore deep dives on each subsystem:

| Document | Description |
|----------|-------------|
| 🏛️ [Architecture](docs/architecture.md) | High-level model, message routing, and security boundaries |
| 🧠 [Context Engineering](docs/context-engineering.md) | Priority scoring, Jaccard deduplication, and boundary-safe truncation |
| ⚡ [AI Enhancement Pipeline](docs/ai-enhancement-pipeline.md) | Two-pass Gemini extraction, model lifecycle, and transcript preservation |
| 🕷️ [Scraping Engine](docs/scraping-engine.md) | Platform selector matrices, zero-thrashing CSS, and media proxying |
| 💉 [Injection Engine](docs/injection-engine.md) | HTML5 `DataTransfer` file drop mode, SPA state sync, and Shadow DOM |
| 🛠️ [Troubleshooting & FAQ](docs/troubleshooting.md) | Solutions for selector shifts, HTTP 404s, rate limits, and storage quotas |
| 📨 [Internal API Reference](docs/api-reference.md) | Complete runtime message contracts, data schemas, and storage keys |

---

## 🗺️ Roadmap

- [ ] **Local Vector Store:** WASM-powered SQLite-VSS for semantic context search across past chats.
- [ ] **Visual Context Timeline:** Interactive dependency tree showing how code decisions evolved.
- [ ] **Cross-Device Sync:** Optional client-side end-to-end encrypted backup.
- [ ] **Agentic Handoffs:** Structured schema exports for autonomous coding agents (Claude Code, Antigravity, Cursor).

---

## 🤝 Contributing

Contributions, selector updates, and bug fixes are very welcome! Please review the [Contributing Guide](CONTRIBUTING.md) for details on code style, platform testing, and pull request conventions.

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for details.

---

## 👥 Author

Created and maintained by **[Shriraj888](https://github.com/Shriraj888)**.
