// Cross Context — Popup Script
'use strict';

// ──────────────────────────────────────────
// Platform Configuration
// ──────────────────────────────────────────
const PLATFORMS = {
  claude: {
    name: 'Claude',
    sub: 'claude.ai',
    emoji: '🟠',
    hosts: ['claude.ai'],
  },
  chatgpt: {
    name: 'ChatGPT',
    sub: 'chatgpt.com',
    emoji: '🟢',
    hosts: ['chatgpt.com'],
  },
  gemini: {
    name: 'Gemini',
    sub: 'gemini.google.com',
    emoji: '🔵',
    hosts: ['gemini.google.com'],
  },
  grok: {
    name: 'Grok',
    sub: 'grok.com',
    emoji: '⚡',
    hosts: ['grok.com', 'x.com'],
  },
  perplexity: {
    name: 'Perplexity',
    sub: 'perplexity.ai',
    emoji: '🩵',
    hosts: ['perplexity.ai'],
  },
};

// Helper to get custom, high-fidelity SVGs for LLM logos
function getPlatformIcon(platformKey, size = 16) {
  switch (platformKey) {
    case 'claude':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" class="logo-svg" style="display:inline-block; vertical-align:middle; margin-right:4px;">
        <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/>
      </svg>`;
    case 'chatgpt':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" class="logo-svg" style="display:inline-block; vertical-align:middle; margin-right:4px;">
        <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"/>
      </svg>`;
    case 'gemini':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" class="logo-svg" style="display:inline-block; vertical-align:middle; margin-right:4px;">
        <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"/>
      </svg>`;
    case 'grok':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" class="logo-svg" style="display:inline-block; vertical-align:middle; margin-right:4px;">
        <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"/>
      </svg>`;
    case 'perplexity':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" class="logo-svg" style="display:inline-block; vertical-align:middle; margin-right:4px;">
        <path d="M19.785 0v7.272H22.5V17.62h-2.935V24l-7.037-6.194v6.145h-1.091v-6.152L4.392 24v-6.465H1.5V7.188h2.884V0l7.053 6.494V.19h1.09v6.49L19.786 0zm-7.257 9.044v7.319l5.946 5.234V14.44l-5.946-5.397zm-1.099-.08l-5.946 5.398v7.235l5.946-5.234V8.965zm8.136 7.58h1.844V8.349H13.46l6.105 5.54v2.655zm-8.982-8.28H2.59v8.195h1.8v-2.576l6.192-5.62zM5.475 2.476v4.71h5.115l-5.115-4.71zm13.219 0l-5.115 4.71h5.115v-4.71z"/>
      </svg>`;
    default:
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="logo-svg" style="display:inline-block; vertical-align:middle; margin-right:4px;">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>`;
  }
}

// ──────────────────────────────────────────
// State
// ──────────────────────────────────────────
let savedContexts = [];
let currentTabPlatform = null;
let draggedContextId = null;
let dragToPageHintTimer = null;

// ──────────────────────────────────────────
// DOM References
// ──────────────────────────────────────────
const $ = id => document.getElementById(id);
const btnCapture          = $('btn-capture');
const btnCaptureAi        = $('btn-capture-ai');
const btnClearAll         = $('btn-clear-all');
const btnSettings         = $('btn-settings');
const currentPlatformLabel= $('current-platform-label');
const platformDot         = $('platform-dot');
const contextsList        = $('contexts-list');
const emptyState          = $('empty-state');
const contextCountBadge   = $('context-count');
const toast               = $('toast');

const previewModal        = $('preview-modal');
const previewClose        = $('preview-close');
const previewContent      = $('preview-content');

// New Preview tabs and panels
const previewTabs         = $('preview-tabs');
const tabAiSummary        = $('tab-ai-summary');
const tabRawTranscript    = $('tab-raw-transcript');
const previewContentAi    = $('preview-content-ai');

// Settings modal elements
const settingsModal       = $('settings-modal');
const settingsClose       = $('settings-close');
const btnSaveSettings     = $('btn-save-settings');
const btnToggleApiKey     = $('btn-toggle-api-key');
const inputApiKey         = $('setting-api-key');
const selectModel         = $('setting-model');
const inputModelCustom    = $('setting-model-custom');
const checkboxEnableAi    = $('setting-enable-ai');

// Redesign elements
const apiStatusBadge      = $('api-status-badge');
const searchInput         = $('search-input');
const btnClearSearch      = $('btn-clear-search');
const filterChips         = $('filter-chips');
const consoleCard         = $('console-card');

// Tracking state
let currentPreviewId = null;
let currentPreviewTab = 'ai-summary';
let currentSearchQuery = '';
let currentFilterPlatform = 'all';

// ──────────────────────────────────────────
// Init
// ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await detectCurrentTab();
  await loadContexts();
  await loadSettings();
  
  if (window.location.protocol === 'file:' && savedContexts.length === 0) {
    savedContexts = [
      {
        id: 'mock_claude',
        platform: 'claude',
        title: 'Building a Rust web server with Actix-web and SQLx',
        messages: [
          { role: 'user', content: 'How do I set up a connection pool in Actix-web using SQLx?' },
          { role: 'assistant', content: 'To set up a connection pool in Actix-web with SQLx, you first create the pool in your main function, and then pass it to the app using `.app_data(web::Data::new(pool))`. Here is a complete code example showing how to initialize the PgPool...' }
        ],
        messageCount: 2,
        timestamp: Date.now() - 3600000 * 2,
        aiStatus: 'success',
        aiEnhanced: {
          summary: 'The user is seeking assistance with initializing a PgPool database connection pool in a Rust Actix-web web server using SQLx, and passing it as application data.',
          keyPoints: [
            'Rust web server using Actix-web and SQLx PgPool',
            'Connection pool is initialized in the main function',
            'Passed to application state using .app_data(web::Data::new(pool))'
          ],
          handoffPrompt: '[🔄 AI-Enhanced Cross Context Transfer]\nThe user is building a Rust web server using Actix-web and SQLx. They need help setting up the PgPool connection pool and passing it into Actix web application state.'
        }
      },
      {
        id: 'mock_chatgpt',
        platform: 'chatgpt',
        title: 'Writing a custom React hook for debouncing fetch requests',
        messages: [
          { role: 'user', content: 'Create a custom hook useDebounce in React.' },
          { role: 'assistant', content: 'Here is a custom useDebounce hook in TypeScript. It takes a value and delay, and returns the debounced value. You can use it in your search bar input component to prevent excessive API requests...' }
        ],
        messageCount: 4,
        timestamp: Date.now() - 3600000 * 24,
        aiStatus: 'idle'
      }
    ];
    renderContexts();
  }
  bindEvents();
  setTimeout(syncFilterBackdrop, 100); // position sliding capsule
  setupSettingsListeners();
  setupTabListeners();
  setupStorageChangeListener();
});

// ──────────────────────────────────────────
// Detect current tab's platform
// ──────────────────────────────────────────
async function detectCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const url = new URL(tab.url);
    const hostname = url.hostname;

    for (const [key, config] of Object.entries(PLATFORMS)) {
      if (config.hosts.some(h => hostname.includes(h))) {
        currentTabPlatform = key;
        const cfg = PLATFORMS[key];
        currentPlatformLabel.textContent = `${cfg.name} active`;
        platformDot.className = `platform-dot active dot-${key}`;
        platformDot.innerHTML = getPlatformIcon(key, 18);
        platformDot.style.color = getComputedStyle(document.documentElement)
          .getPropertyValue(`--${key}`) || '#3b82f6';
        
        consoleCard.className = `console-card platform-${key}`;
        
        btnCapture.disabled = false;
        btnCaptureAi.disabled = false;
        return;
      }
    }

    currentPlatformLabel.textContent = 'Open an AI chat to capture context';
    platformDot.className = 'platform-dot';
    platformDot.innerHTML = '';
    platformDot.style.color = '';
    consoleCard.className = 'console-card inactive';
    btnCapture.disabled = true;
    btnCaptureAi.disabled = true;

  } catch (err) {
    currentPlatformLabel.textContent = 'Could not detect page';
    consoleCard.className = 'console-card inactive';
    btnCapture.disabled = true;
    btnCaptureAi.disabled = true;
  }
}

// ──────────────────────────────────────────
// Load saved contexts from storage
// ──────────────────────────────────────────
async function loadContexts() {
  const response = await sendMessage({ type: 'GET_CONTEXTS' });
  if (response?.success) {
    savedContexts = response.contexts || [];
    renderContexts();
  }
}

// ──────────────────────────────────────────
// Render context cards
// ──────────────────────────────────────────
function renderContexts() {
  contextCountBadge.textContent = savedContexts.length;

  let filtered = savedContexts;
  if (currentFilterPlatform !== 'all') {
    filtered = filtered.filter(ctx => ctx.platform === currentFilterPlatform);
  }
  if (currentSearchQuery) {
    filtered = filtered.filter(ctx => 
      ctx.title.toLowerCase().includes(currentSearchQuery) ||
      ctx.platform.toLowerCase().includes(currentSearchQuery) ||
      (ctx.aiEnhanced && ctx.aiEnhanced.summary && ctx.aiEnhanced.summary.toLowerCase().includes(currentSearchQuery))
    );
  }

  if (filtered.length === 0) {
    contextsList.innerHTML = '';
    if (currentSearchQuery || currentFilterPlatform !== 'all') {
      const searchEmpty = document.createElement('div');
      searchEmpty.className = 'empty-state';
      searchEmpty.innerHTML = `
        <div class="empty-icon">🔍</div>
        <p class="empty-title">No matching contexts</p>
        <p class="empty-sub">Try refining your search terms<br>or select another filter.</p>
      `;
      contextsList.appendChild(searchEmpty);
    } else {
      contextsList.appendChild(emptyState);
    }
    return;
  }

  if (emptyState.parentNode) {
    emptyState.remove();
  }
  contextsList.innerHTML = '';

  filtered.forEach(ctx => {
    const card = createContextCard(ctx);
    contextsList.appendChild(card);
  });
}

function createContextCard(ctx) {
  const platform = PLATFORMS[ctx.platform] || { name: ctx.platform };
  const timeAgo = formatTimeAgo(ctx.timestamp);
  const msgCount = ctx.messageCount || ctx.messages?.length || 0;

  const card = document.createElement('div');
  card.className = `context-card platform-${ctx.platform}`;
  card.dataset.id = ctx.id;
  
  if (ctx.aiStatus !== 'pending') {
    card.setAttribute('draggable', 'true');
  }

  let aiBadgeHtml = '';
  if (ctx.aiStatus === 'pending') {
    aiBadgeHtml = `<span class="card-ai-badge pending" title="AI Enhancing...">✨</span>`;
  } else if (ctx.aiStatus === 'success') {
    aiBadgeHtml = `<span class="card-ai-badge success" title="AI Summarized">✨</span>`;
  } else if (ctx.aiStatus === 'failed') {
    aiBadgeHtml = `<span class="card-ai-badge failed" title="AI Failed">⚠️</span>`;
  }

  // Filter platforms to other platforms for quick handoff targets
  const targets = Object.keys(PLATFORMS).filter(p => p !== ctx.platform);
  let targetsHtml = '';
  targets.forEach(tgt => {
    const tgtPlatform = PLATFORMS[tgt];
    targetsHtml += `
      <button class="quick-inject-btn target-${tgt}" data-action="quick-inject" data-target="${tgt}" data-id="${ctx.id}" title="Handoff to ${tgtPlatform.name}">
        ${getPlatformIcon(tgt, 11)}
      </button>
    `;
  });

  card.innerHTML = `
    <div class="card-main">
      <div class="card-left">
        <span class="card-platform-icon">
          ${getPlatformIcon(ctx.platform, 13)}
        </span>
        <div class="card-text">
          <div class="card-title" title="${escapeHtml(ctx.title)}">${escapeHtml(ctx.title)}</div>
          <div class="card-sub">
            <span>${timeAgo}</span>
            <span class="dot-separator">•</span>
            <span>${msgCount} turns</span>
          </div>
        </div>
      </div>
      <div class="card-right">
        ${aiBadgeHtml}
        <div class="drag-handle" title="Drag to transfer context">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/>
            <circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
          </svg>
        </div>
      </div>
    </div>
    
    <!-- Hover Overlay Actions -->
    <div class="card-hover-actions">
      <div class="hover-action-left">
        <button class="hover-action-btn copy-btn" data-action="copy" data-id="${ctx.id}" title="Copy optimized handoff prompt">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>Copy</span>
        </button>
        <button class="hover-action-btn preview-btn" data-action="preview" data-id="${ctx.id}" title="Open Preview">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          <span>Preview</span>
        </button>
      </div>
      <div class="quick-inject-tray">
        ${targetsHtml}
      </div>
      <button class="hover-action-btn delete-btn" data-action="delete" data-id="${ctx.id}" title="Delete Context">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
        </svg>
      </button>
    </div>
  `;

  // Setup Drag Events
  card.addEventListener('dragstart', (e) => {
    draggedContextId = ctx.id;
    card.classList.add('dragging');
    document.body.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'copy';

    const formattedPrompt = formatContextPrompt(ctx);

    e.dataTransfer.setData('text/plain', formattedPrompt);
    e.dataTransfer.setData('text/x-cross-context', JSON.stringify({
      id: ctx.id,
      platform: ctx.platform,
      title: ctx.title,
      source: 'cross-context-extension'
    }));
    e.dataTransfer.setData(`text/x-cross-context-source-${ctx.platform}`, 'true');
    e.dataTransfer.setData('text/x-cross-context-active', 'true');

    const pendingDrop = {
      id: ctx.id,
      platform: ctx.platform,
      title: ctx.title,
      timestamp: Date.now()
    };

    chrome.storage.local.set({ pendingDrop });

    chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'ARM_DROP',
          payload: pendingDrop
        }).catch(() => {});
      }
    });
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    draggedContextId = null;

    setTimeout(() => {
      chrome.storage.local.remove('pendingDrop');
      chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { type: 'DISARM_DROP' }).catch(() => {});
        }
      });
    }, 3000);
  });

  return card;
}

// Copy prompt directly to clipboard
async function handleDirectCopy(id) {
  const ctx = savedContexts.find(c => c.id === id);
  if (!ctx) return;
  
  try {
    const formatted = formatContextPrompt(ctx);
    await navigator.clipboard.writeText(formatted);
    showToast('✓ Handoff prompt copied!', 'success');
  } catch (err) {
    showToast('⚠️ Copy failed: ' + err.message, 'error');
  }
}

// Quick transfer inject trigger
async function handleQuickInject(id, targetPlatform) {
  const ctx = savedContexts.find(c => c.id === id);
  if (!ctx) return;

  try {
    showToast(`🚀 Launching ${PLATFORMS[targetPlatform].name}...`, 'info');
    const result = await sendMessage({
      type: 'INJECT_CONTEXT',
      payload: { context: ctx, targetPlatform }
    });
    if (!result?.success) {
      showToast(result?.error || 'Launch failed', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Sync sliding backdrop positioning for active filter chip
function syncFilterBackdrop() {
  const activeChip = filterChips.querySelector('.filter-chip.active');
  const backdrop = $('filter-backdrop');
  if (!activeChip || !backdrop) return;

  backdrop.style.left = `${activeChip.offsetLeft}px`;
  backdrop.style.width = `${activeChip.offsetWidth}px`;
  backdrop.style.height = `${activeChip.offsetHeight}px`;
  backdrop.style.top = `${activeChip.offsetTop}px`;
  
  const platform = activeChip.dataset.platform;
  backdrop.className = `filter-backdrop platform-${platform}`;
}

// ──────────────────────────────────────────
// Event Bindings
// ──────────────────────────────────────────
function bindEvents() {
  // Capture buttons
  btnCapture.addEventListener('click', handleCaptureNormal);
  btnCaptureAi.addEventListener('click', handleCaptureAi);

  // Clear all
  btnClearAll.addEventListener('click', handleClearAll);

  // Context list (event delegation)
  contextsList.addEventListener('click', e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const { action, id } = actionEl.dataset;
    
    if (action === 'preview') {
      openPreviewModal(id);
    } else if (action === 'delete') {
      handleDeleteContext(id);
    } else if (action === 'copy') {
      handleDirectCopy(id);
    } else if (action === 'quick-inject') {
      const target = actionEl.dataset.target;
      handleQuickInject(id, target);
    }
  });

  // Live Search Input Handler
  searchInput.addEventListener('input', () => {
    currentSearchQuery = searchInput.value.toLowerCase().trim();
    if (currentSearchQuery) {
      btnClearSearch.classList.remove('hidden');
    } else {
      btnClearSearch.classList.add('hidden');
    }
    renderContexts();
  });

  // Clear Search
  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    currentSearchQuery = '';
    btnClearSearch.classList.add('hidden');
    renderContexts();
  });

  // Platform Filter Chips
  filterChips.addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;

    filterChips.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');

    currentFilterPlatform = chip.dataset.platform;
    renderContexts();
    syncFilterBackdrop();
  });

  // Preview modal close
  previewClose.addEventListener('click', closePreviewModal);
  previewModal.addEventListener('click', e => {
    if (e.target === previewModal) closePreviewModal();
  });
}

// ──────────────────────────────────────────
// Capture Handler
// ──────────────────────────────────────────
async function handleCaptureNormal() {
  await captureConversation(false);
}

async function handleCaptureAi() {
  const settings = await chrome.storage.local.get(['geminiApiKey']);
  if (!settings.geminiApiKey) {
    showToast('⚠️ Please configure Gemini API Key in settings first', 'error');
    openSettingsModal();
    return;
  }
  await captureConversation(true);
}

async function captureConversation(isAiScrape) {
  if (!currentTabPlatform) return;

  const activeBtn = isAiScrape ? btnCaptureAi : btnCapture;
  const otherBtn = isAiScrape ? btnCapture : btnCaptureAi;

  activeBtn.classList.add('loading');
  activeBtn.disabled = true;
  otherBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Send scrape request to content script via background
    const result = await sendMessage({ type: 'SCRAPE_REQUEST', isAiScrape });

    if (!result?.success) {
      showToast(result?.error || 'Could not scrape conversation. Make sure you have a conversation open.', 'error');
      return;
    }

    // Save to storage
    const saveResult = await sendMessage({
      type: 'SAVE_CONTEXT',
      payload: { ...result.context, url: tab.url, isAiScrape }
    });

    if (saveResult?.success) {
      savedContexts = [saveResult.context, ...savedContexts.filter(c => c.id !== saveResult.context.id)];
      renderContexts();
      
      const msgs = result.context.messages;
      const userCount = msgs.filter(m => m.role === 'user').length;
      const assistantCount = msgs.filter(m => m.role === 'assistant').length;
      const platformName = PLATFORMS[currentTabPlatform]?.name;
      
      let imgCount = 0;
      msgs.forEach(m => {
        if (m.images) imgCount += m.images.length;
      });

      let toastMsg = `✓ ${platformName}: ${userCount} user + ${assistantCount} assistant turns captured`;
      if (imgCount > 0) {
        toastMsg += ` with ${imgCount} diagram/image(s)`;
      }

      if (isAiScrape) {
        toastMsg += '. ✨ Processing AI compression in background...';
      }

      showToast(toastMsg, 'success');
    } else {
      if (saveResult?.error === 'quota_exceeded') {
        showToast('⚠️ Storage limit reached! Please delete past contexts to free up space.', 'error');
      } else {
        showToast(saveResult?.error || 'Failed to save context', 'error');
      }
    }

  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    activeBtn.classList.remove('loading');
    detectCurrentTab(); // resets both button disabled states
  }
}

// ──────────────────────────────────────────
// Preview Modal & Tabs Rendering
// ──────────────────────────────────────────
function openPreviewModal(contextId) {
  const ctx = savedContexts.find(c => c.id === contextId);
  if (!ctx) return;

  currentPreviewId = contextId;
  currentPreviewTab = 'ai-summary'; // default tab
  renderPreviewContent(ctx);
  previewModal.classList.remove('hidden');
}

function closePreviewModal() {
  previewModal.classList.add('hidden');
  currentPreviewId = null;
}

function renderPreviewContent(ctx) {
  previewContent.innerHTML = '';
  previewContentAi.innerHTML = '';

  const isAiEnhanced = ctx.aiEnhanced && ctx.aiStatus === 'success';

  if (isAiEnhanced) {
    previewTabs.classList.remove('hidden');

    // Create AI summary tab layout
    let imagesGalleryHtml = '';
    
    // Gather all images from all message turns
    const allImages = [];
    ctx.messages.forEach(msg => {
      if (msg.images && Array.isArray(msg.images)) {
        allImages.push(...msg.images);
      }
    });

    if (allImages.length > 0) {
      imagesGalleryHtml = `
        <div class="ai-section">
          <span class="ai-section-title">Scraped Diagrams & Images (${allImages.length}/5)</span>
          <div class="ai-image-gallery">
            ${allImages.map(imgSrc => `
              <div class="ai-image-thumbnail">
                <img src="${imgSrc}" alt="Scraped context asset" />
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    let visualAnalysisHtml = '';
    if (ctx.aiEnhanced.visualAnalysis) {
      visualAnalysisHtml = `
        <div class="ai-section">
          <span class="ai-section-title">Visual Layout Description</span>
          <div class="ai-summary-text">${escapeHtml(ctx.aiEnhanced.visualAnalysis)}</div>
        </div>
      `;
    }

    previewContentAi.innerHTML = `
      <div class="ai-section">
        <span class="ai-section-title">AI Synthesized Summary</span>
        <div class="ai-summary-text">${escapeHtml(ctx.aiEnhanced.summary)}</div>
      </div>

      <div class="ai-section">
        <span class="ai-section-title">Key Technical Points</span>
        <ul class="ai-bullet-list">
          ${ctx.aiEnhanced.keyPoints.map(pt => `<li>${escapeHtml(pt)}</li>`).join('')}
        </ul>
      </div>

      ${visualAnalysisHtml}
      ${imagesGalleryHtml}

      <div class="ai-section ai-prompt-box-wrapper">
        <span class="ai-section-title">Optimized Handoff Prompt</span>
        <div class="ai-prompt-box">${escapeHtml(ctx.aiEnhanced.handoffPrompt)}</div>
        <button id="btn-copy-ai-prompt" class="btn-copy-ai-prompt">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy Handoff Prompt
        </button>
      </div>
    `;

    // Manage tab visibility class toggling
    if (currentPreviewTab === 'ai-summary') {
      previewContentAi.classList.remove('hidden');
      previewContent.classList.add('hidden');
      tabAiSummary.classList.add('active');
      tabRawTranscript.classList.remove('active');
    } else {
      previewContentAi.classList.add('hidden');
      previewContent.classList.remove('hidden');
      tabAiSummary.classList.remove('active');
      tabRawTranscript.classList.add('active');
    }

    // Attach prompt copy click
    const copyBtn = previewContentAi.querySelector('#btn-copy-ai-prompt');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(ctx.aiEnhanced.handoffPrompt);
        showToast('✓ Handoff prompt copied!', 'success');
      });
    }

    // Attach full-screen thumbnail zoom viewer click
    const thumbs = previewContentAi.querySelectorAll('.ai-image-thumbnail img');
    thumbs.forEach(thumb => {
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        openFullscreenImage(thumb.src);
      });
    });

  } else {
    // Hide tabs, show only raw transcript if not enhanced
    previewTabs.classList.add('hidden');
    previewContentAi.classList.add('hidden');
    previewContent.classList.remove('hidden');
  }

  // Render raw transcript layout
  ctx.messages.forEach(msg => {
    const isUser = msg.role === 'user';
    let headerHtml = '';
    let extraClass = '';

    if (isUser) {
      const userIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="user-svg" style="display:inline-block; vertical-align:middle; margin-right:4px;">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>`;
      headerHtml = `${userIcon}<span>User</span>`;
    } else {
      const platformKey = ctx.platform;
      const platformCfg = PLATFORMS[platformKey] || { name: 'Assistant' };
      const iconSvg = getPlatformIcon(platformKey, 12);
      headerHtml = `${iconSvg}<span>${platformCfg.name}</span>`;
      extraClass = `platform-${platformKey}`;
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `preview-message role-${msg.role} ${extraClass}`.trim();
    
    let msgImagesHtml = '';
    if (msg.images && msg.images.length > 0) {
      msgImagesHtml = `
        <div class="ai-image-gallery" style="margin-top: 8px;">
          ${msg.images.map(imgSrc => `
            <div class="ai-image-thumbnail">
              <img src="${imgSrc}" alt="Scraped conversation diagram" />
            </div>
          `).join('')}
        </div>
      `;
    }

    msgDiv.innerHTML = `
      <div class="preview-message-header">${headerHtml}</div>
      <div class="preview-message-body">${escapeHtml(msg.content)}</div>
      ${msgImagesHtml}
    `;
    previewContent.appendChild(msgDiv);

    // Attach full-screen thumbnail zoom inside raw transcript too
    const msgThumbs = msgDiv.querySelectorAll('.ai-image-thumbnail img');
    msgThumbs.forEach(thumb => {
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        openFullscreenImage(thumb.src);
      });
    });
  });
}

function openFullscreenImage(src) {
  const viewer = document.createElement('div');
  viewer.className = 'fullscreen-image-overlay';
  viewer.innerHTML = `<img src="${src}" alt="Zoomed view of diagram" />`;
  viewer.addEventListener('click', () => {
    viewer.remove();
  });
  document.body.appendChild(viewer);
}

// ──────────────────────────────────────────
// Settings Modal Event Listeners & Logic
// ──────────────────────────────────────────
function openSettingsModal() {
  loadSettings();
  settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
}

function updateApiBadgeStatus(apiKey) {
  if (apiKey && apiKey.trim().length > 5) {
    apiStatusBadge.className = 'api-status-indicator configured';
    apiStatusBadge.title = 'AI Studio API Key: Configured';
  } else {
    apiStatusBadge.className = 'api-status-indicator unconfigured';
    apiStatusBadge.title = 'AI Studio API Key: Unconfigured';
  }
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'aiEnhancementEnabled']);
  inputApiKey.value = settings.geminiApiKey || '';
  const model = settings.geminiModel || 'gemini-3.5-flash';
  
  if (['gemini-3.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'].includes(model)) {
    selectModel.value = model;
    inputModelCustom.classList.add('hidden');
    inputModelCustom.value = '';
  } else {
    selectModel.value = 'custom';
    inputModelCustom.classList.remove('hidden');
    inputModelCustom.value = model;
  }
  checkboxEnableAi.checked = settings.aiEnhancementEnabled !== false;
  
  updateApiBadgeStatus(settings.geminiApiKey);
}

async function handleSaveSettings() {
  const apiKey = inputApiKey.value.trim();
  const modelType = selectModel.value;
  let modelName = modelType;
  if (modelType === 'custom') {
    modelName = inputModelCustom.value.trim();
    if (!modelName) {
      showToast('⚠️ Please enter custom model name', 'error');
      return;
    }
  }
  const enableAi = checkboxEnableAi.checked;

  await chrome.storage.local.set({
    geminiApiKey: apiKey,
    geminiModel: modelName,
    aiEnhancementEnabled: enableAi
  });

  updateApiBadgeStatus(apiKey);
  showToast('✓ AI settings saved', 'success');
  closeSettingsModal();
}

function setupSettingsListeners() {
  btnSettings.addEventListener('click', openSettingsModal);
  settingsClose.addEventListener('click', closeSettingsModal);
  settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal) closeSettingsModal();
  });
  
  btnSaveSettings.addEventListener('click', handleSaveSettings);

  btnToggleApiKey.addEventListener('click', () => {
    const isSecret = inputApiKey.type === 'password';
    inputApiKey.type = isSecret ? 'text' : 'password';
    btnToggleApiKey.textContent = isSecret ? '🙈' : '👁️';
  });

  selectModel.addEventListener('change', () => {
    if (selectModel.value === 'custom') {
      inputModelCustom.classList.remove('hidden');
    } else {
      inputModelCustom.classList.add('hidden');
    }
  });
}

function setupTabListeners() {
  tabAiSummary.addEventListener('click', () => {
    currentPreviewTab = 'ai-summary';
    const ctx = savedContexts.find(c => c.id === currentPreviewId);
    if (ctx) renderPreviewContent(ctx);
  });

  tabRawTranscript.addEventListener('click', () => {
    currentPreviewTab = 'raw-transcript';
    const ctx = savedContexts.find(c => c.id === currentPreviewId);
    if (ctx) renderPreviewContent(ctx);
  });
}

function setupStorageChangeListener() {
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && changes.contexts) {
      savedContexts = changes.contexts.newValue || [];
      await loadContexts(); // reloads lists and re-renders them
      
      // Update preview modal in real-time if open
      if (currentPreviewId && !previewModal.classList.contains('hidden')) {
        const updatedCtx = savedContexts.find(c => c.id === currentPreviewId);
        if (updatedCtx && updatedCtx.aiStatus !== 'pending') {
          renderPreviewContent(updatedCtx);
        }
      }
    }
  });
}

// ──────────────────────────────────────────
// Delete Context
// ──────────────────────────────────────────
async function handleDeleteContext(id) {
  const result = await sendMessage({ type: 'DELETE_CONTEXT', id });
  if (result?.success) {
    savedContexts = savedContexts.filter(c => c.id !== id);
    renderContexts();
    showToast('Context deleted', 'info');
  }
}

// ──────────────────────────────────────────
// Clear All
// ──────────────────────────────────────────
async function handleClearAll() {
  if (savedContexts.length === 0) return;
  const confirmed = confirm(`Delete all ${savedContexts.length} saved context(s)?`);
  if (!confirmed) return;

  const result = await sendMessage({ type: 'CLEAR_CONTEXTS' });
  if (result?.success) {
    savedContexts = [];
    renderContexts();
    showToast('All contexts cleared', 'info');
  }
}

// ──────────────────────────────────────────
// Toast Notification
// ──────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'info') {
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// ──────────────────────────────────────────
// Messaging Helper
// ──────────────────────────────────────────
function sendMessage(msg) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(msg, resolve);
    } else {
      resolve({ success: false, error: 'Extension API not available' });
    }
  });
}

// ──────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────
function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const min = Math.floor(diff / 60000);
  const hr  = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  if (hr  < 24) return `${hr}h ago`;
  return `${day}d ago`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PLATFORM_NAMES = {
  claude:     'Claude (Anthropic)',
  chatgpt:    'ChatGPT (OpenAI)',
  gemini:     'Gemini (Google)',
  grok:       'Grok (xAI)',
  perplexity: 'Perplexity AI',
};

function formatContextPrompt(context) {
  // If the context has been successfully enhanced by Gemini AI, use it directly
  if (context.aiEnhanced && context.aiEnhanced.handoffPrompt) {
    return context.aiEnhanced.handoffPrompt;
  }

  const MAX_TURNS  = 40;
  const CHAR_LIMIT = 80000;

  let msgs = [...context.messages];
  let truncated = false;

  if (msgs.length > MAX_TURNS) {
    msgs = msgs.slice(msgs.length - MAX_TURNS);
    truncated = true;
  }

  let transcript = '';
  let chars = 0;

  for (const msg of msgs) {
    const label = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
    const line  = `${label}:\n${msg.content}\n\n`;
    if (chars + line.length > CHAR_LIMIT) { truncated = true; break; }
    transcript += line;
    chars += line.length;
  }

  const src = PLATFORM_NAMES[context.platform] || context.platform;
  const note = truncated ? `\n⚠️ Note: Partial history (last ${MAX_TURNS} turns shown due to length).\n` : '';
  const div  = '═'.repeat(60);

  return `[🔄 Cross Context Transfer]
You are continuing a conversation that was started on ${src}.
The user reached the free-tier limit there and needs your help to continue seamlessly.${note}
Please read the conversation history below, then acknowledge you understand the context and are ready to help. Do NOT re-introduce yourself — just confirm you have the context.

${div}
📋 Conversation History (${msgs.length} messages from ${src})
${div}

${transcript.trim()}

${div}
✅ End of conversation history from ${src}
${div}

Please confirm you have the full context above and are ready to continue the conversation.`;
}
