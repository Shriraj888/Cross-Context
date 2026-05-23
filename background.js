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
    sendResponse(results);
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
    let promptText = `You are a context handoff agent. Your task is to compress and synthesize the following chat transcript (and any associated images) into a highly efficient handoff context package for another LLM.

Analyze the user's intent, the assistant's responses, the decisions made, code snippets generated, and any visual diagrams or screenshots.

Generate:
1. A concise title that captures the technical topic (max 6-8 words).
2. A brief 2-3 sentence summary of the current project/task state.
3. 3-5 bullet points of key technical decisions, resolved code architecture, and open issues.
4. An analysis of any provided images/diagrams, explaining what they represent and how they fit into the conversation context.
5. A highly efficient handoff prompt starting with "[🔄 AI-Enhanced Cross Context Transfer]". This prompt must:
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
              summary: { type: "STRING" },
              keyPoints: { type: "ARRAY", items: { type: "STRING" } },
              visualAnalysis: { type: "STRING" },
              handoffPrompt: { type: "STRING" }
            },
            required: ["title", "summary", "keyPoints", "handoffPrompt"]
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
        summary: parsedResult.summary,
        keyPoints: parsedResult.keyPoints,
        visualAnalysis: parsedResult.visualAnalysis || '',
        handoffPrompt: parsedResult.handoffPrompt
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
