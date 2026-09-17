# Changelog

All notable changes to the **Cross Context** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-09-17

### Added
- **Multi-Platform Scraping Engine**:
  - High-resilience scrapers for Claude (`claude.ai`), ChatGPT (`chatgpt.com`), Gemini (`gemini.google.com`), Grok (`grok.com`, `x.com/i/grok`, `x.ai`), and Perplexity (`perplexity.ai`).
  - Zero-thrashing DOM extraction utilizing temporary `.cc-scraping-active` styling rules to strip UI chrome, actions, feedback buttons, and copy controls.
  - Hierarchical Markdown reconstruction preserving tables, code blocks, lists, and headers.
  - Viewport auto-scrolling heuristic to load virtualized chat logs.
  - Inline image and SVG extraction with CORS bypass proxying, 1024px downscaling, and Base64 compilation.
- **Dual-Mode Injection Engine**:
  - File Attachment Mode: Generates in-memory Markdown files (`context-con_01.md`) and attaches them using the HTML5 `DataTransfer` API and synthetic drag-and-drop events.
  - Upload Readiness Polling: Actively polls for platform DOM attachment chips before typing companion prompts or submitting.
  - Fallback Text Mode: Resilient text injection supporting `document.execCommand`, native HTML prototype setters, and synthetic input/change event dispatching.
  - Floating preview confirmation overlay rendered inside an isolated Shadow DOM.
- **AI-Enhanced Handoff Pipeline**:
  - Optional Google Gemini API integration with support for `gemini-3.5-flash` and `gemini-3.6-flash`.
  - Two-pass sequential distillation pipeline:
    - Pass 1: Compact, schema-enforced technical fact extraction (stack, errors, decisions, tasks, code).
    - Pass 2: Grounded first-person voice handoff prompt synthesis.
  - Verbatim conversation transcript integration beneath AI-distilled briefs.
- **Context Intelligence & Memory Management**:
  - Deterministic information density scoring (+1.5 to +3.0 for technical decisions/errors, -2.0 for conversational fluff).
  - Jaccard similarity algorithmic deduplication to eliminate redundant code snippets and repeated turns.
  - Whole-message boundary truncation respecting the 80,000-character transfer safety budget without breaking Markdown syntax.
  - Sequential Context ID generator (`con_01`, `con_02`...) for cross-session tracking.
  - Multi-context session merger to combine multiple saved states into a unified briefing.
- **Obsidian & Electric Cyan Popup Interface**:
  - Real-time active tab detection with animated radar scanner indicator.
  - Interactive context management with search, filter tags, and quick-delete actions.
  - `context.md` preview tab with syntax highlighting, token count estimation, and download options.
  - Glassmorphic toast notification engine with spring physics and auto-dismiss timer bars.
- **Security & Privacy Safeguards**:
  - Strict host-permission scoping matching only supported platform origins.
  - Zero external telemetry or remote server storage; all snapshots persist locally in `chrome.storage.local`.
  - Server-Side Request Forgery (SSRF) protection on the background image proxy (`isSafeImageUrl`), blocking `localhost`, private IP ranges, and link-local metadata endpoints.
  - Storage quota auto-recovery with graceful image eviction when approaching Chrome limits.
