# Internal API & Message Reference

This document outlines the internal messaging contracts, storage keys, and data schemas utilized by Cross Context across the Popup, Background Service Worker, and Content Scripts.

---

## 📨 Runtime Message Contracts

All communication between extension components uses standard `chrome.runtime.sendMessage` channels.

### Message Router Table

| Message Type | Sender | Receiver | Payload | Response | Description |
|--------------|--------|----------|---------|----------|-------------|
| `SAVE_CONTEXT` | Popup | Background | `payload: ContextObject` | `{ success: boolean, context: ContextObject, evictedTitle?: string }` | Saves a new conversation snapshot. Triggers auto-pruning if count > 10. |
| `GET_CONTEXTS` | Popup | Background | *(none)* | `{ contexts: ContextObject[] }` | Retrieves all saved snapshots from local storage. |
| `DELETE_CONTEXT` | Popup | Background | `id: string` | `{ success: boolean }` | Deletes a specific snapshot by its ID. |
| `CLEAR_CONTEXTS` | Popup | Background | *(none)* | `{ success: boolean }` | Clears all saved snapshots from storage. |
| `INJECT_CONTEXT` | Popup | Background | `payload: { context, targetPlatform }` | `{ success: boolean, targetTabId?: number }` | Orchestrates target tab opening and initiates injection polling. |
| `SCRAPE_REQUEST` | Background / Popup | Content Script | `{ isAiScrape?: boolean }` | `{ success: boolean, data: ScrapedData }` | Commands the active page content script to parse and extract the conversation DOM. |
| `FETCH_IMAGE_BASE64`| Content Script | Background | `url: string` | `{ success: boolean, dataUrl?: string, error?: string }` | Background proxy to fetch external chat images with SSRF validation and downscale to 1024px. |
| `PING` | Background | Content Script | *(none)* | `{ alive: true, platform?: string }` | Liveness check sent by `pollAndInject()` to determine if the target page content script is ready. |
| `DO_INJECT` | Background | Content Script | `payload: InjectionPayload` | `{ success: boolean, mode: 'file' \| 'text' }` | Commands the target page content script to perform the state restoration. |

---

## 🗄️ Storage Schema (`chrome.storage.local`)

| Storage Key | Type | Description |
|-------------|------|-------------|
| `contexts` | `Array<ContextObject>` | List of saved conversation snapshots (maximum 10 items). |
| `geminiApiKey` | `string` | User's Google AI Studio Gemini API key. |
| `geminiModel` | `string` | Selected default Gemini model (`gemini-3.5-flash` or `gemini-3.6-flash`). |
| `customGeminiModel` | `string` | User-defined custom Gemini model name override. |
| `aiEnhancementEnabled`| `boolean` | Flag indicating whether AI Distillation should run during capture. Default: `true`. |
| `pendingInjection` | `object \| null` | Temporary handoff payload consumed by newly opened tabs upon loading. |

---

## 📋 Data Schemas

### 1. `ContextObject`

```typescript
interface ContextObject {
  id: string;                      // e.g. "con_01"
  platform: 'claude' | 'chatgpt' | 'gemini' | 'grok' | 'perplexity';
  title: string;                   // Short descriptive conversation title
  messages: Array<MessageTurn>;    // Extracted conversation history
  messageCount: number;            // Total turns in the transcript
  timestamp: number;               // Epoch millisecond timestamp
  url: string;                     // Source page URL
  aiStatus: 'idle' | 'pending' | 'success' | 'failed';
  aiError?: string;                // Error message if distillation failed
  aiEnhanced?: AiEnhancedPayload;  // Populated when AI distillation succeeds
  truncated?: boolean;             // True if prompt exceeded 80,000 chars
  truncatedAt?: number;            // Character count threshold used for truncation
}
```

### 2. `MessageTurn`

```typescript
interface MessageTurn {
  role: 'user' | 'assistant';
  content: string;                 // Clean Markdown text
  images?: Array<{
    dataUrl: string;               // Base64 JPEG Data URI
    width: number;
    height: number;
  }>;
}
```

### 3. `AiEnhancedPayload`

```typescript
interface AiEnhancedPayload {
  project_summary: string;         // Executive description of what is being built
  current_task: string;            // The active goal or roadblock
  user_intent: string;             // Category: coding | debugging | research | etc.
  technical_stack: string[];       // Detected languages, frameworks, libraries
  architecture_decisions: string[];// High-level design choices made
  errors_and_issues: string[];     // Active stack traces or bug descriptions
  pending_tasks: string[];         // Next-step checklists
  files_mentioned: string[];       // Codebase files referenced in discussion
  important_code: string[];        // Preserved snippets and configurations
  user_preferences: string[];      // Coding preferences (e.g. TypeScript, functional)
  handoffPrompt: string;           // First-person synthesized instruction prompt
}
```
