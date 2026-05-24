// Cross Context — Background Service Worker
// Handles messaging between popup and content scripts

const MAX_SAVED_CONTEXTS = 10;
const MAX_IMAGE_FETCH_BYTES = 2 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 12000;
const MAX_GEMINI_MESSAGES = 60;
const MAX_GEMINI_PROMPT_CHARS = 60000;
const MAX_GEMINI_IMAGES = 5;

// ──────────────────────────────────────────────
// Message Router
// ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    SAVE_CONTEXT:     () => handleSaveContext(message.payload, sendResponse),
    GET_CONTEXTS:     () => handleGetContexts(sendResponse),
    DELETE_CONTEXT:   () => handleDeleteContext(message.id, sendResponse),
    CLEAR_CONTEXTS:   () => handleClearContexts(sendResponse),
    INJECT_CONTEXT:   () => handleInjectContext(message.payload, sendResponse),
    SCRAPE_REQUEST:   () => handleScrapeRequest(message, sendResponse),
    FETCH_IMAGE_BASE64: () => handleFetchImageBase64(message.url, sendResponse),
  };

  const handler = handlers[message.type];
  if (handler) {
    handler();
    return true; // keep channel open for async
  }
});

// ──────────────────────────────────────────────
// Storage Handlers
// ──────────────────────────────────────────────
async function handleSaveContext(context, sendResponse) {
  try {
    const { contexts = [], geminiApiKey, aiEnhancementEnabled } = await chrome.storage.local.get([
      'contexts',
      'geminiApiKey',
      'aiEnhancementEnabled'
    ]);

    const isAiScrape = !!context.isAiScrape;
    const hasKey = !!geminiApiKey;
    const isAiEnabled = aiEnhancementEnabled !== false; // default to true if key is present

    const newContext = {
      id: generateId(),
      platform: context.platform,
      title: context.title || generateTitle(context),
      messages: context.messages,
      messageCount: context.messages.length,
      timestamp: Date.now(),
      url: context.url || '',
      aiStatus: (isAiScrape && hasKey && isAiEnabled) ? 'pending' : 'idle',
    };

    // Prepend new context, keep only MAX_SAVED_CONTEXTS
    const updated = [newContext, ...contexts].slice(0, MAX_SAVED_CONTEXTS);
    
    try {
      await chrome.storage.local.set({ contexts: updated });
    } catch (storageErr) {
      const errMsg = storageErr.message || '';
      if (errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('limit')) {
        sendResponse({ success: false, error: 'quota_exceeded' });
        return;
      }
      throw storageErr;
    }

    sendResponse({ success: true, context: newContext });

    // Kick off Gemini API enhancement asynchronously in background
    if (newContext.aiStatus === 'pending') {
      runGeminiEnhancement(newContext.id).catch(err => {
        console.error('Cross Context: runGeminiEnhancement background error', err);
      });
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleGetContexts(sendResponse) {
  try {
    const { contexts = [] } = await chrome.storage.local.get('contexts');
    sendResponse({ success: true, contexts });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleDeleteContext(id, sendResponse) {
  try {
    const { contexts = [] } = await chrome.storage.local.get('contexts');
    const updated = contexts.filter(c => c.id !== id);
    await chrome.storage.local.set({ contexts: updated });
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleClearContexts(sendResponse) {
  try {
    await chrome.storage.local.set({ contexts: [] });
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ──────────────────────────────────────────────
// Injection Handler — opens target tab and injects
// ──────────────────────────────────────────────
async function handleInjectContext(payload, sendResponse) {
  const { context, targetPlatform } = payload;

  const platformURLs = {
    claude:      'https://claude.ai/new',
    chatgpt:     'https://chatgpt.com/',
    gemini:      'https://gemini.google.com/app',
    grok:        'https://grok.com/',
    perplexity:  'https://www.perplexity.ai/',
  };

  const targetURL = platformURLs[targetPlatform];
  if (!targetURL) {
    sendResponse({ success: false, error: 'Unknown target platform' });
    return;
  }

  try {
    // Store pending injection in storage so content script can pick it up
    await chrome.storage.local.set({
      pendingInjection: {
        context,
        targetPlatform,
        timestamp: Date.now(),
      }
    });

    // Open target LLM in new tab
    const tab = await chrome.tabs.create({ url: targetURL });

    // Listen for tab to finish loading, then trigger injection
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Give the page's JS a moment to render
        setTimeout(async () => {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'DO_INJECT',
              targetPlatform,
              context,
            });
          } catch (e) {
            // Content script may not be ready yet, it will pick up from storage
            console.warn('Cross Context: Direct inject failed, content script will self-trigger.', e);
          }
        }, 2500);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    sendResponse({ success: true, tabId: tab.id });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ──────────────────────────────────────────────
// Scrape Request — tells content script to scrape
// ──────────────────────────────────────────────
async function handleScrapeRequest(message, sendResponse) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      sendResponse({ success: false, error: 'No active tab found.' });
      return;
    }

    // Ping script first to see if it is already alive and running
    let isAlive = false;
    try {
      const pingRes = await chrome.tabs.sendMessage(activeTab.id, { type: 'PING' });
      if (pingRes?.alive) {
        isAlive = true;
      }
    } catch (_) {
      // Content script not loaded yet
    }

    if (!isAlive) {
      try {
        // Inject script programmatically for pre-existing tab context
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['content/content.js'],
        });
        // Tiny wait for the VM to evaluate the IIFE
        await new Promise(r => setTimeout(r, 80));
      } catch (e) {
        sendResponse({ success: false, error: 'Could not load context injector on this tab: ' + e.message });
        return;
      }
    }

    const results = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'DO_SCRAPE',
      isAiScrape: !!message.isAiScrape
    });

    if (results?.success && results.context) {
      // Save directly from background so it survives popup closing!
      let saveResult = null;
      await handleSaveContext(
        { ...results.context, url: activeTab.url, isAiScrape: !!message.isAiScrape },
        (res) => { saveResult = res; }
      );
      sendResponse(saveResult || results);
    } else {
      sendResponse(results);
    }
  } catch (err) {
    sendResponse({
      success: false,
      error: 'Could not reach page. Try refreshing the LLM tab, then scrape again. (' + err.message + ')'
    });
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function generateId() {
  return `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateTitle(context) {
  // Use first user message as title (truncated)
  const firstUser = context.messages.find(m => m.role === 'user');
  if (firstUser) {
    return firstUser.content.substring(0, 60) + (firstUser.content.length > 60 ? '…' : '');
  }
  return `${context.platform} conversation`;
}

// ──────────────────────────────────────────────
// Image Fetcher & Bypass CORS
// ──────────────────────────────────────────────
async function handleFetchImageBase64(url, sendResponse) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'force-cache'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const contentType = res.headers.get('content-type') || '';
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
      throw new Error('URL did not return an image');
    }

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_FETCH_BYTES) {
      throw new Error('Image is too large to attach');
    }

    const blob = await res.blob();
    if (blob.size > MAX_IMAGE_FETCH_BYTES) {
      throw new Error('Image is too large to attach');
    }

    const mimeType = blob.type || 'image/png';
    const arrayBuffer = await blob.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);
    sendResponse({ success: true, base64: `data:${mimeType};base64,${base64Data}` });
  } catch (err) {
    console.error('Cross Context: Fetch image failed', url, err);
    sendResponse({ success: false, error: err.name === 'AbortError' ? 'Image fetch timed out' : err.message });
  } finally {
    clearTimeout(timeoutId);
  }
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

// ──────────────────────────────────────────────
// Gemini API Context Synthesis Pipeline
// ──────────────────────────────────────────────
async function runGeminiEnhancement(contextId) {
  try {
    // 1. Retrieve latest contexts and settings
    const { contexts = [], geminiApiKey, geminiModel } = await chrome.storage.local.get([
      'contexts',
      'geminiApiKey',
      'geminiModel'
    ]);

    const contextIndex = contexts.findIndex(c => c.id === contextId);
    if (contextIndex === -1) return;
    const context = contexts[contextIndex];

    const apiKey = geminiApiKey;
    const model = geminiModel || 'gemini-3.5-flash';

    if (!apiKey) {
      throw new Error('Missing Gemini API Key');
    }

    // 2. Build the text prompt representing the chat history
    let promptText = `You are an advanced AI Context Distillation and Transfer Engine.

Your purpose is to transform noisy multi-turn LLM conversations into a clean, structured, token-efficient portable memory object for cross-LLM transfer.

You are NOT a normal summarizer.

You must execute the following five phases:

---

## PHASE 1 — CONTEXT PRIORITY SCORING

Analyze every message and assign a priority score.

Priority Levels:

HIGH PRIORITY (Preserve ALL):
* project requirements
* architecture decisions
* technical stack
* user goals
* unresolved issues
* debugging context
* constraints
* API usage
* code logic
* user preferences
* important reasoning chains
* implementation plans
* successful solutions
* failed approaches worth avoiding

MEDIUM PRIORITY (Compress):
* explanations
* feature discussions
* brainstorming
* partial implementation ideas
* optimization discussions

LOW PRIORITY (Remove unless uniquely useful):
* greetings
* filler conversation
* conversational acknowledgements
* repeated confirmations
* jokes
* redundant assistant explanations
* duplicated summaries

Generate a score from 1–10 for every extracted memory item in the "priority_memories" list, describing the reason for its score.

---

## PHASE 2 — SEMANTIC DEDUPLICATION

The conversation may contain repeated information.

You MUST detect:
* repeated explanations
* repeated architecture discussions
* repeated code snippets
* repeated debugging information
* repeated user goals
* repeated decisions

Deduplication Rules:
1. Merge semantically identical information.
2. Preserve the BEST and MOST COMPLETE version.
3. Remove duplicate phrasing.
4. Store recurring concepts only once.
5. Track repetition frequency internally.

Fill the "deduplicated_context" list with these merged, high-signal entries.

---

## PHASE 3 — CONTEXT DISTILLATION

Extract and preserve ONLY:
* core project understanding
* active tasks
* unresolved blockers
* technical decisions
* implementation details
* user intent
* user preferences
* architecture
* current objective
* critical reasoning continuity

Compress aggressively while preserving meaning.

---

## PHASE 4 — INTELLIGENT CONTEXT CLASSIFICATION

Automatically classify "conversation_type" as one or more of:
* Coding
* Debugging
* Research
* Brainstorming
* Planning
* Studying
* Writing
* Architecture Design

Detect:
* current focus
* long-term project memory
* temporary context
* reusable developer preferences
* blockers
* unresolved dependencies

---

## ADDITIONAL METADATA

In addition to the distillation fields, you must generate:
1. "title": a very concise summary (max 6-8 words) of the conversation context to serve as the saved context card title.
2. "handoffPrompt": a highly efficient handoff prompt starting with "[🔄 AI-Enhanced Cross Context Transfer]". This prompt must:
   - Synthesize the conversation so the next LLM knows the exact state, codebase, and variables.
   - Describe what is shown in any uploaded images/diagrams so the next LLM has visual awareness.
   - Ask the next LLM to confirm receipt of context and prompt the user for the next action. Do NOT re-introduce itself.

Here is the conversation history:
`;

    context.messages.slice(-MAX_GEMINI_MESSAGES).some(msg => {
      const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
      const line = `\n[${roleLabel}]:\n${String(msg.content || '')}\n`;
      if (promptText.length + line.length > MAX_GEMINI_PROMPT_CHARS) {
        promptText += '\n[Transcript truncated to keep AI compression fast.]';
        return true;
      }
      promptText += line;
      return false;
    });

    const parts = [{ text: promptText }];

    // 3. Extract and parse a small set of unique images from messages
    const seenImages = new Set();
    let imageCount = 0;
    context.messages.forEach(msg => {
      if (msg.images && Array.isArray(msg.images)) {
        msg.images.forEach(dataUrl => {
          if (imageCount >= MAX_GEMINI_IMAGES || seenImages.has(dataUrl)) return;
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            seenImages.add(dataUrl);
            imageCount++;
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2]
              }
            });
          }
        });
      }
    });

    // 4. Call Google AI Studio Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              handoffPrompt: { type: "STRING" },
              project_summary: { type: "STRING" },
              current_task: { type: "STRING" },
              conversation_type: { type: "ARRAY", items: { type: "STRING" } },
              user_intent: { type: "STRING" },
              priority_memories: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    content: { type: "STRING" },
                    priority_score: { type: "INTEGER" },
                    priority_reason: { type: "STRING" }
                  },
                  required: ["content", "priority_score", "priority_reason"]
                }
              },
              deduplicated_context: { type: "ARRAY", items: { type: "STRING" } },
              architecture_decisions: { type: "ARRAY", items: { type: "STRING" } },
              technical_stack: { type: "ARRAY", items: { type: "STRING" } },
              constraints: { type: "ARRAY", items: { type: "STRING" } },
              important_code: { type: "ARRAY", items: { type: "STRING" } },
              errors_and_issues: { type: "ARRAY", items: { type: "STRING" } },
              successful_solutions: { type: "ARRAY", items: { type: "STRING" } },
              failed_attempts: { type: "ARRAY", items: { type: "STRING" } },
              pending_tasks: { type: "ARRAY", items: { type: "STRING" } },
              user_preferences: { type: "ARRAY", items: { type: "STRING" } },
              temporary_context: { type: "ARRAY", items: { type: "STRING" } },
              long_term_memory: { type: "ARRAY", items: { type: "STRING" } },
              ai_inferred_context: { type: "ARRAY", items: { type: "STRING" } },
              removed_low_priority_context_count: { type: "INTEGER" },
              deduplication_stats: {
                type: "OBJECT",
                properties: {
                  duplicate_items_removed: { type: "INTEGER" },
                  merged_concepts: { type: "INTEGER" },
                  estimated_token_reduction_percent: { type: "NUMBER" }
                },
                required: ["duplicate_items_removed", "merged_concepts", "estimated_token_reduction_percent"]
              },
              context_quality: {
                type: "OBJECT",
                properties: {
                  signal_to_noise_ratio: { type: "NUMBER" },
                  context_completeness: { type: "NUMBER" },
                  transfer_readiness_score: { type: "NUMBER" }
                },
                required: ["signal_to_noise_ratio", "context_completeness", "transfer_readiness_score"]
              }
            },
            required: [
              "title",
              "handoffPrompt",
              "project_summary",
              "current_task",
              "conversation_type",
              "user_intent",
              "priority_memories",
              "deduplicated_context",
              "architecture_decisions",
              "technical_stack",
              "constraints",
              "important_code",
              "errors_and_issues",
              "successful_solutions",
              "failed_attempts",
              "pending_tasks",
              "user_preferences",
              "temporary_context",
              "long_term_memory",
              "ai_inferred_context",
              "removed_low_priority_context_count",
              "deduplication_stats",
              "context_quality"
            ]
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API Error: HTTP ${response.status} - ${errText}`);
    }

    const resJson = await response.json();
    const textResult = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) {
      throw new Error('Empty response received from Gemini API');
    }

    const parsedResult = JSON.parse(textResult);

    // 5. Save updated context back to storage
    const latest = await chrome.storage.local.get('contexts');
    const updatedContexts = latest.contexts || [];
    const idx = updatedContexts.findIndex(c => c.id === contextId);
    if (idx !== -1) {
      updatedContexts[idx].aiStatus = 'success';
      updatedContexts[idx].title = parsedResult.title || updatedContexts[idx].title;
      updatedContexts[idx].aiEnhanced = {
        // Base mapping to keep old simple visual interfaces safe
        summary: parsedResult.project_summary || '',
        keyPoints: parsedResult.architecture_decisions || [],
        visualAnalysis: '',
        handoffPrompt: parsedResult.handoffPrompt,

        // Full advanced structured memory
        project_summary: parsedResult.project_summary,
        current_task: parsedResult.current_task,
        conversation_type: parsedResult.conversation_type,
        user_intent: parsedResult.user_intent,
        priority_memories: parsedResult.priority_memories,
        deduplicated_context: parsedResult.deduplicated_context,
        architecture_decisions: parsedResult.architecture_decisions,
        technical_stack: parsedResult.technical_stack,
        constraints: parsedResult.constraints,
        important_code: parsedResult.important_code,
        errors_and_issues: parsedResult.errors_and_issues,
        successful_solutions: parsedResult.successful_solutions,
        failed_attempts: parsedResult.failed_attempts,
        pending_tasks: parsedResult.pending_tasks,
        user_preferences: parsedResult.user_preferences,
        temporary_context: parsedResult.temporary_context,
        long_term_memory: parsedResult.long_term_memory,
        ai_inferred_context: parsedResult.ai_inferred_context,
        removed_low_priority_context_count: parsedResult.removed_low_priority_context_count,
        deduplication_stats: parsedResult.deduplication_stats,
        context_quality: parsedResult.context_quality
      };
      await chrome.storage.local.set({ contexts: updatedContexts });
    }

  } catch (err) {
    console.error('Cross Context: runGeminiEnhancement error', err);
    // Mark as failed in storage
    const latest = await chrome.storage.local.get('contexts');
    const updatedContexts = latest.contexts || [];
    const idx = updatedContexts.findIndex(c => c.id === contextId);
    if (idx !== -1) {
      updatedContexts[idx].aiStatus = 'failed';
      updatedContexts[idx].aiError = err.message || 'Gemini processing failed';
      await chrome.storage.local.set({ contexts: updatedContexts });
    }
  }
}
