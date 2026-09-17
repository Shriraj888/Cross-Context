# AI Enhancement Pipeline

Cross Context includes an optional, privacy-conscious AI Distillation Pipeline powered by Google's Gemini API. When enabled, it transforms lengthy, noisy conversation threads into structured, dense engineering handoff briefs.

---

## 💡 Why AI Distillation?

While raw transcripts preserve every word, long chats can consume tens of thousands of tokens on greetings, repetitive errors, and superseded code iterations. 

The AI Enhancement Pipeline:
- Extracts core technical decisions and architectural rules.
- Isolates active bugs and unresolved stack traces.
- Synthesizes an executive handoff briefing written in the **first-person developer voice** (*"I was implementing OAuth login with Supabase..."*).
- **Preserves the verbatim conversation transcript** underneath the synthesized brief for complete ground-truth verification.

---

## ⚡ Two-Pass Sequential Pipeline

To prevent hallucinations and guarantee strict JSON compliance, Cross Context divides the enhancement into two sequential passes:

```
                          ┌─────────────────────────────┐
                          │ Scraped Raw Conversation DOM│
                          └──────────────┬──────────────┘
                                         │
                                         ▼
                          ┌─────────────────────────────┐
                          │ Preprocessing & Compression │
                          └──────────────┬──────────────┘
                                         │
                                         ▼
                          ┌─────────────────────────────┐
                          │ Pass 1: Technical Facts     │
                          │ Extraction (JSON Schema)    │
                          └──────────────┬──────────────┘
                                         │ Structured Facts Payload
                                         ▼
                          ┌─────────────────────────────┐
                          │ Pass 2: Grounded Context    │
                          │ Synthesis (First-Person)    │
                          └──────────────┬──────────────┘
                                         │
                                         ▼
                          ┌─────────────────────────────┐
                          │ Final Hand-off Markdown +   │
                          │ Full Verbatim Transcript    │
                          └─────────────────────────────┘
```

### Preprocessing & Compaction
Before sending data to the API:
- Conversational greetings and short affirmative phrases are stripped from older turns.
- Maximum message turns sent to Gemini are capped at 60 (`MAX_GEMINI_MESSAGES`).
- Older code snippets are consolidated to avoid exceeding rate limits (`MAX_GEMINI_PROMPT_CHARS = 60,000`).

---

### Pass 1: Technical Facts Extraction

Pass 1 queries Gemini with a strict JSON schema designed to extract objective facts without subjective summarizing:

```json
{
  "technical_stack": ["React 18", "Vite", "TailwindCSS", "Zustand"],
  "architecture_decisions": [
    "Use optimistic updates in the user profile store",
    "Persist token refresh rotation in secure HTTP-only cookies"
  ],
  "errors_and_issues": [
    "TypeError: Cannot read properties of undefined (reading 'headers') at client.js:42"
  ],
  "pending_tasks": [
    "Implement refresh token retry queue",
    "Add unit tests for error boundary fallback"
  ],
  "files_mentioned": ["src/api/client.js", "src/store/userStore.js"],
  "important_code": ["// Exact critical functions discussed"],
  "user_preferences": [
    "Prefers TypeScript interfaces over type aliases",
    "Enforce functional components only"
  ]
}
```

---

### Pass 2: Grounded Context Synthesis

Pass 2 takes both the raw transcript and the structured facts extracted in Pass 1 to produce:
1. **Title:** A concise, punchy title (6–8 words, e.g. *"Fixing Auth Token Refresh in Zustand Client"*).
2. **Project Summary:** A clear explanation of what is being built.
3. **Current Task:** The exact step the user was working on when the limit was hit.
4. **Handoff Prompt:** A prompt written in the **user's active voice** instructing the receiving model on what to do next without meta-robotic overhead.

---

## 📜 Full Transcript Preservation

Early versions of AI summarization discarded the original transcript once the summary was generated. Cross Context guarantees that **the complete verbatim transcript is always appended** to the final handoff file:

```markdown
# 📄 Cross-Context Knowledge Transfer — Context ID: `con_01`

> ⚠️ SYSTEM INSTRUCTION FOR RECEIVING AI MODEL...

## 🎯 Executive Hand-off Briefing
[AI-Synthesized First-Person Handoff Prompt]

## 🛠️ Technical Decisions & Architecture
[Pass 1 Structured Facts]

---

## 💬 Full Conversation Transcript
### 👤 User
[Verbatim user message]

### 🤖 Claude
[Verbatim assistant reply with full original code]
```

This guarantees that if the synthesis pass misses any subtle detail, the receiving model has the ground truth available in the same file.

---

## 🤖 Supported Gemini Models

Cross Context connects directly to Google AI Studio's Gemini endpoints:

| Model ID | Status | Notes |
|----------|--------|-------|
| `gemini-3.5-flash` | **Default / Active** | High speed, cost-effective, excellent schema adherence. |
| `gemini-3.6-flash` | **Supported** | Latest GA release from Google AI Studio. |
| `Custom Model` | **Supported** | Enter any custom endpoint model name in Settings. |

> [!WARNING]
> Legacy models (`gemini-1.5-flash` and `gemini-2.0-flash`) have reached end-of-life and are deprecated by Google. Using them will result in HTTP 404 errors.

---

## 🛡️ Error Handling & Fallbacks

- **HTTP 404 Translation:** If an invalid or discontinued model name is configured, Cross Context surfaces a descriptive error:
  `"Selected model is no longer available — please choose gemini-3.5-flash in Settings."`
- **Graceful Degradation:** If an API call times out, encounters a rate limit (HTTP 429), or fails due to network disruption, Cross Context automatically falls back to **Deterministic Heuristic Formatting**. The conversation is never lost.
- **Key Storage:** Your Gemini API key is stored strictly within your browser's private `chrome.storage.local` sandbox and is sent directly to `https://generativelanguage.googleapis.com`.
