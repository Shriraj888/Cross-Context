# Cross Context — Copilot Documentation

> **For AI Assistants (GitHub Copilot, Claude, Cursor, etc.):**  
> This document is the canonical reference for the Cross Context Chrome Extension codebase. Read this before making any changes. It covers architecture, file responsibilities, platform-specific logic, known issues, and context engineering design decisions.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [Architecture Overview](#3-architecture-overview)
4. [Manifest & Permissions](#4-manifest--permissions)
5. [Content Script — `content/content.js`](#5-content-script--contentcontentjs)
   - [Platform Detection](#51-platform-detection)
   - [Scraping Session Management](#52-scraping-session-management)
   - [Scraper Strategies](#53-scraper-strategies)
   - [Injector System](#54-injector-system)
   - [Drag-and-Drop UI](#55-drag-and-drop-ui)
   - [Message Listener](#56-message-listener)
6. [Background Service Worker — `background.js`](#6-background-service-worker--backgroundjs)
   - [Message Router](#61-message-router)
   - [Storage Handlers](#62-storage-handlers)
   - [Injection Handler](#63-injection-handler)
   - [Gemini AI Enhancement Pipeline](#64-gemini-ai-enhancement-pipeline)
   - [Memory Graph Augmentation](#65-memory-graph-augmentation)
7. [Context Intelligence Engine — `utils/formatter.js`](#7-context-intelligence-engine--utisformatterjs)
   - [ContextIntelligenceEngine Class](#71-contextintelligenceengine-class)
   - [formatContextPrompt Function](#72-formatcontextprompt-function)
8. [Storage Utility — `utils/storage.js`](#8-storage-utility--utilsstoragejs)
9. [Popup — `popup/`](#9-popup--popup)
10. [Platform Scrapers](#10-platform-scrapers)
    - [Claude Scraper](#101-claude-scraper)
    - [ChatGPT Scraper](#102-chatgpt-scraper)
    - [Gemini Scraper](#103-gemini-scraper)
    - [Grok Scraper](#104-grok-scraper)
    - [Perplexity Scraper](#105-perplexity-scraper)
11. [Platform Injectors](#11-platform-injectors)
12. [Context Engineering Design](#12-context-engineering-design)
    - [Token Budget Management](#121-token-budget-management)
    - [Gemini Extraction Schema](#122-gemini-extraction-schema)
    - [Handoff Prompt Format](#123-handoff-prompt-format)
    - [Memory Graph](#124-memory-graph)
13. [Known Issues & Technical Debt](#13-known-issues--technical-debt)
14. [Constants & Configuration Reference](#14-constants--configuration-reference)
15. [Data Shapes Reference](#15-data-shapes-reference)
16. [Improvement Roadmap](#16-improvement-roadmap)

---

## 1. Project Overview

**Cross Context** is a Manifest V3 Chrome extension that lets users capture a conversation from one LLM platform (e.g., Claude) and inject it as a structured context handoff into another (e.g., ChatGPT, Gemini, Grok, Perplexity).

**Supported platforms:** Claude · ChatGPT · Gemini · Grok · Perplexity

**Core flow:**
```
User on LLM page
  → clicks popup "Capture"
  → content script scrapes DOM conversation
  → background saves context + runs optional Gemini AI enhancement
  → user drags saved context card to another platform's drop zone
    OR clicks "Send To" from popup
  → content script injector inserts formatted prompt into target input
  → auto-submit fires (or user manually sends)
```

**Key design principle:** The extension never proxies API traffic or stores conversation data in the cloud. Everything lives in `chrome.storage.local`.

---

## 2. Repository Structure

```
cross_context/
├── manifest.json                  # MV3 manifest — permissions, content scripts, icons
├── background.js                  # Service worker: message router, storage, Gemini API
│
├── content/
│   ├── content.js                 # ⚠️  THE SINGLE RUNTIME CONTENT SCRIPT
│   │                              #     All platform scrapers and injectors are
│   │                              #     bundled INLINE here. Do not confuse with
│   │                              #     the files in /scrapers/ and /injectors/.
│   ├── scrapers/                  # Reference implementations (NOT loaded at runtime)
│   │   ├── claude.js
│   │   ├── chatgpt.js
│   │   ├── gemini.js
│   │   ├── grok.js
│   │   └── perplexity.js
│   └── injectors/                 # Reference implementations (NOT loaded at runtime)
│       ├── claude.js
│       ├── chatgpt.js
│       ├── gemini.js
│       ├── grok.js
│       └── perplexity.js
│
├── utils/
│   ├── formatter.js               # ContextIntelligenceEngine + formatContextPrompt
│   └── storage.js                 # Thin wrappers over chrome.runtime.sendMessage
│
├── popup/
│   ├── popup.html
│   ├── popup.js                   # All popup UI logic (~2075 lines)
│   └── popup.css
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    ├── icon128.png
    └── logo.png
```

> ⚠️ **Critical note for Copilot:** The files in `content/scrapers/` and `content/injectors/` are **not imported anywhere**. They exist as readable reference/documentation only. All runtime scraping and injection logic lives inside the `SCRAPERS` and `INJECTORS` objects in `content/content.js`. Any bug fix or feature change must be made **in `content/content.js`**, not in the individual platform files. This is a known architectural debt item.

---

## 3. Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│  LLM Page (e.g., claude.ai)                                    │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  content/content.js  (injected by MV3 content_scripts)  │  │
│  │                                                         │  │
│  │  • detectPlatform()                                     │  │
│  │  • SCRAPERS[platform].scrapeConversation()              │  │
│  │  • INJECTORS[platform](formattedPrompt)                 │  │
│  │  • Drag-and-drop overlay UI                             │  │
│  │  • chrome.runtime.onMessage listener                    │  │
│  └──────────────────┬──────────────────────────────────────┘  │
│                     │  chrome.runtime.sendMessage              │
└─────────────────────┼──────────────────────────────────────────┘
                      │
┌─────────────────────▼──────────────────────────────────────────┐
│  background.js  (Service Worker)                               │
│                                                                │
│  Message Router:                                               │
│  SAVE_CONTEXT → handleSaveContext()                            │
│  GET_CONTEXTS → handleGetContexts()                            │
│  DELETE_CONTEXT → handleDeleteContext()                        │
│  CLEAR_CONTEXTS → handleClearContexts()                        │
│  INJECT_CONTEXT → handleInjectContext()  → opens new tab       │
│  SCRAPE_REQUEST → handleScrapeRequest()  → pings content.js    │
│  FETCH_IMAGE_BASE64 → handleFetchImageBase64()                 │
│                                                                │
│  Async:  runGeminiEnhancement(contextId)                       │
│          └── Google AI Studio API call                         │
│          └── augmentMemoryGraph()                              │
│          └── saves back to chrome.storage.local                │
└────────────────────────────────────────────────────────────────┘
                      │
┌─────────────────────▼──────────────────────────────────────────┐
│  chrome.storage.local                                          │
│                                                                │
│  {                                                             │
│    contexts: Context[],        // max 10 saved contexts        │
│    geminiApiKey: string,                                       │
│    geminiModel: string,                                        │
│    aiEnhancementEnabled: boolean,                              │
│    pendingInjection: PendingInjection | null                   │
│  }                                                             │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. Manifest & Permissions

**File:** `manifest.json`

| Field | Value | Notes |
|---|---|---|
| `manifest_version` | 3 | MV3 — no background pages, service workers only |
| `permissions` | `activeTab`, `storage`, `tabs`, `scripting` | `scripting` needed for dynamic injection via `executeScript` |
| `host_permissions` | All 5 LLM domains + `x.com` | Required for `tabs.sendMessage` to work cross-origin |
| `content_scripts[].run_at` | `document_idle` | Runs after DOMContentLoaded + subresources |
| `content_scripts[].all_frames` | `false` | Top frame only — avoids injecting into iframes |
| `background.type` | `module` | Allows ES module `import` in service worker |
| `web_accessible_resources` | `icons/*.png` | Needed for icon display in drop overlay injected into LLM pages |

**Grok note:** Grok is hosted on both `grok.com` and `x.com/i/grok`. Both patterns are in `host_permissions` and `content_scripts.matches`.

---

## 5. Content Script — `content/content.js`

This is a 3449-line IIFE (Immediately Invoked Function Expression). It runs on every matched LLM page.

### 5.1 Platform Detection

```js
function detectPlatform() {
  if (hostname.includes('claude.ai'))         return 'claude';
  if (hostname.includes('chatgpt.com'))       return 'chatgpt';
  if (hostname.includes('gemini.google.com')) return 'gemini';
  if (hostname.includes('grok.com'))          return 'grok';
  if (hostname.includes('x.com') && pathname.includes('grok')) return 'grok';
  if (hostname.includes('perplexity.ai'))     return 'perplexity';
  return null;
}
```

If `detectPlatform()` returns `null`, the script exits immediately.

### 5.2 Scraping Session Management

To get clean text from LLM pages without capturing UI chrome (copy buttons, thumbs-up icons, action bars), the scraper temporarily hides those elements using a dynamically injected `<style>` tag:

```js
// A temporary stylesheet hides all UI chrome elements
// while innerText is read from the live DOM.
// This avoids layout thrashing from clone-and-append patterns.

function startScrapingSession() { ... }  // injects <style id="cc-scrape-temp-style">
function endScrapingSession() { ... }    // removes the style tag
function getInnerText(el) { ... }        // reads innerText within an active session
```

**CSS class used:** `cc-scraping-active` is added to `document.documentElement`.

**Elements hidden:** buttons, SVGs, role="button", action-bars, toolbars, copy-buttons, feedback/thumbs, citations, `<sup>`, share buttons, speech buttons.

**Why `innerText` on live DOM (not cloneNode)?**
Cloning and appending to a detached fragment triggers full layout recalculation. Using `innerText` on the live element with the CSS hiding approach reads the computed text without thrashing.

### 5.3 Scraper Strategies

Each platform scraper in the `SCRAPERS` object runs up to 4 strategies in sequence, returning on the first success:

#### Strategy 1 — LCA (Lowest Common Ancestor) Turn Extractor
```
extractConversationViaLCA(userSelectors, assistantSelectors, copyButtonSelectors)
```
- Queries user and assistant elements.
- Walks up the DOM to find the chat container (the element that is the direct parent of all top-level turn elements).
- Classifies each direct child of the container as user/assistant/unknown.
- Returns ordered messages.

**Best for:** Claude, ChatGPT (when `data-message-author-role` is present).

#### Strategy 2 — Interleaved DOM Order
```
interleaveByDomOrder(userEls, assistantEls)
```
- Merges user and assistant element arrays.
- Calls `filterTopLevelOnly()` to remove nested duplicates.
- Sorts by `compareDocumentPosition`.

**Best for:** Platforms with clear, separate user/assistant element types.

#### Strategy 3 — Next-Sibling Anchor
```
humanTurns.forEach(humanEl => { walk siblings/parents to find assistant response })
```
- For each found user element, walks next siblings (up to 8 depth levels) to find the following assistant response.

**Best for:** Platforms where user/assistant are not cleanly interleaved.

#### Strategy 4 — Alternating Fallback
```
allMessages = document.querySelectorAll('[class*="prose"] > p, ...')
```
- Grabs all prose/markdown content nodes.
- Assigns alternating roles.

**Last resort.** Lowest accuracy but prevents complete failure.

#### Shared helper: `filterInputArea(el)`
Excludes any element that is an `<input>`, `<textarea>`, `contenteditable`, or inside: compose areas, forms, footers, navs, sidebars.

#### Shared helper: `deduplicate(messages)`
Removes consecutive messages with the same role and identical content string.

#### Shared helper: `hasBothRoles(msgs)`
Returns true only if there is at least one non-empty user message AND one non-empty assistant message.

### 5.4 Injector System

The `INJECTORS` object maps platform name → async injection function.

All injectors share these helpers:

```js
function insertTextProgrammatically(el, text)
// Fires: beforeinput (InputEvent), execCommand('insertText'), 
//        fallback to .innerText assignment, then input/change events.
// Handles both TEXTAREA/INPUT and contenteditable (ProseMirror, Quill, Lexical).

function trySubmit(inputEl, submitSelectors)
// Clicks the submit button if found and not disabled.
// Falls back to KeyboardEvent Enter on the input element.

async function waitForElement(selectors, maxRetries=15, interval=700)
// Polls every 700ms for up to ~10.5 seconds before giving up.
```

Auto-submit fires after a `sleep(1500)` delay post-injection. There is currently no "preview before send" option.

**Platform-specific input selectors:**

| Platform | Input Selector |
|---|---|
| Claude | `div.ProseMirror[contenteditable="true"]`, `[data-testid="compose-input"] [contenteditable]` |
| ChatGPT | `#prompt-textarea`, `div[contenteditable="true"].ProseMirror` |
| Gemini | `rich-textarea [contenteditable="true"]`, `.ql-editor[contenteditable="true"]` |
| Grok | `textarea[placeholder]`, `div[contenteditable="true"]` |
| Perplexity | `textarea[placeholder]`, `div[contenteditable="true"]` |

**Submit button selectors:**

| Platform | Submit Selector |
|---|---|
| Claude | `button[aria-label*="Send"], button[data-testid*="send"]` |
| ChatGPT | `[data-testid="send-button"], button[aria-label="Send message"]` |
| Gemini | `button.send-button, button[aria-label*="Send"]` |
| Grok | `button[type="submit"], button[aria-label*="Send"]` |
| Perplexity | `button[aria-label*="submit"], button[type="submit"]` |

### 5.5 Drag-and-Drop UI

The content script injects a circular drop overlay into each LLM page. Users can drag saved context cards from the popup onto this overlay to inject.

- Overlay element: `#cc-drop-target`
- Platform colors are defined in `PLATFORM_COLORS` map
- States: idle → drag-over → injecting → success/error
- On drop, fires the same injection flow as the popup's "Send To" button

### 5.6 Message Listener

```js
chrome.runtime.onMessage.addListener(window.__crossContextListener = (message, sender, sendResponse) => {
  // PING         → { alive: true }
  // DO_SCRAPE    → runs scraper, returns scraped context
  // DO_INJECT    → runs injector with message.context and message.targetPlatform
});
```

The listener is idempotent — it removes any previous instance before registering to handle extension reloads cleanly.

---

## 6. Background Service Worker — `background.js`

Runs as an ES module service worker (`"type": "module"`).

### 6.1 Message Router

```js
const handlers = {
  SAVE_CONTEXT:       handleSaveContext,
  GET_CONTEXTS:       handleGetContexts,
  DELETE_CONTEXT:     handleDeleteContext,
  CLEAR_CONTEXTS:     handleClearContexts,
  INJECT_CONTEXT:     handleInjectContext,
  SCRAPE_REQUEST:     handleScrapeRequest,
  FETCH_IMAGE_BASE64: handleFetchImageBase64,
};
```

All handlers call `sendResponse` and return `true` to keep the message channel open for async work.

### 6.2 Storage Handlers

**`handleSaveContext(context, sendResponse)`**
1. Reads current `contexts`, `geminiApiKey`, `aiEnhancementEnabled` from storage.
2. Instantiates `ContextIntelligenceEngine`, calls `processConversation()`, saves `memoryGraph`.
3. Constructs a `Context` object (see [Data Shapes](#15-data-shapes-reference)).
4. Prepends to the contexts array, slices to `MAX_SAVED_CONTEXTS = 10`.
5. Writes to `chrome.storage.local`. Catches quota errors and returns `{ success: false, error: 'quota_exceeded' }`.
6. If `aiStatus === 'pending'`, kicks off `runGeminiEnhancement(newContext.id)` asynchronously.

**`handleGetContexts`** — reads and returns `contexts` array.

**`handleDeleteContext(id)`** — filters context by id, saves.

**`handleClearContexts`** — sets `contexts: []`.

### 6.3 Injection Handler

**`handleInjectContext({ context, targetPlatform })`**
1. Writes `pendingInjection` to storage (content script self-triggers from this on load).
2. Opens target platform URL via `chrome.tabs.create`.
3. Attaches `chrome.tabs.onUpdated` listener.
4. On tab `status === 'complete'`, waits 2500ms then sends `DO_INJECT` message to content script.

> ⚠️ **Known issue:** The 2500ms flat delay is fragile. On slow connections injection silently fails. The content script has a retry-based `waitForElement` helper that should be used here instead.

### 6.4 Gemini AI Enhancement Pipeline

**`runGeminiEnhancement(contextId)`** — async, runs after save, does not block the user.

**Flow:**
```
1. Load context from storage
2. compressTranscriptForApi(messages)  →  token-efficient transcript string
3. Extract up to MAX_GEMINI_IMAGES (5) unique base64 images from messages
4. POST to:
   https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
   with systemInstruction + structured responseSchema (JSON mode)
5. Parse JSON response
6. Call augmentMemoryGraph() with parsed result
7. Save aiStatus = 'success', aiEnhanced = {...} back to storage
   OR aiStatus = 'failed', aiError = message on error
```

**`compressTranscriptForApi(messages)`**

| Condition | Behavior |
|---|---|
| Last 8 messages | Included in full |
| Older messages < 25 chars + conversational fluff | Omitted entirely |
| Older messages with code blocks > 200 chars | Code trimmed to first+last 3 lines |
| Older messages > 1500 chars | Truncated at 1500 with notice |

**Model:** Defaults to `'gemini-3.5-flash'` — ⚠️ **This is an invalid model name.** Should be `'gemini-1.5-flash'` or `'gemini-2.0-flash'`. See [Known Issues](#13-known-issues--technical-debt).

**Temperature:** `0.2` — low for deterministic structured extraction.

**System Instructions (`SYSTEM_INSTRUCTIONS`):**
```
You are a Context Distillation and Transfer Engine. Your goal is to transform 
noisy multi-turn LLM conversations into a clean, structured, token-efficient 
JSON memory object for cross-LLM transfer.

Execute:
1. Priority scoring (1–10) for key memories
2. Deduplication of repeated explanations/code
3. Distillation and compression
4. Conversation type classification
5. Title generation (max 6–8 words) + handoff prompt generation
```

### 6.5 Memory Graph Augmentation

**`augmentMemoryGraph(memoryGraph, aiEnhanced)`**

After Gemini returns structured data, this function:
1. Removes existing deterministic TASK, DECISION, ISSUE, PREFERENCE nodes.
2. Re-adds them using the AI-distilled versions (higher quality).
3. Adds TECH_STACK nodes for each item in `aiEnhanced.technical_stack`.
4. Connects all nodes to `project_root` with typed edges.
5. Cross-links TASK/ISSUE/DECISION nodes to TECH_STACK nodes when the tech name appears in the label.

---

## 7. Context Intelligence Engine — `utils/formatter.js`

### 7.1 ContextIntelligenceEngine Class

Instantiated in `handleSaveContext` to build a memory graph from raw scraped messages **before** the optional Gemini enhancement step.

**Key methods:**

```js
scoreMessage(content, role) → number (1–10)
```
Priority scoring. Factors: user role (+1), code block (+3), high-signal keywords (+1.5 each, max +4), low-signal keywords (−2 each, max −4).

High-signal patterns: `requirement`, `architecture`, `tech stack`, `error`, `bug`, `debugging`, `decision`, `config`, `how to`, etc.

Low-signal patterns: `hello`, `hi`, `thanks`, `awesome`, `perfect`, `ok`, `yes`.

```js
calculateJaccard(str1, str2) → number (0–1)
```
Word-level Jaccard similarity. Used for semantic deduplication. Threshold: `> 0.45` treated as duplicate.

```js
deduplicateItems(items) → string[]
```
Canonical deduplication — keeps the longer/more complete version when similarity > 0.45 or one string subsumes the other.

```js
processConversation(messages)
```
Main pipeline. For each message:
- Extracts tech stack mentions against a hardcoded keyword list.
- Extracts tasks from `- [ ]`, `- [x]`, `TODO:`, `task:` prefixes. Falls back to sentence-level scan.
- Extracts decisions from `decided`, `let's use`, `we will use`.
- Extracts issues from `error`, `bug`, `fail`, `crash`, `exception`.
- Tracks `solvedProblems` and `failedApproaches` in `executionContext`.
- Adds nodes and edges to the memory graph.

```js
getStructuredPacket() → object
```
Returns a flat object summarizing the memory graph:
```js
{
  priority_memory: string[],       // top 8 scored memories
  active_tasks: string[],
  unresolved_issues: string[],
  important_decisions: string[],
  execution_context: {
    topics_discussed: string[],
    problems_solved: string[],
    approaches_to_avoid: string[],
    current_focus: string
  },
  user_preferences: string[]
}
```

### 7.2 formatContextPrompt Function

```js
formatContextPrompt(context, targetPlatform) → string
```

Produces the final prompt string that gets injected into the target LLM.

**Two modes:**

**AI-Enhanced mode** (when `context.aiStatus === 'success'`):
- Detects `dominantIntent` from `aiEnhanced.conversation_type` array.
- Routes to one of 5 intent-specific templates: `coding`, `debugging`, `brainstorming`, `research`, `writing`.
- Each template includes relevant fields from `aiEnhanced` (summary, task, tech stack, code snippets, errors, pending tasks, etc.).

**Deterministic fallback mode** (no AI enhancement):
- Uses the structured packet from `ContextIntelligenceEngine.getStructuredPacket()`.
- Includes priority memories, active tasks, tech stack, topics discussed, raw conversation turns (last N turns up to `MAX_TURNS = 40`).

**Token limits:**
- `MAX_TURNS = 40` — max conversation turns included
- `CHAR_LIMIT = 80000` — ~20k token safety cutoff

---

## 8. Storage Utility — `utils/storage.js`

Thin message-passing wrappers. These are used by the popup. The content script sends messages directly.

```js
saveContext(context)           → sendMessage({ type: 'SAVE_CONTEXT', payload: context })
getContexts()                  → sendMessage({ type: 'GET_CONTEXTS' })
deleteContext(id)              → sendMessage({ type: 'DELETE_CONTEXT', id })
clearContexts()                → sendMessage({ type: 'CLEAR_CONTEXTS' })
injectContext(context, target) → sendMessage({ type: 'INJECT_CONTEXT', payload: { context, targetPlatform } })
```

All return Promises that resolve with the `sendResponse` value from `background.js`.

---

## 9. Popup — `popup/`

The popup is a standard HTML/CSS/JS panel (~2075 lines of JS).

**Responsibilities:**
- Displays saved contexts as cards.
- "Capture" button → sends `SCRAPE_REQUEST` to background.
- "AI Capture" button → sends `SCRAPE_REQUEST` with `isAiScrape: true`.
- "Send To [Platform]" → sends `INJECT_CONTEXT` to background.
- Settings panel for Gemini API key, model selection, AI enhancement toggle.
- Shows `aiStatus` badge on each context card (`pending` → spinner, `success` → ✓, `failed` → ✗).
- Renders `memoryGraph` visually (nodes and edges).
- Context deletion and clear-all.

**Key popup → background messages:**
- `SCRAPE_REQUEST` with `isAiScrape: boolean`
- `INJECT_CONTEXT` with `{ context, targetPlatform }`
- `GET_CONTEXTS`
- `DELETE_CONTEXT`
- `CLEAR_CONTEXTS`

---

## 10. Platform Scrapers

> **Reminder:** The files in `content/scrapers/` are reference-only. Runtime logic is in `content/content.js` inside the `SCRAPERS` object.

### 10.1 Claude Scraper

**User selectors:**
```
[data-testid="user-message"], [data-testid="human-turn"], [data-is-human="true"],
.font-user-message, [class*="UserMessage"], [class*="human-turn"], [class*="user-message"]
```

**Assistant selectors:**
```
[data-testid="assistant-message"], [data-testid="assistant-turn"], [data-is-human="false"],
.font-claude-message, .prose, [class*="prose"], [class*="markdown"], [class*="ClaudeMessage"]
```

**Copy button selectors (for LCA hints):**
```
button[data-testid="action-bar-copy"], button[aria-label*="Copy" i], [class*="action-bar"] button
```

**Strategy order:** LCA → Interleave → Next-sibling → Alternating

**Title extraction:** `document.title.replace(/-–|]?\s*Claude.*$/i, '').trim()`

### 10.2 ChatGPT Scraper

**Role detection approach:** Uses `data-message-author-role` attribute on ancestor elements via `getRoleFromAncestor(el)` — this is unique to ChatGPT's DOM structure and more reliable than class-based detection.

**User selectors:**
```
[data-message-author-role="user"], [data-testid*="human"], [class*="user-message"]
```

**Assistant selectors:**
```
[data-message-author-role="assistant"], [class*="markdown"], .prose
```

**Key difference from Claude:** ChatGPT's DOM wraps messages in `[data-message-id]` containers. The scraper walks ancestors to find the `data-message-author-role` attribute rather than relying on class names alone.

### 10.3 Gemini Scraper

**Primary selectors:**
```js
userMessages:  'user-query, [class*="user-query"], .user-query-container'
modelMessages: 'model-response, [class*="model-response"], .model-response-text'
```

**Ordering:** Uses `getBoundingClientRect().top + window.scrollY` for sort order.

> ⚠️ **Known issue:** `getBoundingClientRect` returns 0 for off-screen elements in virtual scroll. Should use `compareDocumentPosition` instead.

**Fallback:** Queries `[data-message-id]` and guesses role by whether the element is inside a `user-query` ancestor.

**Weakest scraper** — only 2 strategies, no LCA or sibling-walk.

### 10.4 Grok Scraper

**User selectors:**
```
[class*="UserMessage"], [class*="user-message"], [data-testid*="user"],
[class*="human"], [class*="HumanTurn"]
```

**Assistant selectors:**
```
[class*="BotMessage"], [class*="AssistantMessage"], [class*="bot-message"],
[class*="assistant-message"], [class*="GrokResponse"]
```

**Note:** Grok on `x.com/i/grok` and `grok.com` share the same scraper.

### 10.5 Perplexity Scraper

**Unique characteristic:** Perplexity threads often include source citations and inline references. The scraper's CSS session hides `[class*="citation"]`, `[class*="source"]`, `<sup>` before `innerText` extraction.

**User selectors:**
```
[class*="UserQuery"], [class*="user-query"], [data-testid*="query"]
```

**Assistant selectors:**
```
[class*="Answer"], [class*="AnswerBody"], [class*="prose"], .markdown
```

---

## 11. Platform Injectors

> **Reminder:** The files in `content/injectors/` are reference-only. Runtime logic is in `content/content.js` inside the `INJECTORS` object.

All injectors follow this pattern:
```
1. waitForElement(inputSelectors)    ← polls with retry
2. insertTextProgrammatically(el, formattedPrompt)
3. sleep(1500)
4. trySubmit(el, submitButtonSelectors)
```

**`insertTextProgrammatically` detail:**
```js
1. Dispatches `beforeinput` InputEvent (for Lexical/Draft.js/ProseMirror state bindings)
2. For TEXTAREA/INPUT: execCommand('insertText') → fallback to nativeValueSetter + events
3. For contenteditable: selectAll → execCommand('insertText') → fallback to .innerText + events
4. Dispatches `input` InputEvent (triggers React/Vue state updates)
```

> ⚠️ `document.execCommand` is deprecated. It still works in Chrome as of 2026 but should be migrated to Clipboard API or InputEvent-based insertion.

---

## 12. Context Engineering Design

### 12.1 Token Budget Management

Before sending conversation history to Gemini, `compressTranscriptForApi` applies a compression policy:

```
Recent (last 8 messages):  Full content preserved
Older messages:
  - Short fluff (< 25 chars, greetings/affirmations) → omitted
  - Code blocks > 200 chars → trimmed to first 3 + last 3 lines
  - Messages > 1500 chars → truncated at 1500 chars
Hard ceiling: MAX_GEMINI_PROMPT_CHARS = 60,000 chars
Image limit:  MAX_GEMINI_IMAGES = 5 unique images
```

### 12.2 Gemini Extraction Schema

The Gemini call uses `responseMimeType: "application/json"` with a strict `responseSchema`. This forces structured JSON output rather than markdown-wrapped text.

**Extracted fields:**

| Field | Type | Description |
|---|---|---|
| `title` | string | 6–8 word summary title |
| `handoffPrompt` | string | Full formatted context handoff prompt |
| `project_summary` | string | 1–3 sentence project overview |
| `current_task` | string | What the user was actively working on |
| `conversation_type` | string[] | e.g., `["Coding", "Debugging"]` |
| `user_intent` | string | Specific goal in this session |
| `priority_memories` | object[] | `{ content, priority_score, priority_reason }` — max 8 |
| `deduplicated_context` | string[] | Unique concepts after dedup — max 5 |
| `architecture_decisions` | string[] | Key design choices made |
| `technical_stack` | string[] | Technologies detected |
| `constraints` | string[] | Constraints or requirements |
| `important_code` | string[] | Critical code snippets |
| `errors_and_issues` | string[] | Bugs/errors encountered |
| `successful_solutions` | string[] | What worked |
| `failed_attempts` | string[] | What didn't work |
| `pending_tasks` | string[] | Unfinished items |
| `user_preferences` | string[] | User's stated style preferences |
| `temporary_context` | string[] | Session-specific context that won't persist |
| `long_term_memory` | string[] | Reusable facts about the project |
| `ai_inferred_context` | string[] | Implicit context the AI inferred |
| `deduplication_stats` | object | `{ duplicate_items_removed, merged_concepts, estimated_token_reduction_percent }` |
| `context_quality` | object | `{ signal_to_noise_ratio, context_completeness, transfer_readiness_score }` |

### 12.3 Handoff Prompt Format

The formatted prompt injected into the target LLM starts with one of these headers based on `dominantIntent`:

```
[🔄 AI-Enhanced Cross Context Transfer — Optimized for Coding]
[🔄 AI-Enhanced Cross Context Transfer — Optimized for Debugging]
[🔄 AI-Enhanced Cross Context Transfer — Optimized for Research]
[🔄 AI-Enhanced Cross Context Transfer — Optimized for Brainstorming]
[🔄 AI-Enhanced Cross Context Transfer — Optimized for Writing]
```

The Gemini `SYSTEM_INSTRUCTIONS` asks Gemini to generate this handoff prompt and start it with `[🔄 AI-Enhanced Cross Context Transfer]`.

> ⚠️ **Context engineering note:** This prompt is injected as a **user message**, not as a system prompt. It is written in a meta-instructive third-person voice ("You are continuing a session..."). This can cause the target LLM to treat the meta-description as literal user intent. Consider rewriting handoff prompts as first-person user briefings: "I was working on X. Here's the state: [...]. Please continue from [task]."

### 12.4 Memory Graph

The memory graph is a simple node/edge store computed on every save.

**Node types:** `PROJECT`, `TECH_STACK`, `TASK`, `DECISION`, `ISSUE`, `PREFERENCE`

**Edge types:** `IMPLEMENTED_WITH`, `DEPENDS_ON`, `RELATED_TO`, `BLOCKED_BY`, `INFLUENCED_BY`

**Root node:** Every graph has a `project_root` node of type `PROJECT`.

The graph is stored in `context.memoryGraph` but is **not currently used for selective retrieval** during injection. It is displayed visually in the popup. This is an open improvement opportunity — subgraph traversal (`getRelevantSubgraph`) is implemented but not called during handoff generation.

---

## 13. Known Issues & Technical Debt

| ID | Severity | Location | Description |
|---|---|---|---|
| BUG-001 | 🔴 Critical | `background.js:491` | Default model `'gemini-3.5-flash'` is invalid. Should be `'gemini-1.5-flash'` or `'gemini-2.0-flash'`. Causes silent 404 failures for all users who don't explicitly set a model. |
| BUG-002 | 🔴 Critical | `content/scrapers/`, `content/injectors/` | All files are dead code — never imported or loaded. Runtime logic is inlined in `content.js`. Fixes must be made in `content.js`, not the individual files. |
| BUG-003 | 🟡 Medium | `background.js:165` | Injection tab wait is a flat `setTimeout(2500)` — fragile on slow connections. |
| BUG-004 | 🟡 Medium | `scrapers/gemini.js` | Uses `getBoundingClientRect` for DOM ordering. Fails for virtual-scroll pages where off-screen elements return `top: 0`. |
| BUG-005 | 🟡 Medium | All injectors | `document.execCommand('insertText')` is deprecated. Works currently but will eventually break. |
| BUG-006 | 🟡 Medium | All injectors | No "preview before send" — auto-submit fires after 1500ms with no user confirmation. |
| BUG-007 | 🟡 Medium | `background.js:52` | Storage quota errors return `{ error: 'quota_exceeded' }` but there is no automatic recovery (e.g., evicting old contexts, stripping image data from old entries). |
| BUG-008 | 🟡 Medium | `formatter.js:formatContextPrompt` | 5 near-identical intent template branches — `files_mentioned` is only used in the `coding` template, silently dropped from `debugging`, `research`, etc. |
| DEBT-001 | 🟡 Medium | `content/content.js` | File is 3449 lines. No build pipeline. Platform files are maintained separately but never used. Should be unified with a bundler (esbuild/Rollup). |
| DEBT-002 | 🟡 Medium | `utils/formatter.js` | Memory graph `getRelevantSubgraph()` is implemented but never called during handoff generation. Graph is built and stored but not leveraged for selective context retrieval. |
| DEBT-003 | 🟢 Low | `background.js:SYSTEM_INSTRUCTIONS` | Single-shot prompt asks Gemini to extract 20+ fields simultaneously. Accuracy degrades for lower-priority fields in long conversations. |

---

## 14. Constants & Configuration Reference

**`background.js`**

| Constant | Value | Purpose |
|---|---|---|
| `MAX_SAVED_CONTEXTS` | `10` | Hard cap on stored contexts |
| `MAX_IMAGE_FETCH_BYTES` | `2MB` | Max bytes for background image fetching |
| `IMAGE_FETCH_TIMEOUT_MS` | `12000` | Timeout for image background fetch |
| `MAX_GEMINI_MESSAGES` | `60` | Max messages sliced before Gemini call |
| `MAX_GEMINI_PROMPT_CHARS` | `60000` | Hard char ceiling on Gemini prompt text |
| `MAX_GEMINI_IMAGES` | `5` | Max unique images sent to Gemini |

**`formatter.js`**

| Constant | Value | Purpose |
|---|---|---|
| `MAX_TURNS` | `40` | Max turns in deterministic fallback prompt |
| `CHAR_LIMIT` | `80000` | ~20k token safety limit for injected prompt |

**`content.js`**

| Constant | Value | Purpose |
|---|---|---|
| `AI_MEDIA_LIMIT` | `5` | Max images extracted per message |
| `AI_MEDIA_CONCURRENCY` | `3` | Concurrent image processing tasks |
| `AI_MEDIA_MAX_DIMENSION` | `1024` | Max image dimension before resize |
| `AI_MEDIA_JPEG_QUALITY` | `0.82` | JPEG quality for compressed images |

---

## 15. Data Shapes Reference

**`Context` object (stored in `chrome.storage.local`):**

```typescript
interface Context {
  id: string;                      // generateId() — timestamp-based unique ID
  platform: 'claude' | 'chatgpt' | 'gemini' | 'grok' | 'perplexity';
  title: string;
  messages: Message[];
  messageCount: number;
  timestamp: number;               // Date.now()
  url: string;
  aiStatus: 'idle' | 'pending' | 'success' | 'failed';
  aiError?: string;                // present when aiStatus === 'failed'
  memoryGraph: MemoryGraph;
  aiEnhanced?: AIEnhanced;         // present when aiStatus === 'success'
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  element?: Element;               // transient — not saved to storage
  images?: string[];               // base64 data URLs
}

interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

interface MemoryNode {
  id: string;
  type: 'PROJECT' | 'TECH_STACK' | 'TASK' | 'DECISION' | 'ISSUE' | 'PREFERENCE';
  label: string;
  properties: Record<string, any>;
}

interface MemoryEdge {
  from: string;
  to: string;
  type: 'IMPLEMENTED_WITH' | 'DEPENDS_ON' | 'RELATED_TO' | 'BLOCKED_BY' | 'INFLUENCED_BY';
}

interface AIEnhanced {
  // Convenience fields
  summary: string;
  keyPoints: string[];
  handoffPrompt: string;

  // Full structured fields (from Gemini response)
  project_summary: string;
  current_task: string;
  conversation_type: string[];
  user_intent: string;
  priority_memories: { content: string; priority_score: number; priority_reason: string }[];
  deduplicated_context: string[];
  architecture_decisions: string[];
  technical_stack: string[];
  constraints: string[];
  important_code: string[];
  errors_and_issues: string[];
  successful_solutions: string[];
  failed_attempts: string[];
  pending_tasks: string[];
  user_preferences: string[];
  temporary_context: string[];
  long_term_memory: string[];
  ai_inferred_context: string[];
  files_mentioned: string[];
  removed_low_priority_context_count: number;
  deduplication_stats: {
    duplicate_items_removed: number;
    merged_concepts: number;
    estimated_token_reduction_percent: number;
  };
  context_quality: {
    signal_to_noise_ratio: number;
    context_completeness: number;
    transfer_readiness_score: number;
  };
}
```

**`PendingInjection` object:**
```typescript
interface PendingInjection {
  context: Context;
  targetPlatform: string;
  timestamp: number;
}
```

---

## 16. Improvement Roadmap

Listed in priority order.

### P0 — Bug Fixes (do these first)

- **Fix Gemini default model name** in `background.js:491`. Change `'gemini-3.5-flash'` → `'gemini-2.0-flash'`.
- **Add preview-before-send** — before auto-submitting in any injector, show the formatted prompt to the user with a confirm/cancel step.
- **Add storage quota recovery** — on `quota_exceeded`, auto-evict image data from the oldest context(s) before retrying the save.

### P1 — Scraping Improvements

- **Gemini scraper:** Replace `getBoundingClientRect` ordering with `compareDocumentPosition`. Add a strategy that walks `[role="main"]` children by DOM order as fallback.
- **Virtual scroll support (ChatGPT, Claude):** Add a `MutationObserver` or scroll-to-top + observe approach to capture messages that were never rendered in the DOM.
- **Truncation flag:** When `CHAR_LIMIT` is hit, add `{ truncated: true, truncatedAt: turnIndex }` to the saved context so the UI can display a warning.

### P2 — Injection Improvements

- **Replace flat `setTimeout(2500)` in injection handler** with a poll-based approach using the `waitForElement` helper already in `content.js`.
- **Append vs. replace:** Detect if the target input has existing content before injection; offer append or replace options.
- **Migrate `execCommand`** to `InputEvent` + Clipboard API for future-proofing.

### P3 — Context Engineering

- **Split Gemini extraction into 2 passes:** Pass 1 extracts structured facts. Pass 2 generates the handoff prompt using those facts as grounded input. Reduces hallucinated/shallow field values.
- **Rewrite handoff prompt template** as first-person user briefing rather than meta-instructions (see [Section 12.3](#123-handoff-prompt-format)).
- **Use the memory graph for retrieval** — call `getRelevantSubgraph(focusNodeId)` during formatting to inject only the most contextually relevant nodes, not all of them.
- **Intent-specific compression** — coding sessions should prioritize recent + code turns; brainstorming should prioritize early goal-setting turns + recent synthesis.

### P4 — Architecture

- **Add a build pipeline** (esbuild or Rollup) to bundle `content/scrapers/*.js` and `content/injectors/*.js` into `content/content.js`. Eliminates dead code and makes maintenance sane.
- **Separate image storage** — store base64 image data under separate storage keys with TTL-based eviction (e.g., drop image data from contexts older than 24h). Keep text indefinitely.
- **Increase `MAX_SAVED_CONTEXTS`** to 25 after image storage is separated.

---

*Last updated: May 2026 | Author: Shriraj888 | Project: Cross Context Chrome Extension*