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

function compressTranscriptForApi(messages) {
  const MAX_FULL_MESSAGES = 8; // keep last 8 messages fully intact
  const len = messages.length;
  
  return messages.map((msg, idx) => {
    const isRecent = idx >= len - MAX_FULL_MESSAGES;
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    let content = msg.content || '';

    if (isRecent) {
      return `\n[${roleLabel}]:\n${content}\n`;
    }

    // Omit short conversational fluff in older messages
    const cleanText = content.trim().toLowerCase();
    if (cleanText.length < 25) {
      const isFluff = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|perfect|awesome|sure|done|sounds good|agree)/.test(cleanText);
      if (isFluff) {
        return ''; // filters out completely
      }
    }

    // Compress code blocks in older messages
    content = content.replace(/```([\s\S]*?)```/g, (match, code) => {
      if (code.length > 200) {
        const lines = code.trim().split('\n');
        if (lines.length > 6) {
          const firstLines = lines.slice(0, 3).join('\n');
          const lastLines = lines.slice(-3).join('\n');
          return `\`\`\`\n${firstLines}\n... [${lines.length - 6} lines of code omitted for token optimization] ...\n${lastLines}\n\`\`\``;
        }
        return `\`\`\`\n[Code block omitted for token optimization]\n\`\`\``;
      }
      return match;
    });

    // Truncate very long older messages
    if (content.length > 1500) {
      content = content.substring(0, 1500) + '\n... [Remaining text truncated for token optimization] ...';
    }

    return `\n[${roleLabel}]:\n${content}\n`;
  }).filter(Boolean).join('');
}

const SYSTEM_INSTRUCTIONS = `You are a Context Distillation and Transfer Engine. Your goal is to transform noisy multi-turn LLM conversations into a clean, structured, token-efficient JSON memory object for cross-LLM transfer.

Please execute:
1. Assign priority (1-10) to key memories (tech stack, requirements, decisions, errors). Limit priority_memories array to max 5-8 high-priority items.
2. Deduplicate repeated explanations/code. Keep only the most complete version. Limit deduplicated_context array to max 5 items.
3. Distill and compress context, removing conversational fluff.
4. Classify conversation types (Coding, Debugging, Research, Brainstorming, Planning, Studying, Writing, Architecture Design).
5. Generate a concise title (max 6-8 words) and an optimized handoff prompt starting with "[🔄 AI-Enhanced Cross Context Transfer]" that synthesizes active state, variables, errors, code files, and asks for user direction.
Limit all other arrays in the output JSON to a maximum of 5-6 highly relevant items each to maintain token efficiency.`;

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
    const slicedMessages = context.messages.slice(-MAX_GEMINI_MESSAGES);
    const promptText = compressTranscriptForApi(slicedMessages);

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
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTIONS }]
        },
        generationConfig: {
          temperature: 0.2,
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
