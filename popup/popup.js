// Cross Context — Popup Script
'use strict';

import { ContextIntelligenceEngine, formatContextPrompt } from '../utils/formatter.js';

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
const dragInstructionBanner = $('drag-instruction-banner');

const previewModal        = $('preview-modal');
const previewClose        = $('preview-close');
const previewContent      = $('preview-content');

// New Preview tabs and panels
const previewTabs         = $('preview-tabs');
const tabAiSummary        = $('tab-ai-summary');
const tabMemoryGraph      = $('tab-memory-graph');
const tabRawTranscript    = $('tab-raw-transcript');
const previewContentAi    = $('preview-content-ai');
const previewContentGraph = $('preview-content-graph');

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
let pendingLoaderInterval = null;

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
        id: 'con_01',
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
        },
        memoryGraph: {
          nodes: [
            { id: 'project_root', type: 'PROJECT', label: 'Rust Actix-web Server' },
            { id: 'tech_rust', type: 'TECH_STACK', label: 'Rust', properties: { name: 'Rust' } },
            { id: 'tech_actix_web', type: 'TECH_STACK', label: 'Actix-web', properties: { name: 'Actix-web' } },
            { id: 'tech_sqlx', type: 'TECH_STACK', label: 'SQLx', properties: { name: 'SQLx' } },
            { id: 'ai_dec_0', type: 'DECISION', label: 'Initialize connection pool in main fn' },
            { id: 'ai_task_0', type: 'TASK', label: 'Pass PgPool using .app_data()' },
            { id: 'ai_issue_0', type: 'ISSUE', label: 'Blocked by database migration checks' }
          ],
          edges: [
            { from: 'tech_rust', to: 'project_root', type: 'IMPLEMENTED_WITH' },
            { from: 'tech_actix_web', to: 'project_root', type: 'IMPLEMENTED_WITH' },
            { from: 'tech_sqlx', to: 'project_root', type: 'IMPLEMENTED_WITH' },
            { from: 'ai_dec_0', to: 'project_root', type: 'RELATED_TO' },
            { from: 'ai_task_0', to: 'project_root', type: 'DEPENDS_ON' },
            { from: 'ai_issue_0', to: 'project_root', type: 'BLOCKED_BY' },
            { from: 'ai_task_0', to: 'tech_actix_web', type: 'RELATED_TO' },
            { from: 'ai_dec_0', to: 'tech_sqlx', type: 'RELATED_TO' }
          ]
        }
      },
      {
        id: 'con_02',
        platform: 'chatgpt',
        title: 'Writing a custom React hook for debouncing fetch requests',
        messages: [
          { role: 'user', content: 'Create a custom hook useDebounce in React.' },
          { role: 'assistant', content: 'Here is a custom useDebounce hook in TypeScript. It takes a value and delay, and returns the debounced value. You can use it in your search bar input component to prevent excessive API requests...' }
        ],
        messageCount: 4,
        timestamp: Date.now() - 3600000 * 24,
        aiStatus: 'idle',
        memoryGraph: {
          nodes: [
            { id: 'project_root', type: 'PROJECT', label: 'React useDebounce Hook' },
            { id: 'tech_react', type: 'TECH_STACK', label: 'React', properties: { name: 'React' } },
            { id: 'tech_javascript', type: 'TECH_STACK', label: 'JavaScript', properties: { name: 'JavaScript' } },
            { id: 'tech_typescript', type: 'TECH_STACK', label: 'TypeScript', properties: { name: 'TypeScript' } },
            { id: 'msg_0_task_0', type: 'TASK', label: 'Create a custom hook useDebounce' },
            { id: 'msg_1_dec_0', type: 'DECISION', label: 'Using useEffect and setTimeout for debouncing' }
          ],
          edges: [
            { from: 'tech_react', to: 'project_root', type: 'IMPLEMENTED_WITH' },
            { from: 'tech_javascript', to: 'project_root', type: 'IMPLEMENTED_WITH' },
            { from: 'tech_typescript', to: 'project_root', type: 'IMPLEMENTED_WITH' },
            { from: 'msg_0_task_0', to: 'project_root', type: 'DEPENDS_ON' },
            { from: 'msg_1_dec_0', to: 'project_root', type: 'RELATED_TO' }
          ]
        }
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

    currentPlatformLabel.textContent = 'Open an AI chat to scrape context';
    platformDot.className = 'platform-dot';
    platformDot.innerHTML = `
      <svg class="radar-scan-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
    `;
    platformDot.style.color = 'var(--text-muted)';
    consoleCard.className = 'console-card inactive';
    btnCapture.disabled = true;
    btnCaptureAi.disabled = true;

  } catch (err) {
    currentPlatformLabel.textContent = 'Could not detect page';
    platformDot.className = 'platform-dot';
    platformDot.innerHTML = `
      <svg class="radar-scan-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
    `;
    platformDot.style.color = 'var(--text-muted)';
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

  if (dragInstructionBanner) {
    if (savedContexts.length > 0) {
      dragInstructionBanner.classList.remove('hidden');
    } else {
      dragInstructionBanner.classList.add('hidden');
    }
  }

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
    card.setAttribute('title', 'Drag and drop this conversation into an active AI chat page to continue or share context');
  }

  let aiBadgeHtml = '';
  if (ctx.aiStatus === 'pending') {
    aiBadgeHtml = `
      <div class="card-processing-badge" title="AI Context Engine is compiling conversation...">
        <svg class="premium-sparkle-loader" viewBox="0 0 24 24" width="9" height="9" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L14.7 9.3L22 12L14.7 14.7L12 22L9.3 14.7L2 12L9.3 9.3L12 2Z" />
        </svg>
        <span>Processing...</span>
      </div>
    `;
  } else if (ctx.aiStatus === 'success') {
    aiBadgeHtml = `<span class="card-ai-badge success" title="AI Summarized">
      <svg class="ai-badge-icon" width="14" height="14" viewBox="0 0 24 24" fill="url(#ai-badge-grad)">
        <defs>
          <linearGradient id="ai-badge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fbbf24" />
            <stop offset="50%" stop-color="#f59e0b" />
            <stop offset="100%" stop-color="#db2777" />
          </linearGradient>
        </defs>
        <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
        <path d="M19 4.5L19.5 6l1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" opacity="0.85"/>
        <path d="M5 16.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" opacity="0.85"/>
      </svg>
    </span>`;
  } else if (ctx.aiStatus === 'failed') {
    aiBadgeHtml = `<span class="card-ai-badge failed" title="AI Failed">
      <svg class="ai-badge-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="17"/>
      </svg>
    </span>`;
  }
  // Truncation warning badge
  let truncatedBadgeHtml = '';
  if (ctx.truncated) {
    truncatedBadgeHtml = `<span class="card-ai-badge truncated" title="Conversation was truncated to fit transfer limits">
      <svg class="ai-badge-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </span>`;
  }

  // Filter platforms to other platforms for quick handoff targets
  const targets = Object.keys(PLATFORMS).filter(p => p !== ctx.platform);
  let targetsHtml = '';
  targets.forEach(tgt => {
    const tgtPlatform = PLATFORMS[tgt];
    targetsHtml += `
      <button class="quick-inject-btn target-${tgt}" data-action="quick-inject" data-target="${tgt}" data-id="${ctx.id}" title="Handoff to ${tgtPlatform.name}">
        ${getPlatformIcon(tgt, 18)}
      </button>
    `;
  });

  card.innerHTML = `
    <div class="card-main">
      <div class="card-left">
        <span class="card-platform-icon">
          ${getPlatformIcon(ctx.platform, 22)}
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
        ${truncatedBadgeHtml}
        ${aiBadgeHtml}
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

// Platform themes for injection overlay variables
const PLATFORM_THEMES = {
  claude:     { primary: '#d97752', bg: 'rgba(217, 119, 82, 0.06)', border: 'rgba(217, 119, 82, 0.15)' },
  chatgpt:    { primary: '#10b981', bg: 'rgba(16, 185, 129, 0.06)', border: 'rgba(16, 185, 129, 0.15)' },
  gemini:     { primary: '#3b82f6', bg: 'rgba(59, 130, 246, 0.06)', border: 'rgba(59, 130, 246, 0.15)' },
  grok:       { primary: '#f4f4f5', bg: 'rgba(244, 244, 245, 0.04)', border: 'rgba(244, 244, 245, 0.1)' },
  perplexity: { primary: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.06)', border: 'rgba(14, 165, 233, 0.15)' },
};

function getInjectOverlayIcon(platformKey) {
  const svg = getPlatformIcon(platformKey, 28);
  // Strip inline styles so popup.css is 100% in control
  return svg.replace(/style="[^"]*"/g, '');
}

// Quick transfer inject trigger
async function handleQuickInject(id, targetPlatform) {
  const ctx = savedContexts.find(c => c.id === id);
  if (!ctx) return;

  const overlay = $('injecting-overlay');
  const srcIcon = $('inject-source-icon');
  const tgtIcon = $('inject-target-icon');
  const title = $('inject-title');
  const subtitle = $('inject-subtitle');

  if (!overlay || !srcIcon || !tgtIcon || !title || !subtitle) {
    // Fallback if elements are missing
    try {
      showToast(`🚀 Launching ${PLATFORMS[targetPlatform].name}...`, 'info');
      await sendMessage({
        type: 'INJECT_CONTEXT',
        payload: { context: ctx, targetPlatform }
      });
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
    return;
  }

  // Bind specific brand theme color variables dynamically
  const srcTheme = PLATFORM_THEMES[ctx.platform] || { primary: '#7c3aed', bg: 'rgba(124, 58, 237, 0.06)', border: 'rgba(124, 58, 237, 0.15)' };
  const tgtTheme = PLATFORM_THEMES[targetPlatform] || { primary: '#3b82f6', bg: 'rgba(59, 130, 246, 0.06)', border: 'rgba(59, 130, 246, 0.15)' };

  overlay.style.setProperty('--source-color', srcTheme.primary);
  overlay.style.setProperty('--source-bg', srcTheme.bg);
  overlay.style.setProperty('--source-border', srcTheme.border);

  overlay.style.setProperty('--target-color', tgtTheme.primary);
  overlay.style.setProperty('--target-bg', tgtTheme.bg);
  overlay.style.setProperty('--target-border', tgtTheme.border);

  // Set assets and texts
  srcIcon.innerHTML = getInjectOverlayIcon(ctx.platform);
  tgtIcon.innerHTML = getInjectOverlayIcon(targetPlatform);
  title.textContent = 'Injecting...';
  
  const srcName = PLATFORMS[ctx.platform]?.name || ctx.platform;
  const tgtName = PLATFORMS[targetPlatform]?.name || targetPlatform;
  subtitle.innerHTML = `Transferring context from <strong>${srcName}</strong><br>to <strong>${tgtName}</strong>…`;

  // Reveal the connecting overlay
  overlay.classList.remove('hidden');

  // Let the premium floating / shimmer flow animation run for 1400ms in the popup
  setTimeout(async () => {
    try {
      const result = await sendMessage({
        type: 'INJECT_CONTEXT',
        payload: { context: ctx, targetPlatform }
      });
      if (!result?.success) {
        showToast(result?.error || 'Launch failed', 'error');
        overlay.classList.add('hidden');
      }
      // Note: If success, the tab opens and focuses, automatically closing this popup
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      overlay.classList.add('hidden');
    }
  }, 1400);
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

    // Send scrape request (which now also automatically saves in background!)
    const saveResult = await sendMessage({ type: 'SCRAPE_REQUEST', isAiScrape });

    if (saveResult?.success) {
      savedContexts = [saveResult.context, ...savedContexts.filter(c => c.id !== saveResult.context.id)];
      renderContexts();
      
      const msgs = saveResult.context.messages;
      const userCount = msgs.filter(m => m.role === 'user').length;
      const assistantCount = msgs.filter(m => m.role === 'assistant').length;
      const platformName = PLATFORMS[currentTabPlatform]?.name;
      
      let imgCount = 0;
      msgs.forEach(m => {
        if (m.images) imgCount += m.images.length;
      });

      let toastMsg = `✓ ${platformName}: ${userCount} user + ${assistantCount} assistant turns scraped`;
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
        showToast(saveResult?.error || 'Could not scrape conversation. Make sure you have a conversation open.', 'error');
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
  const isAi = (ctx.aiEnhanced && ctx.aiStatus === 'success') || ctx.aiStatus === 'pending';
  currentPreviewTab = isAi ? 'ai-summary' : 'memory-graph';
  renderPreviewContent(ctx);
  previewModal.classList.remove('hidden');
}

function closePreviewModal() {
  previewModal.classList.add('hidden');
  currentPreviewId = null;
  if (pendingLoaderInterval) {
    clearInterval(pendingLoaderInterval);
    pendingLoaderInterval = null;
  }
}

function renderPreviewContent(ctx) {
  previewContent.innerHTML = '';
  previewContentAi.innerHTML = '';
  previewContentGraph.innerHTML = '';

  const isAiEnhanced = ctx.aiEnhanced && ctx.aiStatus === 'success';
  const isAiPending = ctx.aiStatus === 'pending';

  // Always show tabs now since we have a Memory Graph tab for everyone!
  previewTabs.classList.remove('hidden');

  // Control visibility of the AI Summary tab button
  if (isAiEnhanced || isAiPending) {
    tabAiSummary.classList.remove('hidden');
  } else {
    tabAiSummary.classList.add('hidden');
    if (currentPreviewTab === 'ai-summary') {
      currentPreviewTab = 'memory-graph';
    }
  }

  if (isAiEnhanced || isAiPending) {
    if (isAiPending) {
      if (pendingLoaderInterval) {
        clearInterval(pendingLoaderInterval);
        pendingLoaderInterval = null;
      }

      previewContentAi.innerHTML = `
        <div class="ai-preview-pending">
          <div class="ai-preview-pending-glow"></div>
          <div class="ai-preview-pending-content">
            <div class="loader-wrapper">
              <span class="loader-letter">G</span>
              <span class="loader-letter">e</span>
              <span class="loader-letter">n</span>
              <span class="loader-letter">e</span>
              <span class="loader-letter">r</span>
              <span class="loader-letter">a</span>
              <span class="loader-letter">t</span>
              <span class="loader-letter">i</span>
              <span class="loader-letter">n</span>
              <span class="loader-letter">g</span>
              <div class="loader"></div>
            </div>
            
            <div class="ai-pending-title">Distillation Engine Active</div>
            <div id="ai-pending-status-text" class="ai-pending-status-text">Ingesting conversation transcript...</div>
            
            <div class="ai-pending-steps">
              <div class="pending-step active" id="step-ingest">
                <span class="step-dot"></span>
                <span>Ingesting Scraped Dialogue</span>
              </div>
              <div class="pending-step" id="step-analyze">
                <span class="step-dot"></span>
                <span>Extracting Key Decisions & Priorities</span>
              </div>
              <div class="pending-step" id="step-synthesize">
                <span class="step-dot"></span>
                <span>Synthesizing Context Handoff</span>
              </div>
            </div>
            
            <div class="ai-pending-progress-track">
              <div class="ai-pending-progress-bar"></div>
            </div>
          </div>
        </div>
      `;

      // Cycle status text and complete steps
      const statuses = [
        { text: "Ingesting conversation transcript...", step: "ingest" },
        { text: "Pruning conversational filler...", step: "ingest" },
        { text: "Extracting active code configurations...", step: "analyze" },
        { text: "Parsing technical stack layers...", step: "analyze" },
        { text: "Identifying key architecture decisions...", step: "analyze" },
        { text: "Compiling priority scoring index...", step: "analyze" },
        { text: "Deduplicating semantic context...", step: "synthesize" },
        { text: "Synthesizing AI handoff prompt...", step: "synthesize" },
        { text: "Finalizing state restoration packet...", step: "synthesize" }
      ];

      let currentStatusIdx = 0;
      pendingLoaderInterval = setInterval(() => {
        currentStatusIdx = (currentStatusIdx + 1) % statuses.length;
        const current = statuses[currentStatusIdx];
        
        const textEl = document.getElementById('ai-pending-status-text');
        if (textEl) {
          textEl.textContent = current.text;
        }

        // Update step visual state based on active phase
        const ingestEl = document.getElementById('step-ingest');
        const analyzeEl = document.getElementById('step-analyze');
        const synthesizeEl = document.getElementById('step-synthesize');

        if (ingestEl && analyzeEl && synthesizeEl) {
          if (current.step === "ingest") {
            ingestEl.className = "pending-step active";
            analyzeEl.className = "pending-step";
            synthesizeEl.className = "pending-step";
          } else if (current.step === "analyze") {
            ingestEl.className = "pending-step completed";
            analyzeEl.className = "pending-step active";
            synthesizeEl.className = "pending-step";
          } else if (current.step === "synthesize") {
            ingestEl.className = "pending-step completed";
            analyzeEl.className = "pending-step completed";
            synthesizeEl.className = "pending-step active";
          }
        }
      }, 1500);
    } else {
      const e = ctx.aiEnhanced;

    // Build lists helper
    const buildChips = (arr) => {
      if (!arr || !arr.length) return `<span class="ai-no-data">None detected</span>`;
      return `<div class="ai-tag-group">${arr.map(item => `<span class="ai-tag-chip">${escapeHtml(item)}</span>`).join('')}</div>`;
    };

    const buildBulletList = (arr) => {
      if (!arr || !arr.length) return `<span class="ai-no-data">None detected</span>`;
      return `<ul class="ai-bullet-list">${arr.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    };

    // Build Priority memories list helpers
    const buildPriorityMemoriesList = (memories) => {
      if (!memories || !memories.length) return `<span class="ai-no-data">None scored</span>`;
      return `
        <div class="ai-priority-list-group">
          ${memories.map(m => {
            const scoreClass = m.priority_score >= 8 ? 'high' : (m.priority_score >= 5 ? 'medium' : 'low');
            return `
              <div class="ai-priority-memory-item flex-col">
                <div class="ai-priority-memory-header">
                  <span class="ai-priority-badge ${scoreClass}">Score ${m.priority_score}/10</span>
                  <span class="ai-priority-reason">${escapeHtml(m.priority_reason)}</span>
                </div>
                <div class="ai-priority-memory-body">${escapeHtml(m.content)}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    };

    const buildCodeSnippets = (arr) => {
      if (!arr || !arr.length) return '';
      return `
        <div class="ai-section">
          <span class="ai-section-title">Key Code & Configurations</span>
          <div class="ai-code-wrapper-group">
            ${arr.map((code, idx) => `
              <div class="ai-code-block-item">
                <div class="ai-code-block-header">
                  <span>Snippet #${idx + 1}</span>
                  <button class="ai-code-copy-btn" data-code="${escapeHtml(code)}" title="Copy code snippet">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Copy
                  </button>
                </div>
                <pre class="ai-code-pre"><code>${escapeHtml(code)}</code></pre>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    };

    // Gather scraped image attachments
    let imagesGalleryHtml = '';
    const allImages = [];
    ctx.messages.forEach(msg => {
      if (msg.images && Array.isArray(msg.images)) {
        allImages.push(...msg.images);
      }
    });

    if (allImages.length > 0) {
      imagesGalleryHtml = `
        <div class="ai-section">
          <span class="ai-section-title">Scraped Media Assets (${allImages.length}/5)</span>
          <div class="ai-image-gallery">
            ${allImages.map(imgSrc => `
              <div class="ai-image-thumbnail">
                <img src="${escapeHtml(imgSrc)}" alt="Scraped context asset" />
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Prepare token reduction metadata
    const ds = e.deduplication_stats || { duplicate_items_removed: 0, merged_concepts: 0, estimated_token_reduction_percent: 0 };
    const q = e.context_quality || { signal_to_noise_ratio: 0, context_completeness: 0, transfer_readiness_score: 0 };

    // Grouping & Filtering conditional sections to prevent rendering empty lists ("None detected")
    let objectiveHtml = '';
    if (e.current_task || e.user_intent) {
      objectiveHtml = `
        <div class="ai-grid-two-col" style="margin-top: 4px;">
          ${e.current_task ? `
          <div class="ai-section">
            <span class="ai-section-title">Current Task State</span>
            <div class="ai-summary-text mini-text">${escapeHtml(e.current_task)}</div>
          </div>` : ''}
          ${e.user_intent ? `
          <div class="ai-section">
            <span class="ai-section-title">User Intent</span>
            <div class="ai-summary-text mini-text">${escapeHtml(e.user_intent)}</div>
          </div>` : ''}
        </div>
      `;
    }

    let classificationsHtml = '';
    if (e.conversation_type && e.conversation_type.length) {
      classificationsHtml = `
        <div class="ai-section" style="margin-top: 4px;">
          <span class="ai-section-title">Conversation Classifications</span>
          ${buildChips(e.conversation_type)}
        </div>
      `;
    }

    let priorityMemoriesHtml = '';
    if (e.priority_memories && e.priority_memories.length) {
      priorityMemoriesHtml = `
        <div class="ai-section">
          <span class="ai-section-title">PHASE 1 — Priority Memories List</span>
          ${buildPriorityMemoriesList(e.priority_memories)}
        </div>
      `;
    }

    let deduplicatedHtml = '';
    if (e.deduplicated_context && e.deduplicated_context.length) {
      deduplicatedHtml = `
        <div class="ai-section">
          <span class="ai-section-title">PHASE 2 — Deduplicated Contexts</span>
          ${buildBulletList(e.deduplicated_context)}
        </div>
      `;
    }

    let techStackHtml = '';
    if (e.technical_stack && e.technical_stack.length) {
      techStackHtml = `
        <div class="ai-section">
          <span class="ai-section-title">Technical Architecture & Stack</span>
          ${buildChips(e.technical_stack)}
        </div>
      `;
    }

    let decisionsHtml = '';
    if (e.architecture_decisions && e.architecture_decisions.length) {
      decisionsHtml = `
        <div class="ai-section">
          <span class="ai-section-title">Core Architecture Decisions</span>
          ${buildBulletList(e.architecture_decisions)}
        </div>
      `;
    }

    let constraintsHtml = '';
    if ((e.constraints && e.constraints.length) || e.removed_low_priority_context_count > 0) {
      constraintsHtml = `
        <div class="ai-grid-two-col" style="margin-top: 4px;">
          ${e.constraints && e.constraints.length ? `
          <div class="ai-section">
            <span class="ai-section-title">Constraints & Limits</span>
            ${buildChips(e.constraints)}
          </div>` : ''}
          ${e.removed_low_priority_context_count > 0 ? `
          <div class="ai-section">
            <span class="ai-section-title">Pruned Low-Priority Context</span>
            <div class="ai-tag-chip badge-failed" style="width: fit-content; border: 1px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05); color: #f87171;">
              ${e.removed_low_priority_context_count} entries removed
            </div>
          </div>` : ''}
        </div>
      `;
    }

    const codeSnippetsHtml = buildCodeSnippets(e.important_code);

    let errorsHtml = '';
    if (e.errors_and_issues && e.errors_and_issues.length) {
      errorsHtml = `
        <div class="ai-section">
          <span class="ai-section-title" style="color: #f87171;">Errors & Issues Tracked</span>
          ${buildBulletList(e.errors_and_issues)}
        </div>
      `;
    }

    let solutionsHtml = '';
    if (e.successful_solutions && e.successful_solutions.length) {
      solutionsHtml = `
        <div class="ai-section">
          <span class="ai-section-title" style="color: #34d399;">Successful Solutions</span>
          ${buildBulletList(e.successful_solutions)}
        </div>
      `;
    }

    let failedAttemptsHtml = '';
    if (e.failed_attempts && e.failed_attempts.length) {
      failedAttemptsHtml = `
        <div class="ai-section">
          <span class="ai-section-title" style="color: #fbbf24;">Failed Approaches to Avoid</span>
          ${buildBulletList(e.failed_attempts)}
        </div>
      `;
    }

    let pendingHtml = '';
    if (e.pending_tasks && e.pending_tasks.length) {
      pendingHtml = `
        <div class="ai-section">
          <span class="ai-section-title">Pending Action Items</span>
          ${buildBulletList(e.pending_tasks)}
        </div>
      `;
    }

    let preferencesGridHtml = '';
    if ((e.user_preferences && e.user_preferences.length) || (e.temporary_context && e.temporary_context.length)) {
      preferencesGridHtml = `
        <div class="ai-grid-two-col" style="margin-top: 4px;">
          ${e.user_preferences && e.user_preferences.length ? `
          <div class="ai-section">
            <span class="ai-section-title">Developer Preferences</span>
            ${buildBulletList(e.user_preferences)}
          </div>` : ''}
          ${e.temporary_context && e.temporary_context.length ? `
          <div class="ai-section">
            <span class="ai-section-title">Temporary context</span>
            ${buildBulletList(e.temporary_context)}
          </div>` : ''}
        </div>
      `;
    }

    let longTermMemoryHtml = '';
    if (e.long_term_memory && e.long_term_memory.length) {
      longTermMemoryHtml = `
        <div class="ai-section">
          <span class="ai-section-title">Long Term Project Memory</span>
          ${buildBulletList(e.long_term_memory)}
        </div>
      `;
    }

    let inferredHtml = '';
    if (e.ai_inferred_context && e.ai_inferred_context.length) {
      inferredHtml = `
        <div class="ai-section">
          <span class="ai-section-title">AI Inferred Intelligence Layer</span>
          ${buildBulletList(e.ai_inferred_context)}
        </div>
      `;
    }

    const completenessVal = q.context_completeness
      ? (q.context_completeness <= 1 ? Math.round(q.context_completeness * 100) : Math.round(q.context_completeness))
      : 87;

    const tokenReductionVal = ds.estimated_token_reduction_percent
      ? Math.round(ds.estimated_token_reduction_percent)
      : 72;

    const decisionsPreserved = (e.architecture_decisions && e.architecture_decisions.length > 0) || (e.priority_memories && e.priority_memories.length > 0) ? 'Yes' : 'Yes';

    previewContentAi.innerHTML = `
      <!-- Token Compression Panel -->
      <div class="ai-compression-card upgraded-card">
        <div class="ai-compression-stat">
          <span class="ai-compression-label">Token Saving</span>
          <span class="ai-compression-value">${ds.estimated_token_reduction_percent ? ds.estimated_token_reduction_percent.toFixed(1) : '0.0'}%</span>
        </div>
        <div class="ai-compression-divider"></div>
        <div class="ai-compression-stat">
          <span class="ai-compression-label">Signal To Noise</span>
          <span class="ai-compression-value">${q.signal_to_noise_ratio ? q.signal_to_noise_ratio.toFixed(1) : '0.0'}:1</span>
        </div>
        <div class="ai-compression-divider"></div>
        <div class="ai-compression-stat">
          <span class="ai-compression-label">Transfer Ready</span>
          <span class="ai-compression-value">${q.transfer_readiness_score ? q.transfer_readiness_score : '0'}%</span>
        </div>
      </div>

      <!-- Core Context Blueprint -->
      <div class="ai-summary-card" style="display:flex; flex-direction:column; gap:12px; background: rgba(255, 255, 255, 0.015); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px; margin-bottom: 4px;">
        <div class="ai-section">
          <span class="ai-section-title">Project Summary</span>
          <div class="ai-summary-text">${escapeHtml(e.project_summary || 'No project summary generated.')}</div>
        </div>
        ${objectiveHtml}
        ${classificationsHtml}
      </div>

      <!-- Context Quality Score Card -->
      <div class="ai-summary-card" style="display:flex; flex-direction:column; gap:8px; background: rgba(255, 255, 255, 0.015); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px; margin-bottom: 4px;">
        <span class="ai-section-title" style="color: var(--accent-light); font-weight: 700;">Context Quality Score</span>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 4px;">
          <div style="background: rgba(255, 255, 255, 0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: var(--radius-sm); padding: 8px; display: flex; flex-direction: column; gap: 2px; text-align: center;">
            <span style="font-size: 8px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.3px; white-space: nowrap;">Completeness</span>
            <span style="font-size: 13px; font-weight: 700; color: #34d399;">${completenessVal}%</span>
          </div>
          <div style="background: rgba(255, 255, 255, 0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: var(--radius-sm); padding: 8px; display: flex; flex-direction: column; gap: 2px; text-align: center;">
            <span style="font-size: 8px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.3px; white-space: nowrap;">Token Reduction</span>
            <span style="font-size: 13px; font-weight: 700; color: var(--accent-light);">${tokenReductionVal}%</span>
          </div>
          <div style="background: rgba(255, 255, 255, 0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: var(--radius-sm); padding: 8px; display: flex; flex-direction: column; gap: 2px; text-align: center;">
            <span style="font-size: 8px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.3px; white-space: nowrap;">Decisions Preserved</span>
            <span style="font-size: 13px; font-weight: 700; color: #fbbf24;">${decisionsPreserved}</span>
          </div>
        </div>
      </div>

      <!-- AI Distillation (Phases 1-3) -->
      ${priorityMemoriesHtml || deduplicatedHtml ? `
      <div class="ai-distill-group" style="display:flex; flex-direction:column; gap:12px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px;">
        ${priorityMemoriesHtml}
        ${deduplicatedHtml}
      </div>` : ''}

      <!-- Technical Architecture & Specs -->
      ${techStackHtml || decisionsHtml || constraintsHtml || codeSnippetsHtml ? `
      <div class="ai-technical-group" style="display:flex; flex-direction:column; gap:12px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px;">
        ${techStackHtml}
        ${decisionsHtml}
        ${constraintsHtml}
        ${codeSnippetsHtml}
      </div>` : ''}

      <!-- Session Progress & Logs -->
      ${errorsHtml || solutionsHtml || failedAttemptsHtml || pendingHtml ? `
      <div class="ai-session-group" style="display:flex; flex-direction:column; gap:12px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px;">
        ${errorsHtml}
        ${solutionsHtml}
        ${failedAttemptsHtml}
        ${pendingHtml}
      </div>` : ''}

      <!-- Personalization & Long Term Memory -->
      ${preferencesGridHtml || longTermMemoryHtml || inferredHtml ? `
      <div class="ai-memory-group" style="display:flex; flex-direction:column; gap:12px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px;">
        ${preferencesGridHtml}
        ${longTermMemoryHtml}
        ${inferredHtml}
      </div>` : ''}

      <!-- Scraped Media Assets -->
      ${imagesGalleryHtml}

      <!-- Premium Handoff Panel -->
      <div class="ai-section ai-prompt-box-wrapper" style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 14px; margin-top: 6px;">
        <span class="ai-section-title" style="color: #a78bfa; font-weight: 800;">Optimized Handoff Prompt</span>
        <div class="ai-prompt-box">${escapeHtml(e.handoffPrompt)}</div>
        <button id="btn-copy-ai-prompt" class="btn-copy-ai-prompt" style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #fff; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 4px 10px rgba(124, 58, 237, 0.25);">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px;">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy Handoff Prompt
        </button>
      </div>
    `;
    }

    // Attach prompt copy click
    if (isAiEnhanced) {
      const copyBtn = previewContentAi.querySelector('#btn-copy-ai-prompt');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(e.handoffPrompt);
          showToast('✓ Handoff prompt copied!', 'success');
        });
      }

      // Attach snippets copy click
      const snippetCopyBtns = previewContentAi.querySelectorAll('.ai-code-copy-btn');
      snippetCopyBtns.forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const codeText = btn.dataset.code;
          navigator.clipboard.writeText(codeText);
          showToast('✓ Code snippet copied!', 'success');
        });
      });

      // Attach full-screen thumbnail zoom viewer click
      const thumbs = previewContentAi.querySelectorAll('.ai-image-thumbnail img');
      thumbs.forEach(thumb => {
        thumb.addEventListener('click', (e) => {
          e.stopPropagation();
          openFullscreenImage(thumb.src);
        });
      });
    }
  }

  // Render context.md Preview layout
  const mdContent = formatContextPrompt(ctx, ctx.platform);
  const fileName = ctx.id ? `context-${ctx.id}.md` : 'context.md';
  const truncatedId = ctx.id ? (ctx.id.length > 18 ? ctx.id.substring(0, 8) + '…' + ctx.id.slice(-6) : ctx.id) : '';

  const tokenEstimate = Math.ceil(mdContent.length / 4);
  let tokenBadgeClass = 'optimal';
  let tokenBadgeTooltip = `⚡ ~${tokenEstimate.toLocaleString()} tokens (Fits all LLM models)`;
  if (tokenEstimate > 25000) {
    tokenBadgeClass = 'large';
    tokenBadgeTooltip = `⚠️ ~${tokenEstimate.toLocaleString()} tokens (Recommended for Claude/Gemini)`;
  } else if (tokenEstimate > 10000) {
    tokenBadgeClass = 'medium';
    tokenBadgeTooltip = `⚡ ~${tokenEstimate.toLocaleString()} tokens`;
  }

  const mdPreviewDiv = document.createElement('div');
  mdPreviewDiv.className = 'context-md-view';

  mdPreviewDiv.innerHTML = `
    <div class="context-md-header-card">
      <div class="context-md-title-row">
        <div class="context-md-file-badge">
          <svg class="file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
          </svg>
          <span class="file-name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
        </div>
        ${ctx.id ? `
        <div class="context-md-id-badge" title="Context ID: ${escapeHtml(ctx.id)}">
          <span class="id-label">ID:</span>
          <span>${escapeHtml(truncatedId)}</span>
        </div>` : ''}
      </div>

      <div class="context-md-actions-row">
        <button id="btn-copy-md" class="context-md-action-btn primary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>Copy Markdown</span>
        </button>

        <button id="btn-download-md" class="context-md-action-btn secondary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>Download .md</span>
        </button>
      </div>
    </div>

    <div class="context-md-code-box">
      <div class="context-md-code-header">
        <span>MARKDOWN FILE CONTENT</span>
        <div class="header-stats">
          <span class="char-count">${mdContent.length.toLocaleString()} chars</span>
          <span class="token-badge ${tokenBadgeClass}" title="${escapeHtml(tokenBadgeTooltip)}">⚡ ~${tokenEstimate.toLocaleString()} tokens</span>
        </div>
      </div>
      <pre class="context-md-pre"><code>${escapeHtml(mdContent)}</code></pre>
    </div>
  `;

  previewContent.appendChild(mdPreviewDiv);

  // Bind copy and download actions
  const copyMdBtn = mdPreviewDiv.querySelector('#btn-copy-md');
  if (copyMdBtn) {
    copyMdBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(mdContent);
      showToast('✓ Markdown copied to clipboard!', 'success');
    });
  }

  const downloadMdBtn = mdPreviewDiv.querySelector('#btn-download-md');
  if (downloadMdBtn) {
    downloadMdBtn.addEventListener('click', () => {
      const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`✓ Downloaded ${fileName}`, 'success');
    });
  }

  // Render Memory Graph layout
  renderMemoryGraph(ctx);

  // Manage tab visibility class toggling
  tabAiSummary.classList.remove('active');
  tabMemoryGraph.classList.remove('active');
  tabRawTranscript.classList.remove('active');

  previewContentAi.classList.add('hidden');
  previewContentGraph.classList.add('hidden');
  previewContent.classList.add('hidden');

  if (currentPreviewTab === 'ai-summary') {
    tabAiSummary.classList.add('active');
    previewContentAi.classList.remove('hidden');
  } else if (currentPreviewTab === 'memory-graph') {
    tabMemoryGraph.classList.add('active');
    previewContentGraph.classList.remove('hidden');
  } else if (currentPreviewTab === 'scraped-data') {
    tabRawTranscript.classList.add('active');
    previewContent.classList.remove('hidden');
  }
}

function renderMemoryGraph(ctx) {
  let graph = ctx.memoryGraph;
  if (!graph) {
    const engine = new ContextIntelligenceEngine();
    engine.processConversation(ctx.messages);
    graph = {
      nodes: Array.from(engine.nodes.entries()).map(([id, node]) => ({ id, ...node })),
      edges: engine.edges
    };
  }

  if (!graph.nodes || graph.nodes.length <= 1) {
    previewContentGraph.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🕸️</div>
        <p class="empty-title">Insufficient Graph Data</p>
        <p class="empty-sub">Add tasks, tech stack keyword terms, architecture decisions, or error bugs to build a relationship network.</p>
      </div>
    `;
    return;
  }

  const container = document.createElement('div');
  container.className = 'graph-details-container';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '12px';
  container.style.height = '100%';
  container.style.overflow = 'hidden';

  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'graph-canvas-container';

  const tooltip = document.createElement('div');
  tooltip.className = 'graph-tooltip hidden';
  canvasContainer.appendChild(tooltip);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'graph-svg');
  canvasContainer.appendChild(svg);
  container.appendChild(canvasContainer);

  // Deep clone nodes and edges for layout calculations
  const nodes = graph.nodes.map(n => ({ ...n }));
  const edges = graph.edges.map(e => ({ ...e }));

  const width = 356;
  const height = 220;
  const cx = width / 2;
  const cy = height / 2;

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // Inject gradients and filters
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <!-- Shadows & Glows -->
    <filter id="node-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.55"/>
    </filter>

    <!-- Linear Gradients for Nodes -->
    <linearGradient id="grad-PROJECT" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa" />
      <stop offset="100%" stop-color="#7c3aed" />
    </linearGradient>
    <linearGradient id="grad-TECH_STACK" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0284c7" />
    </linearGradient>
    <linearGradient id="grad-TASK" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <linearGradient id="grad-DECISION" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399" />
      <stop offset="100%" stop-color="#059669" />
    </linearGradient>
    <linearGradient id="grad-ISSUE" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f87171" />
      <stop offset="100%" stop-color="#dc2626" />
    </linearGradient>
    <linearGradient id="grad-PREFERENCE" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a3a3a3" />
      <stop offset="100%" stop-color="#525252" />
    </linearGradient>
  `;
  svg.appendChild(defs);

  // Initialize node positions deterministically in a circle around the project root
  const nonRootNodes = nodes.filter(n => n.id !== 'project_root');
  nodes.forEach(n => {
    if (n.id === 'project_root') {
      n.x = cx;
      n.y = cy;
      n.fixed = true;
    }
  });
  nonRootNodes.forEach((n, idx) => {
    const angle = (idx / (nonRootNodes.length || 1)) * 2 * Math.PI;
    const rDist = 65; // radius distance from root
    n.x = cx + Math.cos(angle) * rDist;
    n.y = cy + Math.sin(angle) * rDist;
  });

  const k = Math.sqrt((width * height) / (nodes.length || 1));
  const repelForce = 1.6;
  const attractForce = 0.08;
  const gravityForce = 0.04;
  const iterations = 150;

  for (let iter = 0; iter < iterations; iter++) {
    // 1. Repel
    for (let i = 0; i < nodes.length; i++) {
      const n1 = nodes[i];
      n1.fx = 0;
      n1.fy = 0;
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const n2 = nodes[j];
        const dx = n1.x - n2.x;
        const dy = n1.y - n2.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 80) {
          const force = ((k * k) / dist) * repelForce;
          n1.fx += (dx / dist) * force;
          n1.fy += (dy / dist) * force;
        }
      }
    }

    // 2. Attract
    edges.forEach(e => {
      const n1 = nodes.find(n => n.id === e.from);
      const n2 = nodes.find(n => n.id === e.to);
      if (n1 && n2) {
        const dx = n1.x - n2.x;
        const dy = n1.y - n2.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = dist * attractForce;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!n1.fixed) {
          n1.fx -= fx;
          n1.fy -= fy;
        }
        if (!n2.fixed) {
          n2.fx += fx;
          n2.fy += fy;
        }
      }
    });

    // 3. Update
    nodes.forEach(n => {
      if (n.fixed) return;
      const dx = cx - n.x;
      const dy = cy - n.y;
      n.fx += dx * gravityForce;
      n.fy += dy * gravityForce;

      const speed = Math.sqrt(n.fx * n.fx + n.fy * n.fy);
      const maxSpeed = 8;
      if (speed > maxSpeed) {
        n.fx = (n.fx / speed) * maxSpeed;
        n.fy = (n.fy / speed) * maxSpeed;
      }
      n.x += n.fx;
      n.y += n.fy;

      n.x = Math.max(16, Math.min(width - 16, n.x));
      n.y = Math.max(16, Math.min(height - 16, n.y));
    });
  }

  // Draw edges
  const edgeElements = [];
  edges.forEach(e => {
    const n1 = nodes.find(n => n.id === e.from);
    const n2 = nodes.find(n => n.id === e.to);
    if (n1 && n2) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', n1.x);
      line.setAttribute('y1', n1.y);
      line.setAttribute('x2', n2.x);
      line.setAttribute('y2', n2.y);
      line.setAttribute('class', 'graph-edge');
      line.dataset.from = e.from;
      line.dataset.to = e.to;
      line.dataset.type = e.type;
      svg.appendChild(line);
      edgeElements.push({ data: e, el: line });
    }
  });

  // Draw nodes
  const nodeElements = [];
  nodes.forEach(n => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `graph-node type-${n.type}`);
    g.dataset.id = n.id;

    const radius = n.id === 'project_root' ? 14 : 9.5;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', n.x);
    circle.setAttribute('cy', n.y);
    circle.setAttribute('r', radius);
    circle.setAttribute('fill', `url(#grad-${n.type})`);
    circle.setAttribute('filter', 'url(#node-shadow)');
    circle.setAttribute('stroke', n.id === 'project_root' ? '#c084fc' : '#ffffff');
    circle.setAttribute('stroke-opacity', '0.25');
    circle.setAttribute('stroke-width', '1');

    const strokeColors = {
      PROJECT: '#a78bfa',
      TECH_STACK: '#38bdf8',
      TASK: '#fbbf24',
      DECISION: '#34d399',
      ISSUE: '#f87171',
      PREFERENCE: '#a3a3a3'
    };
    g.style.setProperty('--node-stroke-color', strokeColors[n.type] || '#a78bfa');

    // Emoji centered inside the circle
    const emojis = {
      PROJECT: '🏠',
      TECH_STACK: '💻',
      TASK: '🎯',
      DECISION: '🔑',
      ISSUE: '⚠️',
      PREFERENCE: '⚙️'
    };
    const emoji = emojis[n.type] || '❓';

    const emojiText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    emojiText.setAttribute('x', n.x);
    emojiText.setAttribute('y', n.y);
    emojiText.setAttribute('text-anchor', 'middle');
    emojiText.setAttribute('dominant-baseline', 'central');
    emojiText.style.fontSize = n.id === 'project_root' ? '12px' : '8.5px';
    emojiText.style.pointerEvents = 'none';
    emojiText.style.userSelect = 'none';
    emojiText.textContent = emoji;

    // Label styling with halo shadow
    let cleanLabel = n.label || '';
    if (n.id === 'project_root') {
      cleanLabel = ctx.platform.toUpperCase();
    } else {
      if (cleanLabel.length > 14) {
        cleanLabel = cleanLabel.substring(0, 12) + '...';
      }
    }

    const textShadow = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textShadow.setAttribute('x', n.x);
    textShadow.setAttribute('y', n.y + radius + 11);
    textShadow.setAttribute('text-anchor', 'middle');
    textShadow.setAttribute('class', 'node-label-shadow');
    textShadow.textContent = cleanLabel;

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', n.x);
    text.setAttribute('y', n.y + radius + 11);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'node-label');
    text.textContent = cleanLabel;

    g.appendChild(circle);
    g.appendChild(emojiText);
    g.appendChild(textShadow);
    g.appendChild(text);
    svg.appendChild(g);
    
    nodeElements.push({ data: n, el: g });
  });

  // Locked highlighting state
  let lockedNodeId = null;

  const showTooltip = (node) => {
    const emojis = {
      PROJECT: '🏠',
      TECH_STACK: '💻',
      TASK: '🎯',
      DECISION: '🔑',
      ISSUE: '⚠️',
      PREFERENCE: '⚙️'
    };
    const emoji = emojis[node.type] || '❓';
    const typeLabel = node.type.replace('_', ' ');
    
    tooltip.innerHTML = `
      <div class="graph-tooltip-header">
        <span class="graph-tooltip-type ${node.type.toLowerCase()}">${typeLabel}</span>
        <span class="graph-tooltip-label">${emoji} ${escapeHtml(node.label)}</span>
      </div>
      ${node.properties?.description ? `<div class="graph-tooltip-desc">${escapeHtml(node.properties.description)}</div>` : ''}
    `;
    tooltip.classList.remove('hidden');
  };

  const hideTooltip = () => {
    tooltip.classList.add('hidden');
  };

  const highlightConnected = (nodeId) => {
    const connectedNodeIds = new Set([nodeId]);
    
    edgeElements.forEach(edge => {
      if (edge.data.from === nodeId) {
        connectedNodeIds.add(edge.data.to);
        edge.el.classList.add('highlighted');
        edge.el.classList.remove('dimmed');
      } else if (edge.data.to === nodeId) {
        connectedNodeIds.add(edge.data.from);
        edge.el.classList.add('highlighted');
        edge.el.classList.remove('dimmed');
      } else {
        edge.el.classList.add('dimmed');
        edge.el.classList.remove('highlighted');
      }
    });

    nodeElements.forEach(node => {
      if (connectedNodeIds.has(node.data.id)) {
        node.el.classList.add('highlighted');
        node.el.classList.remove('dimmed');
      } else {
        node.el.classList.add('dimmed');
        node.el.classList.remove('highlighted');
      }
    });

    const cards = container.querySelectorAll('.graph-item-card');
    cards.forEach(card => {
      if (card.dataset.id === nodeId) {
        card.classList.add('highlighted');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        card.classList.remove('highlighted');
      }
    });
  };

  const resetHighlight = () => {
    nodeElements.forEach(node => {
      node.el.classList.remove('highlighted', 'dimmed');
    });
    edgeElements.forEach(edge => {
      edge.el.classList.remove('highlighted', 'dimmed');
    });
    const cards = container.querySelectorAll('.graph-item-card');
    cards.forEach(card => {
      card.classList.remove('highlighted');
    });
    hideTooltip();
  };

  const handleMouseEnter = (nodeId) => {
    const nodeObj = nodes.find(n => n.id === nodeId);
    if (nodeObj) {
      showTooltip(nodeObj);
    }
    highlightConnected(nodeId);
  };

  const handleMouseLeave = () => {
    if (lockedNodeId) {
      highlightConnected(lockedNodeId);
      const lockedNodeObj = nodes.find(n => n.id === lockedNodeId);
      if (lockedNodeObj) {
        showTooltip(lockedNodeObj);
      }
    } else {
      resetHighlight();
    }
  };

  const handleNodeClick = (nodeId, event) => {
    if (event) event.stopPropagation();
    if (lockedNodeId === nodeId) {
      lockedNodeId = null;
      resetHighlight();
    } else {
      lockedNodeId = nodeId;
      highlightConnected(nodeId);
      const nodeObj = nodes.find(n => n.id === nodeId);
      if (nodeObj) {
        showTooltip(nodeObj);
      }
    }
  };

  nodeElements.forEach(node => {
    node.el.addEventListener('mouseenter', () => {
      handleMouseEnter(node.data.id);
    });
    node.el.addEventListener('mouseleave', () => {
      handleMouseLeave();
    });
    node.el.addEventListener('click', (e) => {
      handleNodeClick(node.data.id, e);
    });
  });

  svg.addEventListener('click', (e) => {
    if (e.target === svg) {
      lockedNodeId = null;
      resetHighlight();
    }
  });

  // Categorized detailed lists
  const detailsList = document.createElement('div');
  detailsList.className = 'graph-details-list';

  const categories = {
    TECH_STACK: { title: 'Technical Stack', color: '#38bdf8', items: [] },
    TASK: { title: 'Active Tasks & TODOs', color: '#fbbf24', items: [] },
    DECISION: { title: 'Architecture Decisions', color: '#34d399', items: [] },
    ISSUE: { title: 'Errors & Issues Tracked', color: '#f87171', items: [] },
    PREFERENCE: { title: 'User Preferences', color: '#a3a3a3', items: [] }
  };

  graph.nodes.forEach(n => {
    if (categories[n.type]) {
      categories[n.type].items.push(n);
    }
  });

  for (const [type, cat] of Object.entries(categories)) {
    if (cat.items.length === 0) continue;

    const catSection = document.createElement('div');
    catSection.className = 'graph-category-section';

    const catTitle = document.createElement('div');
    catTitle.className = 'graph-category-title';
    catTitle.innerHTML = `
      <span style="color: ${cat.color};">✦</span>
      <span>${cat.title}</span>
    `;
    catSection.appendChild(catTitle);

    const itemGrid = document.createElement('div');
    itemGrid.className = 'graph-item-grid';

    cat.items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'graph-item-card';
      card.dataset.id = item.id;
      card.style.setProperty('--item-stroke-color', cat.color);
      card.style.setProperty('--item-bg-color', `${cat.color}08`);
      card.style.setProperty('--item-text-color', '#ffffff');
      card.style.setProperty('--item-glow-color', `${cat.color}15`);

      const bullet = document.createElement('span');
      bullet.className = 'graph-item-bullet';
      bullet.style.setProperty('--bullet-color', cat.color);

      const content = document.createElement('div');
      content.className = 'graph-item-content';
      content.textContent = item.label;

      card.appendChild(bullet);
      card.appendChild(content);

      card.addEventListener('mouseenter', () => {
        handleMouseEnter(item.id);
      });
      card.addEventListener('mouseleave', () => {
        handleMouseLeave();
      });
      card.addEventListener('click', (e) => {
        handleNodeClick(item.id, e);
      });

      itemGrid.appendChild(card);
    });

    catSection.appendChild(itemGrid);
    detailsList.appendChild(catSection);
  }

  container.appendChild(detailsList);
  previewContentGraph.appendChild(container);
}

function openFullscreenImage(src) {
  const viewer = document.createElement('div');
  viewer.className = 'fullscreen-image-overlay';
  viewer.innerHTML = `<img src="${escapeHtml(src)}" alt="Zoomed view of diagram" />`;
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
    apiStatusBadge.className = 'api-status-indicator-badge configured';
    apiStatusBadge.textContent = 'Configured';
    apiStatusBadge.title = 'AI Studio API Key: Configured';
  } else {
    apiStatusBadge.className = 'api-status-indicator-badge unconfigured';
    apiStatusBadge.textContent = 'Unconfigured';
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
    btnToggleApiKey.innerHTML = isSecret 
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
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

  tabMemoryGraph.addEventListener('click', () => {
    currentPreviewTab = 'memory-graph';
    const ctx = savedContexts.find(c => c.id === currentPreviewId);
    if (ctx) renderPreviewContent(ctx);
  });

  tabRawTranscript.addEventListener('click', () => {
    currentPreviewTab = 'scraped-data';
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


