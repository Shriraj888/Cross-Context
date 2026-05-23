// Cross Context — Content Script Dispatcher
// Runs on all supported LLM pages
// NOTE: Content scripts cannot use ES module dynamic import().
// All platform logic is bundled inline here.

(async () => {
  'use strict';

  // ──────────────────────────────────────────
  // Platform Detection
  // ──────────────────────────────────────────
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;

  function detectPlatform() {
    if (hostname.includes('claude.ai'))         return 'claude';
    if (hostname.includes('chatgpt.com'))       return 'chatgpt';
    if (hostname.includes('gemini.google.com')) return 'gemini';
    if (hostname.includes('grok.com'))          return 'grok';
    if (hostname.includes('x.com') && pathname.includes('grok')) return 'grok';
    if (hostname.includes('perplexity.ai'))     return 'perplexity';
    return null;
  }

  const platform = detectPlatform();
  if (!platform) return;

  const AI_MEDIA_LIMIT = 5;
  const AI_MEDIA_CONCURRENCY = 3;
  const AI_MEDIA_MAX_DIMENSION = 1024;
  const AI_MEDIA_JPEG_QUALITY = 0.82;

  // Idempotent listener registration: remove old listener before adding new one.
  // This handles extension reloads — Chrome removes content scripts but keeps
  // window vars, so a window-flag guard would block fresh re-injection.
  if (window.__crossContextListener) {
    chrome.runtime.onMessage.removeListener(window.__crossContextListener);
    window.__crossContextListener = null;
  }

  // ════════════════════════════════════════════
  // SCRAPERS — one per platform
  // ════════════════════════════════════════════

  let isSessionActive = false;
  let tempStyle = null;
  let activeScrapeTextCache = null;

  function startScrapingSession() {
    if (isSessionActive) return;
    isSessionActive = true;
    if (!tempStyle) {
      tempStyle = document.createElement('style');
      tempStyle.id = 'cc-scrape-temp-style';
      tempStyle.textContent = `
        .cc-scraping-active button,
        .cc-scraping-active svg,
        .cc-scraping-active [role="button"],
        .cc-scraping-active mat-icon,
        .cc-scraping-active [class*="action-bar"],
        .cc-scraping-active [class*="toolbar"],
        .cc-scraping-active [class*="copy-button"],
        .cc-scraping-active [data-testid*="copy"],
        .cc-scraping-active [data-testid*="action"],
        .cc-scraping-active [data-testid*="share"],
        .cc-scraping-active [class*="feedback"],
        .cc-scraping-active [class*="thumbs"],
        .cc-scraping-active [class*="vote"],
        .cc-scraping-active [class*="like"],
        .cc-scraping-active [class*="share"],
        .cc-scraping-active form,
        .cc-scraping-active .juice\\:flex,
        .cc-scraping-active .juice\\:items-center,
        .cc-scraping-active [class*="speech-button"],
        .cc-scraping-active div.action-area,
        .cc-scraping-active .message-actions,
        .cc-scraping-active .response-actions,
        .cc-scraping-active .claude-actions,
        .cc-scraping-active [class*="action-buttons"],
        .cc-scraping-active [class*="citation"],
        .cc-scraping-active [class*="source"],
        .cc-scraping-active sup {
          display: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(tempStyle);
    }
    document.documentElement.classList.add('cc-scraping-active');
  }

  function endScrapingSession() {
    if (!isSessionActive) return;
    isSessionActive = false;
    document.documentElement.classList.remove('cc-scraping-active');
    if (tempStyle) {
      tempStyle.remove();
      tempStyle = null;
    }
  }

  // Use innerText on the LIVE (attached) element — with a temporary stylesheet
  // that hides all unwanted elements during extraction.
  // This prunes all UI chrome (copy buttons, thumbs, actions) before reading innerText
  // while avoiding the layout thrashing caused by repeatedly cloning and appending elements.
  function getInnerText(el) {
    if (!el) return '';
    if (activeScrapeTextCache?.has(el)) {
      return activeScrapeTextCache.get(el);
    }
    const wasActive = isSessionActive;
    if (!wasActive) startScrapingSession();
    const text = (el.innerText || el.textContent || '').trim();
    if (!wasActive) endScrapingSession();
    activeScrapeTextCache?.set(el, text);
    return text;
  }

  // Alias extractText to getInnerText to preserve compatibility
  function extractText(el) {
    return getInnerText(el);
  }

  // Filter out elements that are inputs/textareas or inside the compose/input/form area or sidebar/nav
  function filterInputArea(el) {
    if (!el) return false;
    const tagName = el.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true') {
      return false;
    }
    if (
      el.closest('[data-testid="compose-input"]') || 
      el.closest('[class*="compose"]') || 
      el.closest('[class*="input-area"]') || 
      el.closest('[class*="input_area"]') || 
      el.closest('[class*="input-box"]') || 
      el.closest('[class*="input_box"]') || 
      el.closest('form') ||
      el.closest('fieldset') ||
      el.closest('footer') ||
      el.closest('[contenteditable="true"]') ||
      el.closest('nav') ||
      el.closest('[role="navigation"]') ||
      el.closest('[class*="sidebar"]') ||
      el.closest('[class*="nav-"]') ||
      el.closest('[class*="nav_"]') ||
      el.closest('[id*="sidebar"]') ||
      el.closest('[id*="navigation"]')
    ) {
      return false;
    }
    return true;
  }

  // Check that messages array has at least one of each role
  function hasBothRoles(msgs) {
    return msgs.some(m => m.role === 'user') && msgs.some(m => m.role === 'assistant');
  }

  // Remove duplicate consecutive messages (same role+content)
  function deduplicate(messages) {
    return messages.filter((msg, i) => {
      if (i === 0) return true;
      return !(msg.role === messages[i-1].role && msg.content === messages[i-1].content);
    });
  }

  function filterTopLevelOnly(elements) {
    const set = new Set(elements);
    return elements.filter(el => {
      let parent = el.parentElement;
      while (parent) {
        if (set.has(parent)) {
          return false;
        }
        parent = parent.parentElement;
      }
      return true;
    });
  }

  // Sort two element sets by DOM order, interleave, extract text
  function interleaveByDomOrder(userEls, assistantEls, extractFn = getInnerText) {
    const combinedEls = [...userEls, ...assistantEls];
    const topLevel = filterTopLevelOnly(combinedEls);
    
    const all = topLevel.map(el => {
      const isUser = userEls.includes(el);
      return { el, role: isUser ? 'user' : 'assistant' };
    });
    
    all.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    return all
      .map(({ el, role }) => ({ role, content: extractFn(el), element: el }))
      .filter(m => m.content.length > 5);
  }

  // Universal fallback: walk text blocks in DOM order, alternate roles
  function universalFallback(containerSelector, minLen = 20) {
    const messages = [];
    const blocks = document.querySelectorAll(containerSelector);
    let lastRole = null;
    blocks.forEach(el => {
      const text = getInnerText(el);
      if (text.length < minLen) return;
      const role = lastRole === 'user' ? 'assistant' : 'user';
      lastRole = role;
      messages.push({ role, content: text, element: el });
    });
    return messages;
  }

  // Find the Lowest Common Ancestor (LCA) of a list of elements
  function findLCA(elements) {
    if (elements.length === 0) return null;
    if (elements.length === 1) return elements[0].parentElement;
    
    let lca = elements[0].parentElement;
    while (lca) {
      const containsAll = elements.every(el => lca.contains(el));
      if (containsAll) {
        return lca;
      }
      lca = lca.parentElement;
    }
    return null;
  }

  // Universal LCA-based turn extractor
  function extractConversationViaLCA(userSelectors, assistantSelectors, copyButtonSelectors) {
    let userEls = [...document.querySelectorAll(userSelectors)].filter(filterInputArea);
    let assistantEls = assistantSelectors ? [...document.querySelectorAll(assistantSelectors)].filter(filterInputArea) : [];
    let copyBtns = copyButtonSelectors ? [...document.querySelectorAll(copyButtonSelectors)].filter(filterInputArea) : [];

    // Exclude assistant elements that are actually inside user elements
    assistantEls = assistantEls.filter(el => !userEls.some(userEl => userEl.contains(el)));

    if (userEls.length === 0) return null;

    // 1. Locate the chat container using ancestor-traversal method
    let chatContainer = null;
    let curr = userEls[0];
    while (curr && curr !== document.body && curr !== document.documentElement) {
      const parent = curr.parentElement;
      if (!parent) break;
      
      // The chat container must contain all user messages
      const containsAllUsers = userEls.every(el => parent.contains(el));
      if (containsAllUsers) {
        let hasUserTurn = false;
        let hasAssistantTurn = false;
        
        for (const child of parent.children) {
          const containsAnyUser = userEls.some(el => child.contains(el));
          if (containsAnyUser) {
            hasUserTurn = true;
          } else {
            const text = getInnerText(child);
            if (text.length > 20) {
              hasAssistantTurn = true;
            }
          }
        }
        
        if (hasUserTurn && hasAssistantTurn) {
          chatContainer = parent;
          break;
        }
      }
      curr = parent;
    }

    // Fallback if no container with both turns is found
    if (!chatContainer) {
      const allIndicators = [...userEls, ...assistantEls, ...copyBtns];
      chatContainer = findLCA(allIndicators);
    }

    if (!chatContainer || chatContainer === document.body || chatContainer === document.documentElement) return null;

    // Walk down single-child wrappers to get to the direct container of message turns
    while (chatContainer && chatContainer.children.length === 1 && !userEls.some(el => chatContainer === el)) {
      chatContainer = chatContainer.children[0];
    }

    const userTurns = new Set();
    const assistantTurns = new Set();

    userEls.forEach(el => {
      let curr = el;
      while (curr && curr.parentElement !== chatContainer) {
        curr = curr.parentElement;
      }
      if (curr) userTurns.add(curr);
    });

    assistantEls.forEach(el => {
      let curr = el;
      while (curr && curr.parentElement !== chatContainer) {
        curr = curr.parentElement;
      }
      if (curr) assistantTurns.add(curr);
    });

    copyBtns.forEach(btn => {
      let curr = btn;
      while (curr && curr.parentElement !== chatContainer) {
        curr = curr.parentElement;
      }
      if (curr) assistantTurns.add(curr);
    });

    const messages = [];
    let lastRole = null;

    for (const child of chatContainer.children) {
      const isUser = userTurns.has(child);
      const isAssistant = assistantTurns.has(child);

      let role = null;
      if (isUser && !isAssistant) {
        role = 'user';
      } else if (isAssistant && !isUser) {
        role = 'assistant';
      } else if (isUser && isAssistant) {
        role = 'assistant';
      } else {
        // Fallback for elements without explicit indicators
        const text = getInnerText(child);
        if (text.length > 10) {
          role = lastRole === 'user' ? 'assistant' : 'user';
        }
      }

      if (role) {
        const text = getInnerText(child);
        if (text.length > 0) {
          if (role === 'assistant' && text.length < 10) continue;
          messages.push({ role, content: text, element: child });
          lastRole = role;
        }
      }
    }

    return messages.length > 0 ? messages : null;
  }

  // ──────────────────────────────────────────
  // Media / Image Capture Helpers
  // ──────────────────────────────────────────

  async function svgToPngBase64(svgElement) {
    try {
      const svgString = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const rect = svgElement.getBoundingClientRect();
            const rawWidth = rect.width || svgElement.clientWidth || parseInt(svgElement.getAttribute('width')) || 500;
            const rawHeight = rect.height || svgElement.clientHeight || parseInt(svgElement.getAttribute('height')) || 500;
            const scale = Math.min(1, AI_MEDIA_MAX_DIMENSION / Math.max(rawWidth, rawHeight));
            canvas.width = Math.max(1, Math.round(rawWidth * scale));
            canvas.height = Math.max(1, Math.round(rawHeight * scale));
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/png'));
          } catch (e) {
            URL.revokeObjectURL(url);
            resolve(null);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      });
    } catch (err) {
      console.warn('Cross Context: svgToPngBase64 failed', err);
      return null;
    }
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function optimizeImageDataUrl(dataUrl) {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl || null;
    if (dataUrl.startsWith('data:image/svg')) return dataUrl;

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          if (!width || !height) {
            resolve(dataUrl);
            return;
          }

          const shouldCompress = Math.max(width, height) > AI_MEDIA_MAX_DIMENSION || dataUrl.length > 750000;
          if (!shouldCompress) {
            resolve(dataUrl);
            return;
          }

          const scale = Math.min(1, AI_MEDIA_MAX_DIMENSION / Math.max(width, height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));

          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', AI_MEDIA_JPEG_QUALITY));
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function optimizeBlobImage(blob) {
    const dataUrl = await readBlobAsDataUrl(blob);
    return optimizeImageDataUrl(dataUrl);
  }

  async function getBase64FromImageUrl(src) {
    if (!src) return null;
    if (src.startsWith('data:')) return optimizeImageDataUrl(src);
    
    if (src.startsWith('blob:')) {
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        return optimizeBlobImage(blob);
      } catch (err) {
        console.warn('Cross Context: Failed to fetch blob image', err);
        return null;
      }
    }
    
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BASE64', url: src }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (response && response.success) {
          optimizeImageDataUrl(response.base64).then(resolve);
        } else {
          resolve(null);
        }
      });
    });
  }

  function getImagesFromElement(el) {
    const media = [];
    if (!el) return media;
    
    const imgTags = el.querySelectorAll('img');
    imgTags.forEach(img => {
      const src = img.src || img.getAttribute('src');
      if (!src) return;
      
      const isAvatar = src.includes('profile') || src.includes('avatar') || img.classList.contains('rounded-sm') || img.classList.contains('rounded-full');
      const isEmoji = img.classList.contains('emoji') || (img.clientWidth > 0 && img.clientWidth < 25) || (img.clientHeight > 0 && img.clientHeight < 25);
      
      if (!isAvatar && !isEmoji) {
        media.push({ type: 'img', src });
      }
    });
    
    const svgTags = el.querySelectorAll('svg');
    svgTags.forEach(svg => {
      const rect = svg.getBoundingClientRect();
      const width = rect.width || svg.clientWidth || parseInt(svg.getAttribute('width')) || 0;
      const height = rect.height || svg.clientHeight || parseInt(svg.getAttribute('height')) || 0;
      
      if (width > 35 && height > 35) {
        media.push({ type: 'svg', element: svg });
      }
    });
    
    return media;
  }

  async function processMediaElements(mediaItems, limit = 5) {
    const itemsToProcess = mediaItems.slice(0, limit);
    const base64s = await mapWithConcurrency(itemsToProcess, AI_MEDIA_CONCURRENCY, async (item) => {
      try {
        if (item.type === 'img') {
          return await getBase64FromImageUrl(item.src);
        } else if (item.type === 'svg') {
          return await svgToPngBase64(item.element);
        }
      } catch (err) {
        console.warn('Cross Context: Failed to process media item', err);
      }
      return null;
    });
    return base64s;
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(limit, items.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }));

    return results;
  }

  async function attachMediaToMessages(messages, limit = AI_MEDIA_LIMIT) {
    const mediaItems = [];
    const seen = new Set();

    for (const msg of messages) {
      if (!msg.element || mediaItems.length >= limit) continue;

      const items = getImagesFromElement(msg.element);
      for (const item of items) {
        const key = item.type === 'img' ? `img:${item.src}` : item.element;
        if (seen.has(key)) continue;
        seen.add(key);
        mediaItems.push({ ...item, message: msg });
        if (mediaItems.length >= limit) break;
      }
    }

    const processed = await processMediaElements(mediaItems, limit);
    let attachedCount = 0;
    processed.forEach((dataUrl, index) => {
      const msg = mediaItems[index]?.message;
      if (!msg || !dataUrl) return;
      if (!msg.images) msg.images = [];
      msg.images.push(dataUrl);
      attachedCount++;
    });

    return attachedCount;
  }


  const SCRAPERS = {

    claude() {
      const claudeTitle = () =>
        document.title.replace(/[-–|]?\s*Claude.*$/i, '').trim() || 'Claude Conversation';

      const userSelectors = [
        '[data-testid="user-message"]',
        '[data-testid="human-turn"]',
        '[data-is-human="true"]',
        '.font-user-message',
        '[class*="UserMessage"]',
        '[class*="human-turn"]',
        '[class*="human_turn"]',
        '[class*="user_message"]',
        '[class*="user-message"]'
      ].join(', ');

      const assistantSelectors = [
        '[data-testid="assistant-message"]',
        '[data-testid="assistant-turn"]',
        '[data-is-human="false"]',
        '.font-claude-message',
        '[class*="ClaudeMessage"]',
        '[class*="assistant-message"]',
        '[class*="assistant-turn"]',
        '[class*="assistant_turn"]',
        '[class*="claude_message"]',
        '[class*="claude-message"]',
        '[class*="ai-message"]',
        '[class*="ai_message"]',
        '[class*="bot-message"]',
        '[class*="bot_message"]',
        '.prose',
        '[class*="prose"]',
        '[class*="markdown"]'
      ].join(', ');

      // ── Strategy 1: LCA-based turn extractor (most robust) ──
      const lcaMsgs = extractConversationViaLCA(
        userSelectors,
        assistantSelectors,
        'button[data-testid="action-bar-copy"], button[aria-label*="Copy" i], [class*="action-bar"] button'
      );
      if (lcaMsgs && hasBothRoles(lcaMsgs)) {
        return { messages: deduplicate(lcaMsgs), title: claudeTitle() };
      }

      const humanEls = [...document.querySelectorAll(userSelectors)].filter(filterInputArea);
      let assistantEls = [...document.querySelectorAll(assistantSelectors)].filter(filterInputArea);

      // Exclude assistant elements that are actually inside user elements
      assistantEls = assistantEls.filter(el => !humanEls.some(userEl => userEl.contains(el)));

      // ── Strategy 2: Interleaved selection using broad user & assistant selectors ──
      if (humanEls.length > 0 && assistantEls.length > 0) {
        const msgs = interleaveByDomOrder(humanEls, assistantEls, getInnerText);
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: claudeTitle() };
        }
      }

      // ── Strategy 3: Next-sibling anchor approach (if Strategy 2 has missing roles) ──
      const humanTurns = humanEls;
      if (humanTurns.length > 0) {
        const msgs = [];
        humanTurns.forEach(humanEl => {
          const userText = getInnerText(humanEl);
          if (userText.length > 0) msgs.push({ role: 'user', content: userText, element: humanEl });

          let cursor = humanEl;
          let assistantText = '';

          for (let depth = 0; depth < 8 && !assistantText; depth++) {
            let sibling = cursor.nextElementSibling;
            while (sibling && !assistantText) {
              const containsHumanTurn =
                sibling.getAttribute('data-testid') === 'human-turn' ||
                sibling.querySelector('[data-testid="human-turn"]') !== null ||
                sibling.matches(userSelectors) ||
                sibling.querySelector(userSelectors) !== null;
              
              if (containsHumanTurn) break;

              const innerContent = sibling.querySelector(
                '.prose, [class*="prose"], [class*="markdown"], ' +
                '[class*="message-content"], [class*="response-content"], ' +
                '[class*="claude-message"], [class*="assistant"]'
              );
              const text = getInnerText(innerContent || sibling);

              if (text.length > 20) {
                assistantText = text;
              } else {
                sibling = sibling.nextElementSibling;
              }
            }

            cursor = cursor.parentElement;
            if (!cursor || cursor === document.body) break;
          }

          if (assistantText.length > 0) {
            msgs.push({ role: 'assistant', content: assistantText, element: cursor || humanEl });
          }
        });

        if (msgs.length > 0 && hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: claudeTitle() };
        }
      }

      // ── Strategy 4: Alternating fallback ──
      const fallback = universalFallback(
        '[class*="prose"] > p, [class*="prose"] > ul, [class*="prose"] > ol, ' +
        '[class*="prose"] > pre, [class*="prose"] > blockquote',
        10
      );
      return { messages: deduplicate(fallback), title: claudeTitle() };
    },

    chatgpt() {
      const chatTitle = () =>
        document.title.replace(/[-–|]?\s*ChatGPT.*$/i, '').trim() || 'ChatGPT Conversation';

      // ── Strategy 1: Direct data-message-author-role attribute (most reliable) ──
      // ChatGPT tags every message container with data-message-author-role="user"|"assistant".
      // This is the MOST accurate approach — read the role straight from the attribute.
      const roleEls = [...document.querySelectorAll('[data-message-author-role]')].filter(filterInputArea);
      if (roleEls.length > 0) {
        const msgs = roleEls.map(el => {
          const role = el.getAttribute('data-message-author-role');
          // Only accept 'user' or 'assistant' roles — skip system/tool messages
          if (role !== 'user' && role !== 'assistant') return null;
          // Prefer the inner prose/markdown div for cleaner text; fall back to the whole element
          const inner = el.querySelector('.markdown, .whitespace-pre-wrap, [class*="prose"]') || el;
          return { role, content: getInnerText(inner), element: el };
        }).filter(m => m && m.content.length > 3);
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: chatTitle() };
        }
      }

      // ── Strategy 2: article elements with embedded role attribute ──
      // Each ChatGPT message turn is wrapped in an <article>. Find the role indicator inside.
      const articles = [...document.querySelectorAll('article[data-testid*="conversation-turn"]')].filter(filterInputArea);
      if (articles.length > 0) {
        const msgs = articles.flatMap(art => {
          const roleEl = art.querySelector('[data-message-author-role]');
          if (!roleEl) return [];
          const role = roleEl.getAttribute('data-message-author-role');
          if (role !== 'user' && role !== 'assistant') return [];
          // For user messages, read the text from the role element itself
          // For assistant messages, prefer the markdown container for cleaner output
          let textEl = roleEl;
          if (role === 'assistant') {
            textEl = art.querySelector('.markdown, .whitespace-pre-wrap, [class*="prose"]') || roleEl;
          }
          const content = getInnerText(textEl);
          return content.length > 3 ? [{ role, content, element: art }] : [];
        });
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: chatTitle() };
        }
      }

      // ── Strategy 3: Broader article fallback (no data-testid filter) ──
      const allArticles = [...document.querySelectorAll('article')].filter(filterInputArea);
      if (allArticles.length > 0) {
        const msgs = allArticles.flatMap(art => {
          const roleEl = art.querySelector('[data-message-author-role]');
          if (!roleEl) return [];
          const role = roleEl.getAttribute('data-message-author-role');
          if (role !== 'user' && role !== 'assistant') return [];
          const inner = (role === 'assistant')
            ? (art.querySelector('.markdown, .whitespace-pre-wrap, [class*="prose"]') || art)
            : art;
          const content = getInnerText(inner);
          return content.length > 5 ? [{ role, content, element: art }] : [];
        });
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: chatTitle() };
        }
      }

      // ── Strategy 4: LCA-based turn extractor (fallback for changed DOM) ──
      const lcaMsgs = extractConversationViaLCA(
        '[data-message-author-role="user"]',
        '[data-message-author-role="assistant"]',
        'button[aria-label*="Copy" i], button[data-testid*="copy" i]'
      );
      if (lcaMsgs && hasBothRoles(lcaMsgs)) {
        return { messages: deduplicate(lcaMsgs), title: chatTitle() };
      }

      // ── Strategy 5: Alternating fallback ──
      return { messages: deduplicate(universalFallback('main > div > div > div', 20)), title: chatTitle() };
    },

    gemini() {
      const gemTitle = () =>
        document.title.replace(/[-–|]?\s*Gemini.*$/i, '').trim() || 'Gemini Conversation';

      // ── Strategy 1: LCA-based turn extractor ──
      const lcaMsgs = extractConversationViaLCA(
        'user-query, [class*="user-query"]',
        'model-response, [class*="model-response"], [class*="response-container"]',
        'button[aria-label*="Copy" i], button[mattooltip*="Copy" i], [class*="copy"] button'
      );
      if (lcaMsgs && hasBothRoles(lcaMsgs)) {
        return { messages: deduplicate(lcaMsgs), title: gemTitle() };
      }

      // ── Strategy 2: custom element tags <user-query> / <model-response> ──
      const userEls  = [...document.querySelectorAll('user-query')].filter(filterInputArea);
      const modelEls = [...document.querySelectorAll('model-response')].filter(filterInputArea);
      if (userEls.length > 0 && modelEls.length > 0) {
        const msgs = interleaveByDomOrder(userEls, modelEls, getInnerText);
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: gemTitle() };
        }
      }

      // ── Strategy 3: class-name selectors ──
      const userByClass  = [...document.querySelectorAll('[class*="user-query"], [class*="UserQuery"]')].filter(filterInputArea);
      const modelByClass = [...document.querySelectorAll(
        '[class*="model-response"], [class*="ModelResponse"], [class*="response-container"]'
      )].filter(filterInputArea);
      if (userByClass.length > 0 && modelByClass.length > 0) {
        const msgs = interleaveByDomOrder(userByClass, modelByClass, getInnerText);
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: gemTitle() };
        }
      }

      // ── Strategy 4: Alternating container fallback ──
      return {
        messages: deduplicate(universalFallback('chat-window > div, [class*="conversation"] > div', 15)),
        title: gemTitle()
      };
    },

    grok() {
      const grokTitle = () =>
        document.title.replace(/[-–|]?\s*Grok.*$/i, '').trim() || 'Grok Conversation';

      // ── Strategy 1: LCA-based turn extractor ──
      const lcaMsgs = extractConversationViaLCA(
        '[data-role="user"], [data-message-role="user"], [class*="UserMessage"]',
        '[data-role="assistant"], [data-message-role="assistant"], [class*="BotMessage"], [class*="AiMessage"]',
        'button[aria-label*="Copy" i], [class*="copy"] button'
      );
      if (lcaMsgs && hasBothRoles(lcaMsgs)) {
        return { messages: deduplicate(lcaMsgs), title: grokTitle() };
      }

      // ── Strategy 2: data-role / data-message-role attribute ──
      const roleEls = [...document.querySelectorAll('[data-role], [data-message-role]')].filter(filterInputArea);
      if (roleEls.length > 0) {
        const msgs = roleEls.map(el => ({
          role: (el.getAttribute('data-role') || el.getAttribute('data-message-role')) === 'user' ? 'user' : 'assistant',
          content: getInnerText(el),
          element: el
        })).filter(m => m.content.length > 5);
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: grokTitle() };
        }
      }

      // ── Strategy 3: class-name user vs AI containers ──
      const userBlocks = [...document.querySelectorAll(
        '[class*="UserMessage"], [class*="user-message"], [class*="HumanMessage"], [class*="human-message"]'
      )].filter(filterInputArea);
      const aiBlocks = [...document.querySelectorAll(
        '[class*="BotMessage"], [class*="bot-message"], [class*="AiMessage"], [class*="ai-message"], ' +
        '[class*="AssistantMessage"], [class*="assistant-message"], [class*="GrokMessage"], [class*="grok-message"]'
      )].filter(filterInputArea);
      if (userBlocks.length > 0 && aiBlocks.length > 0) {
        const msgs = interleaveByDomOrder(userBlocks, aiBlocks, getInnerText);
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: grokTitle() };
        }
      }

      // ── Strategy 4: Alternating fallback ──
      return {
        messages: deduplicate(universalFallback('[class*="message"], [class*="Message"]', 10)),
        title: grokTitle()
      };
    },

    perplexity() {
      const pxTitle = () =>
        document.title.replace(/[-–|]?\s*Perplexity.*$/i, '').trim() || 'Perplexity Conversation';

      // ── Strategy 1: LCA-based turn extractor ──
      const lcaMsgs = extractConversationViaLCA(
        '[data-testid="query"], [class*="query"], h2, h3',
        '[class*="prose"], [class*="answer"], [class*="markdown"]',
        'button[aria-label*="Copy" i], [class*="copy"] button'
      );
      if (lcaMsgs && hasBothRoles(lcaMsgs)) {
        return { messages: deduplicate(lcaMsgs), title: pxTitle() };
      }

      // ── Strategy 2: Thread-item containers with query + answer inside ──
      const threadItems = [...document.querySelectorAll(
        '[class*="ThreadItem"], [class*="thread-item"], [class*="AnswerItem"], [class*="answer-item"]'
      )].filter(filterInputArea);
      if (threadItems.length > 0) {
        const msgs = [];
        threadItems.forEach(item => {
          const q = item.querySelector('[class*="query"], [class*="Query"], h2, h3');
          const a = item.querySelector('[class*="prose"], [class*="answer"], [class*="markdown"]');
          if (q) { const t = getInnerText(q); if (t.length > 3) msgs.push({ role: 'user', content: t, element: q }); }
          if (a) { const t = getInnerText(a); if (t.length > 3) msgs.push({ role: 'assistant', content: t, element: a }); }
        });
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: pxTitle() };
        }
      }

      // ── Strategy 3: Separate query/answer element lists, sorted by DOM order ──
      const queryEls  = [...document.querySelectorAll('[data-testid*="query"], [class*="query"]:not([class*="answer"])')].filter(filterInputArea);
      const answerEls = [...document.querySelectorAll('.prose, [class*="answer"]:not([class*="query"])')].filter(filterInputArea);
      if (queryEls.length > 0 || answerEls.length > 0) {
        const msgs = interleaveByDomOrder(queryEls, answerEls, getInnerText);
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: pxTitle() };
        }
      }

      // ── Strategy 4: section alternating fallback ──
      return {
        messages: deduplicate(universalFallback('section, [class*="section"]', 20)),
        title: pxTitle()
      };
    },
  };

  // ════════════════════════════════════════════
  // INJECTORS — one per platform
  // ════════════════════════════════════════════

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function setNativeValue(el, value) {
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) { setter.call(el, value); return; }
    }
    el.value = value;
  }

  function dispatchInputEvents(el) {
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function insertTextProgrammatically(el, text) {
    try {
      el.click();
    } catch (_) {}
    el.focus();
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    // Let rich text frameworks (like Lexical, Draft.js, ProseMirror) intercept the input
    try {
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: text,
        bubbles: true,
        cancelable: true
      }));
    } catch (_) {}

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      el.select();
      const success = document.execCommand('insertText', false, text);
      if (!success || el.value !== text) {
        setNativeValue(el, text);
        dispatchInputEvents(el);
      }
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('selectAll', false, null);
      const success = document.execCommand('insertText', false, text);
      if (!success || !el.textContent.trim()) {
        el.innerText = text;
        dispatchInputEvents(el);
      }
    }

    // Trigger post-input react state bindings
    try {
      el.dispatchEvent(new InputEvent('input', {
        inputType: 'insertText',
        data: text,
        bubbles: true
      }));
    } catch (_) {}
  }

  function trySubmit(inputEl, submitSelectors) {
    const btn = document.querySelector(submitSelectors);
    const isDisabled = btn && (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('disabled'));
    if (btn && !isDisabled) {
      btn.click();
    } else {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
    }
  }

  async function waitForElement(selectors, maxRetries = 15, interval = 700) {
    for (let i = 0; i < maxRetries; i++) {
      const el = document.querySelector(selectors);
      if (el) return el;
      await sleep(interval);
    }
    return null;
  }

  const INJECTORS = {

    async claude(prompt) {
      const el = await waitForElement(
        'div.ProseMirror[contenteditable="true"], [contenteditable="true"][data-placeholder], [data-testid="compose-input"] [contenteditable], [contenteditable="true"], textarea'
      );
      if (!el) return { success: false, error: 'Claude input not found' };
      insertTextProgrammatically(el, prompt);
      await sleep(1500);
      trySubmit(el, 'button[aria-label*="Send"], button[data-testid*="send"], button[aria-label="Send Message"], button[class*="send"]');
      return { success: true };
    },

    async chatgpt(prompt) {
      const el = await waitForElement(
        '#prompt-textarea, div[contenteditable="true"].ProseMirror, textarea[placeholder], [contenteditable="true"]'
      );
      if (!el) return { success: false, error: 'ChatGPT input not found' };
      insertTextProgrammatically(el, prompt);
      await sleep(1500);
      trySubmit(el, '[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="Send prompt"], button[data-testid*="send"], button[class*="send"]');
      return { success: true };
    },

    async gemini(prompt) {
      const el = await waitForElement(
        'rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"], div[contenteditable="true"][data-placeholder], [contenteditable="true"]'
      );
      if (!el) return { success: false, error: 'Gemini input not found' };
      insertTextProgrammatically(el, prompt);
      await sleep(1500);
      trySubmit(el, 'button.send-button, button[aria-label*="Send"], button[mattooltip*="Send"], button[class*="send"]');
      return { success: true };
    },

    async grok(prompt) {
      const el = await waitForElement(
        'textarea[placeholder*="Ask"], textarea[placeholder*="Grok"], textarea[class*="input"], [contenteditable="true"], textarea'
      );
      if (!el) return { success: false, error: 'Grok input not found' };
      insertTextProgrammatically(el, prompt);
      await sleep(1500);
      trySubmit(el, 'button[aria-label*="Send"], button[type="submit"], button[data-testid*="send"], button[class*="send"]');
      return { success: true };
    },

    async perplexity(prompt) {
      const el = await waitForElement(
        'textarea[placeholder*="Ask"], textarea[placeholder*="Search"], textarea[class*="textarea"], textarea, [contenteditable="true"]'
      );
      if (!el) return { success: false, error: 'Perplexity input not found' };
      insertTextProgrammatically(el, prompt);
      await sleep(1500);
      trySubmit(el, 'button[aria-label*="Submit"], button[type="submit"], button[class*="send"]');
      return { success: true };
    },
  };

  function runScrapeAnimation() {
    let host = document.getElementById('__cross-context-host');
    if (host) {
      try { host.remove(); } catch(_) {}
    }

    host = document.createElement('div');
    host.id = '__cross-context-host';
    host.style.cssText = `
      all: initial !important;
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      display: block !important;
      box-sizing: border-box !important;
    `;
    document.documentElement.appendChild(host);
    
    const shadow = host.attachShadow({ mode: 'open' });
    
    // Resolve platform colors dynamically
    const colors = PLATFORM_COLORS[platform] || { primary: '#3b82f6', glow: 'rgba(59, 130, 246, 0.25)', bg: 'rgba(59, 130, 246, 0.05)' };

    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');

      :host {
        --primary: ${colors.primary};
        --primary-glow: ${colors.glow};
        --primary-bg: ${colors.bg};
      }

      .halo-container {
        all: initial !important;
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        z-index: 2147483647 !important;
        pointer-events: auto !important;
        box-sizing: border-box !important;
        opacity: 0 !important;
        background-color: rgba(6, 8, 12, 0.4) !important;
        backdrop-filter: blur(0px) !important;
        -webkit-backdrop-filter: blur(0px) !important;
        transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                    backdrop-filter 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                    -webkit-backdrop-filter 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
        will-change: opacity, backdrop-filter !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      
      .halo-container.agent-active {
        opacity: 1 !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
      }

      .halo-container::before {
        content: '' !important;
        position: absolute !important;
        inset: 0 !important;
        box-sizing: border-box !important;
        pointer-events: none !important;
        box-shadow: 
          inset 0 0 40px rgba(0, 0, 0, 0.6),
          inset 0 0 100px var(--primary-glow) !important;
        opacity: 0 !important;
        transition: opacity 0.6s ease !important;
        will-change: opacity !important;
      }

      .halo-container.agent-active::before {
        opacity: 0.6 !important;
        animation: cc-glow-pulse 4s infinite cubic-bezier(0.4, 0, 0.2, 1) !important;
      }

      .console-card {
        background: linear-gradient(135deg, rgba(13, 16, 26, 0.78) 0%, rgba(8, 10, 16, 0.88) 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 20px !important;
        padding: 24px !important;
        width: 380px !important;
        box-shadow: 
          0 25px 60px rgba(0, 0, 0, 0.65),
          0 0 40px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        color: #f1f5f9 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 20px !important;
        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;
        transform: scale(0.95) translateY(10px) !important;
        opacity: 0 !important;
        transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1),
                    opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
        box-sizing: border-box !important;
      }

      .halo-container.agent-active .console-card {
        transform: scale(1) translateY(0) !important;
        opacity: 1 !important;
      }

      .console-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
        padding-bottom: 16px !important;
        box-sizing: border-box !important;
      }

      .brand-wrapper {
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
      }

      .brand-icon-container {
        width: 32px !important;
        height: 32px !important;
        border-radius: 8px !important;
        background: rgba(255, 255, 255, 0.03) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        color: var(--primary) !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
        flex-shrink: 0 !important;
      }

      .brand-icon-container svg {
        width: 18px !important;
        height: 18px !important;
      }

      .title-stack {
        display: flex !important;
        flex-direction: column !important;
      }

      .console-title {
        font-size: 13.5px !important;
        font-weight: 700 !important;
        color: #f8fafc !important;
        letter-spacing: 0.5px !important;
        text-transform: uppercase !important;
        line-height: 1.2 !important;
      }

      .console-subtitle {
        font-size: 8.5px !important;
        font-weight: 600 !important;
        color: #64748b !important;
        letter-spacing: 1px !important;
        text-transform: uppercase !important;
        font-family: 'JetBrains Mono', monospace !important;
        margin-top: 3px !important;
      }

      .status-badge {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        background: var(--primary-bg) !important;
        border: 1px solid rgba(255, 255, 255, 0.06) !important;
        padding: 4px 10px !important;
        border-radius: 20px !important;
        color: var(--primary) !important;
        font-size: 9px !important;
        font-weight: 700 !important;
        letter-spacing: 0.5px !important;
        text-transform: uppercase !important;
        box-sizing: border-box !important;
        transition: all 0.3s ease !important;
      }

      .status-badge.completed {
        background: rgba(52, 211, 153, 0.08) !important;
        color: #34d399 !important;
        border-color: rgba(52, 211, 153, 0.2) !important;
      }

      .status-badge.failed {
        background: rgba(239, 68, 68, 0.08) !important;
        color: #f87171 !important;
        border-color: rgba(239, 68, 68, 0.2) !important;
      }

      .badge-dot {
        width: 6px !important;
        height: 6px !important;
        background-color: currentColor !important;
        border-radius: 50% !important;
        box-shadow: 0 0 8px currentColor !important;
        transition: all 0.3s ease !important;
      }
      
      .status-badge:not(.completed):not(.failed) .badge-dot {
        animation: cc-dot-pulse 1.2s infinite alternate ease-in-out !important;
      }

      .console-body {
        display: flex !important;
        flex-direction: column !important;
        gap: 4px !important;
        box-sizing: border-box !important;
        position: relative !important;
      }

      /* Vertical Timeline Line */
      .steps-container {
        position: relative !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
        box-sizing: border-box !important;
      }

      .steps-container::before {
        content: '' !important;
        position: absolute !important;
        left: 9px !important;
        top: 14px !important;
        bottom: 14px !important;
        width: 1.5px !important;
        background: linear-gradient(to bottom, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05)) !important;
        z-index: 1 !important;
      }

      .step-item {
        display: flex !important;
        align-items: center !important;
        gap: 14px !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        opacity: 0.35 !important;
        color: #94a3b8 !important;
        transition: opacity 0.3s ease, color 0.3s ease !important;
        box-sizing: border-box !important;
        position: relative !important;
        z-index: 2 !important;
        padding: 4px 0 !important;
      }

      .step-item.active {
        opacity: 1 !important;
        color: #e2e8f0 !important;
      }

      .step-item.completed {
        opacity: 0.8 !important;
        color: #94a3b8 !important;
      }

      .step-icon {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 20px !important;
        height: 20px !important;
        flex-shrink: 0 !important;
        position: relative !important;
      }

      .step-text {
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif !important;
        font-weight: 500 !important;
      }

      /* Step Icon Shapes */
      .dot {
        width: 6px !important;
        height: 6px !important;
        background-color: rgba(255, 255, 255, 0.2) !important;
        border-radius: 50% !important;
        transition: all 0.3s ease !important;
      }

      .spinner {
        width: 12px !important;
        height: 12px !important;
        border: 2px solid rgba(255, 255, 255, 0.05) !important;
        border-top: 2px solid var(--primary) !important;
        border-radius: 50% !important;
        animation: cc-spin 0.6s linear infinite !important;
      }

      .check-circle {
        width: 20px !important;
        height: 20px !important;
        border-radius: 50% !important;
        background: rgba(52, 211, 153, 0.1) !important;
        border: 1px solid rgba(52, 211, 153, 0.2) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        animation: cc-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards !important;
      }

      .cross-circle {
        width: 20px !important;
        height: 20px !important;
        border-radius: 50% !important;
        background: rgba(239, 68, 68, 0.1) !important;
        border: 1px solid rgba(239, 68, 68, 0.2) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        animation: cc-shake 0.4s ease-in-out forwards !important;
      }

      @keyframes cc-pop {
        0% { transform: scale(0.6); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }

      @keyframes cc-shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-2px); }
        40%, 80% { transform: translateX(2px); }
      }

      @keyframes cc-glow-pulse {
        0%, 100% { opacity: 0.3 !important; }
        50% { opacity: 0.6 !important; }
      }

      @keyframes cc-dot-pulse {
        from { opacity: 0.4 !important; transform: scale(0.85) !important; }
        to { opacity: 1 !important; transform: scale(1.15) !important; }
      }

      @keyframes cc-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'halo-container';
    
    const consoleCard = document.createElement('div');
    consoleCard.className = 'console-card';
    
    const header = document.createElement('div');
    header.className = 'console-header';
    
    const brandWrapper = document.createElement('div');
    brandWrapper.className = 'brand-wrapper';
    
    const brandIconContainer = document.createElement('div');
    brandIconContainer.className = 'brand-icon-container';
    brandIconContainer.innerHTML = getDropOverlayIcon(platform);
    
    const titleStack = document.createElement('div');
    titleStack.className = 'title-stack';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'console-title';
    titleDiv.textContent = 'CROSS CONTEXT';
    
    const subtitleDiv = document.createElement('div');
    subtitleDiv.className = 'console-subtitle';
    subtitleDiv.textContent = 'Extraction Pipeline';
    
    titleStack.appendChild(titleDiv);
    titleStack.appendChild(subtitleDiv);
    
    brandWrapper.appendChild(brandIconContainer);
    brandWrapper.appendChild(titleStack);
    
    const badge = document.createElement('div');
    badge.className = 'status-badge';
    
    const dot = document.createElement('div');
    dot.className = 'badge-dot';
    
    const label = document.createElement('span');
    label.textContent = 'ACTIVE';
    
    badge.appendChild(dot);
    badge.appendChild(label);
    
    header.appendChild(brandWrapper);
    header.appendChild(badge);
    
    const body = document.createElement('div');
    body.className = 'console-body';
    
    const stepsContainer = document.createElement('div');
    stepsContainer.className = 'steps-container';
    
    const steps = [
      'Detecting active platform...',
      'Locating message containers...',
      'Scraping conversation turns...',
      'Formatting context payload...',
      'Context scraped successfully!'
    ];
    
    steps.forEach((stepText, idx) => {
      const stepDiv = document.createElement('div');
      stepDiv.className = 'step-item';
      stepDiv.id = `cc-step-${idx}`;
      
      const iconDiv = document.createElement('div');
      iconDiv.className = 'step-icon';
      
      const textSpan = document.createElement('span');
      textSpan.className = 'step-text';
      textSpan.textContent = stepText;
      
      stepDiv.appendChild(iconDiv);
      stepDiv.appendChild(textSpan);
      stepsContainer.appendChild(stepDiv);
    });
    
    body.appendChild(stepsContainer);
    consoleCard.appendChild(header);
    consoleCard.appendChild(body);
    container.appendChild(consoleCard);
    shadow.appendChild(container);

    function setStepState(index, state) {
      const stepEl = shadow.getElementById(`cc-step-${index}`);
      if (!stepEl) return;
      
      const iconContainer = stepEl.querySelector('.step-icon');
      if (!iconContainer) return;
      
      stepEl.classList.remove('active', 'completed');
      
      if (state === 'pending') {
        iconContainer.innerHTML = '<div class="dot"></div>';
      } else if (state === 'active') {
        stepEl.classList.add('active');
        iconContainer.innerHTML = '<div class="spinner"></div>';
      } else if (state === 'completed') {
        stepEl.classList.add('completed');
        iconContainer.innerHTML = `
          <div class="check-circle">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        `;
      }
    }

    // Set initial states
    setStepState(0, 'active');
    setStepState(1, 'pending');
    setStepState(2, 'pending');
    setStepState(3, 'pending');
    setStepState(4, 'pending');

    // Trigger state change via CSS transition class
    requestAnimationFrame(() => {
      container.classList.add('agent-active');
    });

    let isFinished = false;
    let timeouts = [];

    // Step transitions sequence
    timeouts.push(setTimeout(() => {
      if (isFinished) return;
      setStepState(0, 'completed');
      setStepState(1, 'active');
    }, 450));
    
    timeouts.push(setTimeout(() => {
      if (isFinished) return;
      setStepState(1, 'completed');
      setStepState(2, 'active');
    }, 900));
    
    timeouts.push(setTimeout(() => {
      if (isFinished) return;
      setStepState(2, 'completed');
      setStepState(3, 'active');
    }, 1450));

    function cleanup() {
      container.classList.remove('agent-active');
      setTimeout(() => {
        if (host.parentNode) {
          host.remove();
        }
      }, 350);
    }

    return {
      success: () => {
        isFinished = true;
        timeouts.forEach(clearTimeout);
        
        badge.className = 'status-badge completed';
        label.textContent = 'COMPLETED';

        // Set all to completed
        setStepState(0, 'completed');
        setStepState(1, 'completed');
        setStepState(2, 'completed');
        setStepState(3, 'completed');
        setStepState(4, 'completed');
        setTimeout(cleanup, 600);
      },
      fail: (errorMsg) => {
        isFinished = true;
        timeouts.forEach(clearTimeout);
        
        badge.className = 'status-badge failed';
        label.textContent = 'FAILED';
        
        // Find first step that isn't completed and mark as failed
        for (let i = 0; i < 5; i++) {
          const stepEl = shadow.getElementById(`cc-step-${i}`);
          if (stepEl && !stepEl.classList.contains('completed')) {
            stepEl.classList.add('active');
            stepEl.style.color = '#ef4444';
            const icon = stepEl.querySelector('.step-icon');
            if (icon) {
              icon.innerHTML = `
                <div class="cross-circle">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </div>
              `;
            }
            const text = stepEl.querySelector('.step-text');
            if (text) {
              text.textContent = `${text.textContent.replace('...', '')} failed: ${errorMsg}`;
            }
            break;
          }
        }
        setTimeout(cleanup, 2500);
      }
    };
  }

  // ════════════════════════════════════════════
  // FORMATTER — inline (no import needed)
  // ════════════════════════════════════════════

  const PLATFORM_NAMES = {
    claude:     'Claude (Anthropic)',
    chatgpt:    'ChatGPT (OpenAI)',
    gemini:     'Gemini (Google)',
    grok:       'Grok (xAI)',
    perplexity: 'Perplexity AI',
  };

  function formatContextPrompt(context, targetPlatform) {
    if (context.aiEnhanced && context.aiStatus === 'success') {
      const src = PLATFORM_NAMES[context.platform] || context.platform;
      const summary = context.aiEnhanced.summary || '';
      const keyPoints = Array.isArray(context.aiEnhanced.keyPoints)
        ? context.aiEnhanced.keyPoints.map(pt => `• ${pt}`).join('\n')
        : '';
      const visual = context.aiEnhanced.visualAnalysis ? `\n🎨 Visuals/Diagrams/Layout Analysis:\n${context.aiEnhanced.visualAnalysis}\n` : '';
      const handoff = context.aiEnhanced.handoffPrompt || '';

      return `[🔄 AI-Enhanced Cross Context Transfer]
You are continuing a conversation that was started on ${src}.
The conversation history has been processed, verified, and summarized by Gemini AI.

📋 AI Synthesized Summary:
${summary}

🔑 Key Technical Points:
${keyPoints}
${visual}
${'═'.repeat(60)}
🚀 Optimized Handoff Prompt & Instructions:
${handoff}`;
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

  // ════════════════════════════════════════════
  // PAGE-LEVEL DRAG & DROP — drop context onto this LLM page
  // ════════════════════════════════════════════

  let dropOverlayHost = null;
  let dropOverlayShadow = null;
  let dragEnterCount = 0; // counter to handle child dragenter/dragleave

  const PLATFORM_COLORS = {
    claude:     { primary: '#d97752', glow: 'rgba(217, 119, 82, 0.35)', bg: 'rgba(217, 119, 82, 0.06)' },
    chatgpt:    { primary: '#10b981', glow: 'rgba(16, 185, 129, 0.35)',  bg: 'rgba(16, 185, 129, 0.06)' },
    gemini:     { primary: '#3b82f6', glow: 'rgba(59, 130, 246, 0.35)',  bg: 'rgba(59, 130, 246, 0.06)' },
    grok:       { primary: '#f4f4f5', glow: 'rgba(244, 244, 245, 0.25)', bg: 'rgba(244, 244, 245, 0.04)' },
    perplexity: { primary: '#0ea5e9', glow: 'rgba(14, 165, 233, 0.35)',  bg: 'rgba(14, 165, 233, 0.06)' },
  };

  // Platform icon SVGs (small)
  function getDropOverlayIcon(platformKey) {
    const icons = {
      claude: `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/></svg>`,
      chatgpt: `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"/></svg>`,
      gemini: `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"/></svg>`,
      grok: `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"/></svg>`,
      perplexity: `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M19.785 0v7.272H22.5V17.62h-2.935V24l-7.037-6.194v6.145h-1.091v-6.152L4.392 24v-6.465H1.5V7.188h2.884V0l7.053 6.494V.19h1.09v6.49L19.786 0zm-7.257 9.044v7.319l5.946 5.234V14.44l-5.946-5.397zm-1.099-.08l-5.946 5.398v7.235l5.946-5.234V8.965zm8.136 7.58h1.844V8.349H13.46l6.105 5.54v2.655zm-8.982-8.28H2.59v8.195h1.8v-2.576l6.192-5.62zM5.475 2.476v4.71h5.115l-5.115-4.71zm13.219 0l-5.115 4.71h5.115v-4.71z"/></svg>`,
    };
    return icons[platformKey] || `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  }

  function createDropOverlay(srcPlatform) {
    // Remove existing overlay
    removeDropOverlay();

    const colors = PLATFORM_COLORS[srcPlatform] || { primary: '#3b82f6', glow: 'rgba(59, 130, 246, 0.25)', bg: 'rgba(59, 130, 246, 0.05)' };
    const currentColors = PLATFORM_COLORS[platform] || { primary: '#3b82f6', glow: 'rgba(59, 130, 246, 0.25)', bg: 'rgba(59, 130, 246, 0.05)' };

    dropOverlayHost = document.createElement('div');
    dropOverlayHost.id = '__cross-context-drop-host';
    dropOverlayHost.style.cssText = `
      all: initial !important;
      position: fixed !important;
      top: 0 !important; left: 0 !important;
      width: 100vw !important; height: 100vh !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      display: block !important;
    `;
    document.documentElement.appendChild(dropOverlayHost);

    dropOverlayShadow = dropOverlayHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }

      .drop-overlay {
        position: fixed !important;
        inset: 0 !important;
        background: rgba(8, 10, 16, 0) !important;
        backdrop-filter: blur(0px) !important;
        -webkit-backdrop-filter: blur(0px) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        opacity: 0 !important;
        transition: opacity 0.3s ease, backdrop-filter 0.3s ease, -webkit-backdrop-filter 0.3s ease !important;
        pointer-events: none !important;
        box-sizing: border-box !important;
      }

      .drop-overlay::before {
        content: '' !important;
        position: absolute !important;
        inset: 20px !important;
        border: 1.5px dashed ${colors.primary}30 !important;
        border-radius: 20px !important;
        pointer-events: none !important;
        opacity: 0 !important;
        transition: opacity 0.3s ease, transform 0.3s ease, border-color 0.3s ease !important;
        transform: scale(0.98) !important;
        box-sizing: border-box !important;
        z-index: 1 !important;
      }

      .drop-overlay.visible {
        opacity: 1 !important;
        background: rgba(8, 10, 16, 0.65) !important;
        backdrop-filter: blur(10px) !important;
        -webkit-backdrop-filter: blur(10px) !important;
        box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.8),
                    inset 0 0 40px ${colors.primary}10 !important;
      }

      .drop-overlay.visible::before {
        opacity: 1 !important;
        transform: scale(1) !important;
      }

      .drop-overlay.over {
        background: rgba(8, 10, 16, 0.72) !important;
        box-shadow: inset 0 0 120px rgba(0, 0, 0, 0.9),
                    inset 0 0 60px ${currentColors.primary}18 !important;
      }

      .drop-overlay.over::before {
        border-color: ${currentColors.primary}50 !important;
        border-style: solid !important;
        box-shadow: 0 0 30px ${currentColors.primary}10 !important;
        transform: scale(0.99) !important;
      }

      .drop-card {
        background: rgba(15, 18, 28, 0.85) !important;
        border: 1px solid ${colors.primary}25 !important;
        border-radius: 24px !important;
        padding: 36px 40px !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        gap: 20px !important;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6),
                    0 0 50px ${colors.primary}10 !important;
        transform: scale(0.95) translateY(10px) !important;
        transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                    border-color 0.3s ease,
                    box-shadow 0.3s ease !important;
        pointer-events: none !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;
        text-align: center !important;
        width: 320px !important;
        box-sizing: border-box !important;
        z-index: 2 !important;
      }

      .drop-overlay.visible .drop-card {
        transform: scale(1) translateY(0) !important;
      }

      .drop-overlay.over .drop-card {
        transform: scale(1.03) !important;
        border-color: ${currentColors.primary}50 !important;
        box-shadow: 0 40px 100px rgba(0, 0, 0, 0.7),
                    0 0 60px ${currentColors.primary}20 !important;
      }

      .drop-flow {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 16px !important;
        width: 100% !important;
        margin-bottom: 8px !important;
        z-index: 2 !important;
      }

      .drop-flow-connector {
        flex: 1 !important;
        max-width: 60px !important;
        height: 3px !important;
        background: rgba(255, 255, 255, 0.08) !important;
        border-radius: 2px !important;
        position: relative !important;
        overflow: hidden !important;
        transition: background 0.3s ease !important;
      }

      .drop-flow-connector::after {
        content: '' !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        background: linear-gradient(90deg, transparent, ${colors.primary}, ${currentColors.primary}, transparent) !important;
        transform: translateX(-100%) !important;
        animation: flow-shimmer 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite !important;
      }

      @keyframes flow-shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }

      .drop-icon {
        width: 60px !important;
        height: 60px !important;
        border-radius: 16px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: ${colors.primary}10 !important;
        border: 1px solid ${colors.primary}30 !important;
        color: ${colors.primary} !important;
        flex-shrink: 0 !important;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15) !important;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }

      .drop-icon.source-icon {
        animation: icon-float-src 3s ease-in-out infinite !important;
      }

      .drop-icon.target-icon {
        background: ${currentColors.primary}10 !important;
        border-color: ${currentColors.primary}30 !important;
        color: ${currentColors.primary} !important;
        animation: icon-float-tgt 3s ease-in-out infinite alternate-reverse !important;
      }

      @keyframes icon-float-src {
        0%, 100% { transform: translateY(0) rotate(-1deg); }
        50%       { transform: translateY(-4px) rotate(1deg); }
      }

      @keyframes icon-float-tgt {
        0%, 100% { transform: translateY(0) rotate(1deg); }
        50%       { transform: translateY(-4px) rotate(-1deg); }
      }

      .drop-overlay.over .drop-icon.source-icon {
        animation: none !important;
        transform: scale(1.08) rotate(-3deg) !important;
        background: ${colors.primary}15 !important;
        border-color: ${colors.primary}50 !important;
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.25), 0 0 15px ${colors.primary}20 !important;
      }

      .drop-overlay.over .drop-icon.target-icon {
        animation: none !important;
        transform: scale(1.08) rotate(3deg) !important;
        background: ${currentColors.primary}15 !important;
        border-color: ${currentColors.primary}50 !important;
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.25), 0 0 15px ${currentColors.primary}20 !important;
      }

      .drop-title {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        font-size: 19px !important;
        font-weight: 600 !important;
        color: #ffffff !important;
        letter-spacing: -0.01em !important;
        margin: 0 !important;
        transition: color 0.3s ease !important;
      }

      .drop-subtitle {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        font-size: 13.5px !important;
        color: #94a3b8 !important;
        margin: 0 !important;
        line-height: 1.5 !important;
        transition: color 0.3s ease !important;
      }

      .drop-subtitle strong {
        color: ${colors.primary} !important;
        font-weight: 600 !important;
        transition: color 0.3s ease !important;
      }

      .drop-overlay.over .drop-subtitle strong {
        color: ${currentColors.primary} !important;
      }

      .drop-arrow {
        color: rgba(148, 163, 184, 0.4) !important;
        margin-top: 4px !important;
        animation: arrow-bounce-new 2s ease-in-out infinite !important;
        transition: color 0.3s ease !important;
      }

      @keyframes arrow-bounce-new {
        0%, 100% { transform: translateY(0); opacity: 0.3; }
        50%       { transform: translateY(5px);  opacity: 0.8; }
      }

      /* Injecting state */
      .drop-overlay.injecting .drop-card {
        transform: scale(1) !important;
        border-color: #3b82f640 !important;
        box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 50px rgba(59,130,246,0.15) !important;
      }

      .drop-overlay.injecting::before {
        border-color: #3b82f640 !important;
        border-style: dashed !important;
        animation: pulse-border 1.5s ease-in-out infinite !important;
      }

      @keyframes pulse-border {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 0.8; }
      }

      .drop-overlay.injecting .drop-flow-connector {
        background: rgba(59, 130, 246, 0.15) !important;
      }

      .drop-overlay.injecting .drop-flow-connector::after {
        background: linear-gradient(90deg, transparent, #3b82f6, #10b981, transparent) !important;
        animation: flow-shimmer 0.5s linear infinite !important;
      }

      .drop-overlay.injecting .drop-icon.source-icon {
        animation: none !important;
        background: rgba(59,130,246,0.08) !important;
        border-color: rgba(59,130,246,0.4) !important;
        color: #3b82f6 !important;
      }

      .drop-overlay.injecting .drop-icon.target-icon {
        animation: pulse-target 1s ease-in-out infinite alternate !important;
        border-color: #3b82f660 !important;
        box-shadow: 0 0 15px rgba(59, 130, 246, 0.3) !important;
      }

      @keyframes pulse-target {
        from { transform: scale(1); opacity: 0.7; }
        to { transform: scale(1.05); opacity: 1; }
      }

      /* Custom Material-style circular spinner */
      .cc-spinner {
        animation: cc-rotate 1.6s linear infinite !important;
        display: block !important;
        color: #3b82f6 !important;
      }

      .cc-spinner-path {
        stroke-dasharray: 125 !important;
        stroke-dashoffset: 125 !important;
        animation: cc-dash 1.6s ease-in-out infinite !important;
      }

      @keyframes cc-rotate {
        100% { transform: rotate(360deg) !important; }
      }

      @keyframes cc-dash {
        0% {
          stroke-dashoffset: 120 !important;
        }
        50% {
          stroke-dashoffset: 30 !important;
          transform: rotate(135deg) !important;
        }
        100% {
          stroke-dashoffset: 120 !important;
          transform: rotate(450deg) !important;
        }
      }

      .drop-overlay.injecting .drop-arrow {
        animation: none !important;
        margin-top: 8px !important;
      }

      .drop-overlay.success .drop-arrow {
        animation: success-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards !important;
        color: #10b981 !important;
        margin-top: 8px !important;
      }

      .drop-overlay.error-state .drop-arrow {
        animation: shake 0.4s ease-in-out !important;
        color: #ef4444 !important;
        margin-top: 8px !important;
      }

      .drop-overlay.injecting .drop-title { color: #3b82f6 !important; }

      /* Success state */
      .drop-overlay.success .drop-card {
        border-color: #10b98140 !important;
        box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 50px rgba(16,185,129,0.15) !important;
      }

      .drop-overlay.success::before {
        border-color: #10b98150 !important;
        border-style: solid !important;
      }

      .drop-overlay.success .drop-flow-connector {
        background: rgba(16, 185, 129, 0.2) !important;
      }

      .drop-overlay.success .drop-flow-connector::after {
        background: #10b981 !important;
        transform: translateX(0) !important;
        animation: none !important;
      }

      .drop-overlay.success .drop-icon.source-icon {
        animation: success-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards !important;
        background: rgba(16,185,129,0.1) !important;
        border-color: rgba(16,185,129,0.4) !important;
        color: #10b981 !important;
      }

      .drop-overlay.success .drop-icon.target-icon {
        animation: none !important;
        border-color: rgba(16, 185, 129, 0.4) !important;
        background: rgba(16, 185, 129, 0.1) !important;
        color: #10b981 !important;
      }

      @keyframes success-pop {
        0% { transform: scale(0.8); }
        100% { transform: scale(1.1); }
      }

      .drop-overlay.success .drop-title { color: #10b981 !important; }
      .drop-overlay.success .drop-subtitle strong { color: #10b981 !important; }

      /* Error state */
      .drop-overlay.error-state .drop-card {
        border-color: #ef444440 !important;
        box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 50px rgba(239,68,68,0.15) !important;
      }

      .drop-overlay.error-state::before {
        border-color: #ef444450 !important;
        border-style: solid !important;
      }

      .drop-overlay.error-state .drop-flow-connector {
        background: rgba(239, 68, 68, 0.2) !important;
      }

      .drop-overlay.error-state .drop-flow-connector::after {
        background: #ef4444 !important;
        transform: translateX(0) !important;
        animation: none !important;
      }

      .drop-overlay.error-state .drop-icon.source-icon {
        animation: shake 0.4s ease-in-out !important;
        background: rgba(239,68,68,0.1) !important;
        border-color: rgba(239,68,68,0.4) !important;
        color: #ef4444 !important;
      }

      .drop-overlay.error-state .drop-icon.target-icon {
        animation: none !important;
        border-color: rgba(239, 68, 68, 0.4) !important;
        background: rgba(239, 68, 68, 0.1) !important;
        color: #ef4444 !important;
      }

      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-4px); }
        40%, 80% { transform: translateX(4px); }
      }

      .drop-overlay.error-state .drop-title { color: #ef4444 !important; }
    `;
    dropOverlayShadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'drop-overlay';
    overlay.id = 'cc-drop-overlay';

    const card = document.createElement('div');
    card.className = 'drop-card';

    const flowContainer = document.createElement('div');
    flowContainer.className = 'drop-flow';

    const iconEl = document.createElement('div');
    iconEl.className = 'drop-icon source-icon';
    iconEl.id = 'cc-drop-icon';
    iconEl.innerHTML = getDropOverlayIcon(srcPlatform);

    const connectorEl = document.createElement('div');
    connectorEl.className = 'drop-flow-connector';

    const targetIconEl = document.createElement('div');
    targetIconEl.className = 'drop-icon target-icon';
    targetIconEl.id = 'cc-drop-icon-target';
    targetIconEl.innerHTML = getDropOverlayIcon(platform);

    flowContainer.appendChild(iconEl);
    flowContainer.appendChild(connectorEl);
    flowContainer.appendChild(targetIconEl);

    const titleEl = document.createElement('div');
    titleEl.className = 'drop-title';
    titleEl.id = 'cc-drop-title';
    titleEl.textContent = 'Drop to inject context';

    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'drop-subtitle';
    subtitleEl.id = 'cc-drop-subtitle';
    subtitleEl.innerHTML = `Conversation from <strong>${PLATFORM_NAMES[srcPlatform] || srcPlatform}</strong> will be injected<br>and submitted to this chat.`;

    const arrowEl = document.createElement('div');
    arrowEl.className = 'drop-arrow';
    arrowEl.id = 'cc-drop-arrow';
    arrowEl.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`;

    card.appendChild(flowContainer);
    card.appendChild(titleEl);
    card.appendChild(subtitleEl);
    card.appendChild(arrowEl);
    overlay.appendChild(card);
    dropOverlayShadow.appendChild(overlay);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });

    return { overlay, iconEl, titleEl, subtitleEl, arrowEl };
  }

  function removeDropOverlay() {
    if (dropOverlayHost) {
      try { dropOverlayHost.remove(); } catch (_) {}
      dropOverlayHost = null;
      dropOverlayShadow = null;
    }
    dragEnterCount = 0;
  }

  function getOverlayEl() {
    if (!dropOverlayShadow) return null;
    return dropOverlayShadow.getElementById('cc-drop-overlay');
  }

  // Spinner SVG for injecting state
  const SPINNER_SVG = `
    <svg class="cc-spinner" viewBox="0 0 50 50" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
      <circle class="cc-spinner-bg" cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4.5" opacity="0.15"></circle>
      <circle class="cc-spinner-path" cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"></circle>
    </svg>
  `;
  const CHECK_SVG   = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const ERROR_SVG   = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  // Track whether a Cross Context drag is in flight (set via storage.onChanged or MIME types)
  let ccDragActive = false;
  let ccDragPlatform = null;

  function checkCrossContextDrag(e) {
    if (ccDragActive) return true;
    if (e.dataTransfer && e.dataTransfer.types) {
      const types = Array.from(e.dataTransfer.types);
      const isCc = types.includes('text/x-cross-context') || types.includes('text/x-cross-context-active');
      const sourceMime = types.find(t => typeof t === 'string' && t.startsWith('text/x-cross-context-source-'));
      if (isCc || sourceMime) {
        ccDragActive = true;
        if (sourceMime) {
          ccDragPlatform = sourceMime.split('text/x-cross-context-source-')[1];
        } else {
          ccDragPlatform = platform;
        }
        return true;
      }
    }
    return false;
  }

  // Listen for pendingDrop being written by the popup at dragstart.
  // This fires on the content script side as soon as the popup sets it,
  // giving us a synchronous flag we can check inside dragenter/dragover.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.pendingDrop) {
      const newVal = changes.pendingDrop.newValue;
      if (newVal && Date.now() - newVal.timestamp < 30000) {
        // Popup just started a drag — arm the drop zone
        ccDragActive = true;
        ccDragPlatform = newVal.platform || platform;
      } else {
        // pendingDrop was removed (drag cancelled or completed)
        ccDragActive = false;
        ccDragPlatform = null;
      }
    }
  });

  window.addEventListener('dragenter', (e) => {
    if (!checkCrossContextDrag(e)) return;
    dragEnterCount++;
    if (dragEnterCount === 1 && !dropOverlayHost) {
      createDropOverlay(ccDragPlatform || platform);
    }
    e.preventDefault();
  }, true);

  window.addEventListener('dragover', (e) => {
    if (!checkCrossContextDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    
    // Recovery if dragenter didn't create the overlay
    if (!dropOverlayHost) {
      dragEnterCount = 1;
      createDropOverlay(ccDragPlatform || platform);
    }
    
    const ol = getOverlayEl();
    if (ol && !ol.classList.contains('over')) ol.classList.add('over');
  }, true);

  window.addEventListener('dragleave', (e) => {
    if (!dropOverlayHost) return;
    dragEnterCount = Math.max(0, dragEnterCount - 1);
    if (dragEnterCount === 0) {
      const ol = getOverlayEl();
      if (ol) {
        ol.classList.remove('over', 'visible');
        setTimeout(removeDropOverlay, 180);
      }
    }
  }, true);

  window.addEventListener('drop', async (e) => {
    if (!dropOverlayHost) return;

    e.preventDefault();
    e.stopPropagation();
    dragEnterCount = 0;
    ccDragActive = false;

    const ol = getOverlayEl();
    const iconEl  = dropOverlayShadow?.getElementById('cc-drop-icon');
    const titleEl = dropOverlayShadow?.getElementById('cc-drop-title');
    const subEl   = dropOverlayShadow?.getElementById('cc-drop-subtitle');
    const arrowEl = dropOverlayShadow?.getElementById('cc-drop-arrow');

    // Move to injecting state immediately (visible to user)
    if (ol)    { ol.classList.remove('over'); ol.classList.add('injecting'); }
    if (arrowEl) arrowEl.innerHTML  = SPINNER_SVG;
    if (titleEl) titleEl.textContent = 'Injecting...';
    if (subEl)   subEl.textContent   = 'Reading conversation…';

    let contextId = null;
    let plainText = null;

    // 1) Try dataTransfer (works if popup is still open — rare but possible)
    try {
      const raw = e.dataTransfer?.getData('text/x-cross-context');
      if (raw) contextId = JSON.parse(raw).id;
    } catch (_) {}

    try {
      plainText = e.dataTransfer?.getData('text/plain') || null;
      if (!contextId && plainText && !plainText.includes('[🔄 Cross Context Transfer]')) {
        contextId = plainText.trim();
      }
    } catch (_) {}

    // 2) Always prefer storage — popup is almost certainly closed by now
    try {
      const { pendingDrop } = await chrome.storage.local.get('pendingDrop');
      if (pendingDrop?.id && Date.now() - pendingDrop.timestamp < 30000) {
        contextId = pendingDrop.id;
      }
    } catch (_) {}

    const hasFallbackText = plainText && plainText.includes('[🔄 Cross Context Transfer]');
    if (!contextId && !hasFallbackText) {
      if (ol) ol.classList.add('error-state');
      if (arrowEl) arrowEl.innerHTML  = ERROR_SVG;
      if (titleEl) titleEl.textContent = 'Drop failed';
      if (subEl)   subEl.textContent   = 'Could not find context ID or fallback payload.';
      setTimeout(removeDropOverlay, 2500);
      return;
    }

    try {
      // Clear pendingDrop from storage now that we have the ID
      if (contextId) {
        chrome.storage.local.remove('pendingDrop');
      }

      let formatted = '';
      let srcPlatform = ccDragPlatform || platform;

      if (contextId) {
        if (subEl) subEl.textContent = 'Loading context from storage…';
        const { contexts = [] } = await chrome.storage.local.get('contexts');
        const context = contexts.find(c => c.id === contextId);
        if (context) {
          srcPlatform = context.platform;
          formatted = formatContextPrompt(context, platform);
        } else if (hasFallbackText) {
          formatted = plainText;
        } else {
          throw new Error('Context not found — it may have been deleted.');
        }
      } else {
        formatted = plainText;
      }

      // Update icon to actual source platform
      if (iconEl && srcPlatform) iconEl.innerHTML = getDropOverlayIcon(srcPlatform);
      if (subEl) subEl.textContent = 'Filling input field…';

      // Check we have an injector
      const injector = INJECTORS[platform];
      if (!injector) throw new Error(`No injector for "${platform}". Is this an LLM page?`);

      // Format and inject
      const result = await injector(formatted);
      if (!result?.success) throw new Error(result?.error || 'Injection returned failure.');

      // ✅ Success
      if (ol) { ol.classList.remove('injecting'); ol.classList.add('success'); }
      if (arrowEl) arrowEl.innerHTML  = CHECK_SVG;
      if (titleEl) titleEl.textContent = 'Context injected!';
      if (subEl) {
        const srcName = PLATFORM_NAMES[srcPlatform] || srcPlatform;
        subEl.innerHTML = `From <strong style="color:#34d399">${srcName}</strong> — submitted to this chat.`;
      }
      setTimeout(removeDropOverlay, 2000);

    } catch (err) {
      if (ol) { ol.classList.remove('injecting'); ol.classList.add('error-state'); }
      if (arrowEl) arrowEl.innerHTML  = ERROR_SVG;
      if (titleEl) titleEl.textContent = 'Injection failed';
      if (subEl)   subEl.textContent   = err.message || 'An unexpected error occurred.';
      setTimeout(removeDropOverlay, 3500);
    }
  }, true);



  // ════════════════════════════════════════════
  // MESSAGE LISTENER
  // ════════════════════════════════════════════

  // Store reference so it can be removed on re-injection (extension reload)
  window.__crossContextListener = (message, sender, sendResponse) => {
    if (message.type === 'DO_SCRAPE') {
      const anim = runScrapeAnimation();
      (async () => {
        try {
          activeScrapeTextCache = new WeakMap();
          startScrapingSession();
          const scraper = SCRAPERS[platform];
          if (!scraper) {
            anim.fail('Unsupported platform');
            sendResponse({ success: false, error: `No scraper for platform: ${platform}` });
            return;
          }
          const { messages, title } = scraper();
          if (!messages || messages.length === 0) {
            anim.fail('No messages found');
            sendResponse({ success: false, error: 'No conversation found. Make sure you have an active conversation open on this page.' });
            return;
          }

          // Process media elements if AI-Driven scrape is requested
          if (message.isAiScrape) {
            await attachMediaToMessages(messages, AI_MEDIA_LIMIT);
          }

          // Clean up DOM references so they can be JSON-serialized
          messages.forEach(msg => {
            delete msg.element;
          });
          
          anim.success();
          sendResponse({
            success: true,
            context: { platform, title, messages, url: window.location.href }
          });
        } catch (err) {
          anim.fail(err.message || 'Scrape failed');
          sendResponse({ success: false, error: 'Scrape error: ' + err.message });
        } finally {
          activeScrapeTextCache = null;
          endScrapingSession();
        }
      })();
      return true;
    }

    if (message.type === 'DO_INJECT') {
      const injector = INJECTORS[message.targetPlatform];
      if (!injector) {
        sendResponse({ success: false, error: `No injector for: ${message.targetPlatform}` });
        return true;
      }
      const formatted = formatContextPrompt(message.context, message.targetPlatform);
      injector(formatted).then(result => {
        chrome.storage.local.remove('pendingInjection');
        sendResponse(result);
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    if (message.type === 'ARM_DROP') {
      // Popup is starting a drag — pre-arm our drop detection
      const { id, platform: srcPlatform, timestamp } = message.payload || {};
      if (id && Date.now() - (timestamp || 0) < 30000) {
        ccDragActive = true;
        ccDragPlatform = srcPlatform || platform;
      }
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'DISARM_DROP') {
      // Drag was cancelled without a drop
      if (!dropOverlayHost) {
        ccDragActive = false;
        ccDragPlatform = null;
      }
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'PING') {
      sendResponse({ alive: true, platform });
      return true;
    }
  };

  chrome.runtime.onMessage.addListener(window.__crossContextListener);


  // ════════════════════════════════════════════
  // AUTO-INJECT CHECK (tab opened by background.js)
  // ════════════════════════════════════════════

  async function checkPendingInjection() {
    try {
      const { pendingInjection } = await chrome.storage.local.get('pendingInjection');
      if (!pendingInjection) return;

      const { context, targetPlatform, timestamp } = pendingInjection;
      const isRecent = Date.now() - timestamp < 30000;
      const isTarget = targetPlatform === platform;

      if (!isRecent || !isTarget) return;

      await sleep(2000); // wait for page to render

      const injector = INJECTORS[targetPlatform];
      if (!injector) return;

      const formatted = formatContextPrompt(context, targetPlatform);
      await injector(formatted);
      await chrome.storage.local.remove('pendingInjection');

    } catch (err) {
      console.error('Cross Context: Auto-inject failed:', err);
    }
  }

  // Run auto-inject check on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(checkPendingInjection, 1000));
  } else {
    setTimeout(checkPendingInjection, 1000);
  }

})();
