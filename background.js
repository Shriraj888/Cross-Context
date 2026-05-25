// Cross Context — Background Service Worker
// Handles messaging between popup and content scripts

import { ContextIntelligenceEngine } from './utils/formatter.js';

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

    const engine = new ContextIntelligenceEngine();
    engine.processConversation(context.messages);
    const memoryGraph = {
      nodes: Array.from(engine.nodes.entries()).map(([id, node]) => ({ id, ...node })),
      edges: engine.edges
    };

    const newContext = {
      id: generateId(),
      platform: context.platform,
      title: context.title || generateTitle(context),
      messages: context.messages,
      messageCount: context.messages.length,
      timestamp: Date.now(),
      url: context.url || '',
      aiStatus: (isAiScrape && hasKey && isAiEnabled) ? 'pending' : 'idle',
      memoryGraph: memoryGraph,
    };

    // Prepend new context, keep only MAX_SAVED_CONTEXTS
    const updated = [newContext, ...contexts].slice(0, MAX_SAVED_CONTEXTS);
    
    try {
      await chrome.storage.local.set({ contexts: updated });
    } catch (storageErr) {
      const errMsg = storageErr.message || '';
      if (errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('limit')) {
        // Auto-recovery: strip image data from oldest contexts and retry
        const recovered = await evictImagesForQuota(updated);
        if (recovered) {
          try {
            await chrome.storage.local.set({ contexts: recovered });
          } catch (retryErr) {
            sendResponse({ success: false, error: 'quota_exceeded' });
            return;
          }
        } else {
          sendResponse({ success: false, error: 'quota_exceeded' });
          return;
        }
      } else {
        throw storageErr;
      }
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

    // Listen for tab to finish loading, then poll for content script readiness
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Poll-based readiness: ping content script until alive, then inject
        pollAndInject(tab.id, targetPlatform, context);
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

function augmentMemoryGraph(memoryGraph, aiEnhanced) {
  if (!memoryGraph || !memoryGraph.nodes) {
    memoryGraph = { nodes: [], edges: [] };
  }

  // 1. Remove existing local rough TASK, DECISION, ISSUE, PREFERENCE nodes to replace them with AI-distilled ones
  if (Array.isArray(aiEnhanced.pending_tasks) && aiEnhanced.pending_tasks.length > 0) {
    memoryGraph.nodes = memoryGraph.nodes.filter(n => n.type !== 'TASK');
    memoryGraph.edges = memoryGraph.edges.filter(e => !e.from.includes('_task_') && !e.to.includes('_task_') && !e.from.startsWith('ai_task_') && !e.to.startsWith('ai_task_'));
  }
  if (Array.isArray(aiEnhanced.architecture_decisions) && aiEnhanced.architecture_decisions.length > 0) {
    memoryGraph.nodes = memoryGraph.nodes.filter(n => n.type !== 'DECISION');
    memoryGraph.edges = memoryGraph.edges.filter(e => !e.from.includes('_dec_') && !e.to.includes('_dec_') && !e.from.startsWith('ai_dec_') && !e.to.startsWith('ai_dec_'));
  }
  if (Array.isArray(aiEnhanced.errors_and_issues) && aiEnhanced.errors_and_issues.length > 0) {
    memoryGraph.nodes = memoryGraph.nodes.filter(n => n.type !== 'ISSUE');
    memoryGraph.edges = memoryGraph.edges.filter(e => !e.from.includes('_issue_') && !e.to.includes('_issue_') && !e.from.startsWith('ai_issue_') && !e.to.startsWith('ai_issue_'));
  }
  if (Array.isArray(aiEnhanced.user_preferences) && aiEnhanced.user_preferences.length > 0) {
    memoryGraph.nodes = memoryGraph.nodes.filter(n => n.type !== 'PREFERENCE');
    memoryGraph.edges = memoryGraph.edges.filter(e => !e.from.startsWith('ai_pref_') && !e.to.startsWith('ai_pref_'));
  }

  // Helper to check if node exists
  const hasNode = (id) => memoryGraph.nodes.some(n => n.id === id);
  // Helper to add node
  const addNode = (id, type, label, properties = {}) => {
    if (!hasNode(id)) {
      memoryGraph.nodes.push({ id, type, label, properties });
    }
  };
  // Helper to add edge
  const addEdge = (from, to, type) => {
    const exists = memoryGraph.edges.some(e => e.from === from && e.to === to && e.type === type);
    const hasFrom = hasNode(from);
    const hasTo = hasNode(to);
    if (!exists && hasFrom && hasTo) {
      memoryGraph.edges.push({ from, to, type });
    }
  };

  // Ensure project_root is present
  addNode('project_root', 'PROJECT', 'Active Working Project', { description: 'Target transfer workspace' });

  // 2. Add Technical Stack
  if (Array.isArray(aiEnhanced.technical_stack)) {
    aiEnhanced.technical_stack.forEach(tech => {
      const techId = `tech_${tech.toLowerCase().replace(/\s+/g, '_')}`;
      addNode(techId, 'TECH_STACK', tech, { name: tech });
      addEdge(techId, 'project_root', 'IMPLEMENTED_WITH');
    });
  }

  // 3. Add Architecture Decisions
  if (Array.isArray(aiEnhanced.architecture_decisions)) {
    aiEnhanced.architecture_decisions.forEach((dec, idx) => {
      const decId = `ai_dec_${idx}`;
      addNode(decId, 'DECISION', dec);
      addEdge(decId, 'project_root', 'RELATED_TO');
    });
  }

  // 4. Add Pending Tasks
  if (Array.isArray(aiEnhanced.pending_tasks)) {
    aiEnhanced.pending_tasks.forEach((task, idx) => {
      const taskId = `ai_task_${idx}`;
      addNode(taskId, 'TASK', task, { status: 'active' });
      addEdge(taskId, 'project_root', 'DEPENDS_ON');
    });
  }

  // 5. Add Errors and Issues
  if (Array.isArray(aiEnhanced.errors_and_issues)) {
    aiEnhanced.errors_and_issues.forEach((err, idx) => {
      const issueId = `ai_issue_${idx}`;
      addNode(issueId, 'ISSUE', err);
      addEdge(issueId, 'project_root', 'BLOCKED_BY');
    });
  }

  // 6. Add User Preferences
  if (Array.isArray(aiEnhanced.user_preferences)) {
    aiEnhanced.user_preferences.forEach((pref, idx) => {
      const prefId = `ai_pref_${idx}`;
      addNode(prefId, 'PREFERENCE', pref);
      addEdge(prefId, 'project_root', 'INFLUENCED_BY');
    });
  }

  // 7. Add connections from Tasks/Issues/Decisions to Tech Stack if mentions exist
  memoryGraph.nodes.forEach(node => {
    if (node.type === 'TASK' || node.type === 'ISSUE' || node.type === 'DECISION') {
      memoryGraph.nodes.forEach(techNode => {
        if (techNode.type === 'TECH_STACK') {
          const techName = techNode.properties.name.toLowerCase();
          if (node.label.toLowerCase().includes(techName)) {
            addEdge(node.id, techNode.id, 'RELATED_TO');
          }
        }
      });
    }
  });

  return memoryGraph;
}

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
// Storage Quota Recovery
// ──────────────────────────────────────────────

/**
 * Strips image data from the oldest contexts to free storage quota.
 * Iterates from the oldest context to the newest, removing images
 * until at least one context has been stripped. Returns the modified array.
 */
async function evictImagesForQuota(contexts) {
  if (!Array.isArray(contexts) || contexts.length === 0) return null;

  let evicted = false;
  // Work from oldest (end) to newest (start)
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (!ctx.messages) continue;

    let hadImages = false;
    ctx.messages.forEach(msg => {
      if (msg.images && msg.images.length > 0) {
        hadImages = true;
        msg.images = []; // strip all base64 image data
      }
    });

    if (hadImages) {
      evicted = true;
      console.log(`Cross Context: Evicted image data from context "${ctx.title}" to recover quota.`);
      break; // Try one context at a time
    }
  }

  return evicted ? contexts : null;
}

// ──────────────────────────────────────────────
// Poll-based Injection Readiness
// ──────────────────────────────────────────────

/**
 * Polls the target tab's content script via PING until it responds,
 * then sends the DO_INJECT message. Replaces the fragile setTimeout(2500).
 * Retries up to maxAttempts with increasing delay.
 */
async function pollAndInject(tabId, targetPlatform, context, maxAttempts = 15, baseDelay = 500) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const delay = Math.min(baseDelay + attempt * 200, 2000);
    await new Promise(r => setTimeout(r, delay));

    try {
      const pingRes = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (pingRes?.alive) {
        // Content script is ready — send injection
        try {
          await chrome.tabs.sendMessage(tabId, {
            type: 'DO_INJECT',
            targetPlatform,
            context,
          });
        } catch (injectErr) {
          console.warn('Cross Context: DO_INJECT failed after successful PING.', injectErr);
        }
        return; // Done
      }
    } catch (_) {
      // Content script not loaded yet — continue polling
    }
  }

  // Exhausted all attempts — content script will self-trigger from pendingInjection storage
  console.warn('Cross Context: Poll-based injection timed out. Content script will self-trigger from storage.');
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

const SYSTEM_INSTRUCTIONS_PASS_1 = `You are a Technical Facts Extraction Engine. Your task is to extract factual details from the provided developer-AI conversation history.
Focus strictly on objective details:
1. technical_stack: The programming languages, frameworks, libraries, databases, and tooling mentioned.
2. errors_and_issues: Specific error messages, compiler warnings, runtime exceptions, or buggy behaviors mentioned.
3. architecture_decisions: Design decisions, library selections, architectural patterns chosen, or code organization guidelines.
4. pending_tasks: Specific unresolved checklist items, TODOs, or next development steps explicitly or implicitly requested.
5. important_code: Exact code snippets, configurations, or syntax that are highly relevant to the active problem or target solution.
6. files_mentioned: Filenames, file paths, or directory names mentioned in the conversation.
7. user_preferences: Expressed preferences of the user (e.g., preference for Vanilla CSS over Tailwind, clean/uncommented code, particular patterns).
8. constraints: Technical or structural limitations, API quotas, performance bounds, or environment constraints.
9. successful_solutions: Fixes, code snippets, or solutions that successfully solved a problem in the conversation.
10. failed_attempts: Approaches, libraries, or configurations that were attempted but failed or were rejected.

Do not summarize, do not synthesize, and do not write a handoff prompt. Extract only verified factual lists directly present in the text. Ensure each list has a maximum of 5-8 items of high accuracy.`;

const SYSTEM_INSTRUCTIONS_PASS_2 = `You are a Context Synthesis and Handoff Packaging Engine.
You are provided with:
1. The raw developer-AI conversation transcript.
2. A highly accurate structured JSON set of extracted facts (technical stack, errors, decisions, code, files, preferences, etc.).

Your goal is to synthesize these inputs to produce an extremely high-quality, professional, and token-efficient state transfer packet for cross-LLM continuity.

Please execute:
1. Assign priority (1-10) to key memories (tech stack, requirements, decisions, errors) in the 'priority_memories' array. Limit to max 5-8 items.
2. Deduplicate repeated explanations/code. Keep only the most complete version. Limit 'deduplicated_context' array to max 5 items.
3. Classify conversation types (Coding, Debugging, Research, Brainstorming, Planning, Studying, Writing, Architecture Design).
4. Generate a concise title (max 6-8 words) for the overall conversation.
5. Generate a 'project_summary' summarizing the overall project or codebase.
6. Generate a 'current_task' describing the immediate objective.
7. Generate a 'user_intent' describing what the user wants to achieve.
8. CRITICALLY, generate an optimized 'handoffPrompt' in the first-person user voice (e.g., "I am working on X. Here's where we stand: [...] I need you to help me next with [...]").
   Avoid third-person meta-context like "The user wants..." or "You are continuing a session...". It should read as a direct briefing from the user specifying the immediate next task and requesting the model's next steps, synthesized directly from the extracted facts and transcript.
9. Populate the remaining fields such as 'temporary_context', 'long_term_memory', 'ai_inferred_context', deduplication/quality scores, and MERGE/preserve the fact arrays from the structured input (refining or passing them through if appropriate).

Ensure the output perfectly conforms to the required JSON schema.`;

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
    const model = geminiModel || 'gemini-2.0-flash';

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

    // ==========================================
    // PASS 1: Facts Extraction
    // ==========================================
    const pass1Response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts }],
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTIONS_PASS_1 }]
        },
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              technical_stack: { type: "ARRAY", items: { type: "STRING" } },
              errors_and_issues: { type: "ARRAY", items: { type: "STRING" } },
              architecture_decisions: { type: "ARRAY", items: { type: "STRING" } },
              pending_tasks: { type: "ARRAY", items: { type: "STRING" } },
              important_code: { type: "ARRAY", items: { type: "STRING" } },
              files_mentioned: { type: "ARRAY", items: { type: "STRING" } },
              user_preferences: { type: "ARRAY", items: { type: "STRING" } },
              constraints: { type: "ARRAY", items: { type: "STRING" } },
              successful_solutions: { type: "ARRAY", items: { type: "STRING" } },
              failed_attempts: { type: "ARRAY", items: { type: "STRING" } }
            },
            required: [
              "technical_stack",
              "errors_and_issues",
              "architecture_decisions",
              "pending_tasks",
              "important_code",
              "files_mentioned",
              "user_preferences",
              "constraints",
              "successful_solutions",
              "failed_attempts"
            ]
          }
        }
      })
    });

    if (!pass1Response.ok) {
      const errText = await pass1Response.text();
      throw new Error(`Gemini API Pass 1 Error: HTTP ${pass1Response.status} - ${errText}`);
    }

    const pass1Json = await pass1Response.json();
    const pass1TextResult = pass1Json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!pass1TextResult) {
      throw new Error('Empty response received from Gemini API in Pass 1');
    }

    const pass1ParsedResult = JSON.parse(pass1TextResult);

    // ==========================================
    // PASS 2: Synthesis and Packaging
    // ==========================================
    const pass2PromptText = `
[RAW CONVERSATION TRANSCRIPT]
${promptText}

[EXTRACTED TECHNICAL FACTS FOR SYNTHESIS]
${JSON.stringify(pass1ParsedResult, null, 2)}
`;

    // Reconstruct parts for Pass 2 (including images and synthesized facts)
    const pass2Parts = [{ text: pass2PromptText }];
    // Append the same inline images if present
    seenImages.forEach(dataUrl => {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        pass2Parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2]
          }
        });
      }
    });

    const pass2Response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: pass2Parts }],
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTIONS_PASS_2 }]
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
              files_mentioned: { type: "ARRAY", items: { type: "STRING" } },
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
              "files_mentioned",
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

    if (!pass2Response.ok) {
      const errText = await pass2Response.text();
      throw new Error(`Gemini API Pass 2 Error: HTTP ${pass2Response.status} - ${errText}`);
    }

    const pass2Json = await pass2Response.json();
    const pass2TextResult = pass2Json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!pass2TextResult) {
      throw new Error('Empty response received from Gemini API in Pass 2');
    }

    const parsedResult = JSON.parse(pass2TextResult);

    // 5. Save updated context back to storage
    const latest = await chrome.storage.local.get('contexts');
    const updatedContexts = latest.contexts || [];
    const idx = updatedContexts.findIndex(c => c.id === contextId);
    if (idx !== -1) {
      updatedContexts[idx].aiStatus = 'success';
      updatedContexts[idx].title = parsedResult.title || updatedContexts[idx].title;
      
      // Augment memory graph with AI-distilled tags
      const existingGraph = updatedContexts[idx].memoryGraph;
      updatedContexts[idx].memoryGraph = augmentMemoryGraph(existingGraph, parsedResult);

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
        files_mentioned: parsedResult.files_mentioned || [],
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
