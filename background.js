// Cross Context — Background Service Worker
// Handles messaging between popup and content scripts

const MAX_SAVED_CONTEXTS = 10;

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
    SCRAPE_REQUEST:   () => handleScrapeRequest(sendResponse),
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
    const { contexts = [] } = await chrome.storage.local.get('contexts');

    const newContext = {
      id: generateId(),
      platform: context.platform,
      title: context.title || generateTitle(context),
      messages: context.messages,
      messageCount: context.messages.length,
      timestamp: Date.now(),
      url: context.url || '',
    };

    // Prepend new context, keep only MAX_SAVED_CONTEXTS
    const updated = [newContext, ...contexts].slice(0, MAX_SAVED_CONTEXTS);
    await chrome.storage.local.set({ contexts: updated });

    sendResponse({ success: true, context: newContext });
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
async function handleScrapeRequest(sendResponse) {
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

    const results = await chrome.tabs.sendMessage(activeTab.id, { type: 'DO_SCRAPE' });
    sendResponse(results);
  } catch (err) {
    sendResponse({
      success: false,
      error: 'Could not reach page. Try refreshing the LLM tab, then capture again. (' + err.message + ')'
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
