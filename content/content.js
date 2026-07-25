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
    if (hostname.includes('grok.com') || hostname.includes('x.ai')) return 'grok';
    if (hostname.includes('x.com') && (pathname.includes('grok') || pathname.includes('/i/grok'))) return 'grok';
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
  let isInjectionActive = false;

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
        // Try semantic role detection before alternating fallback
        role = classifyRoleSemantically(child);
        if (!role) {
          const text = getInnerText(child);
          if (text.length > 10) {
            role = lastRole === 'user' ? 'assistant' : 'user';
          }
        }
      }

      if (role) {
        const text = extractContent(child, role);
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


  // ════════════════════════════════════════════
  // DOM SCRAPING RELIABILITY LAYER
  // MutationObserver, fallback selectors, semantic roles,
  // markdown reconstruction, virtualized list handling, shadow DOM
  // ════════════════════════════════════════════

  // ── Component 1: MutationObserver — DOM Readiness ──

  /**
   * Waits for DOM mutations to settle before scraping.
   * Resolves when no new childList/subtree mutations fire for `quietMs`.
   * Times out after `maxMs` to prevent hanging on infinite-streaming responses.
   */
  function waitForDomSettled(root = document.body, quietMs = 150, maxMs = 1200) {
    return new Promise(resolve => {
      let timer = null;
      const deadline = setTimeout(() => { observer.disconnect(); resolve(); }, maxMs);
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          observer.disconnect();
          clearTimeout(deadline);
          resolve();
        }, quietMs);
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      // Kickstart: if DOM is already stable, resolve after quietMs
      timer = setTimeout(() => { observer.disconnect(); clearTimeout(deadline); resolve(); }, quietMs);
    });
  }

  // ── Component 2: Fallback Selector Chains ──

  /**
   * Tries each selector group in priority order.
   * Returns elements from the first group that produces results.
   * Selectors are organized: [data-testid] > [data-*] > [class*=] > semantic > structural
   */
  function resilientQueryAll(selectorGroups, root = document, filterFn = filterInputArea) {
    for (const group of selectorGroups) {
      const selectors = Array.isArray(group) ? group.join(', ') : group;
      try {
        const els = [...root.querySelectorAll(selectors)].filter(filterFn);
        if (els.length > 0) return els;
      } catch (_) { /* invalid selector — skip */ }
    }
    return [];
  }

  // ── Component 3: Semantic Role Detection via ARIA ──

  /**
   * Infers message role from ARIA, structural, and heuristic signals.
   * Returns 'user' | 'assistant' | null
   */
  function classifyRoleSemantically(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;

    // 1. Explicit data attributes
    const dataRole = el.getAttribute('data-message-author-role')
                  || el.getAttribute('data-role')
                  || el.getAttribute('data-message-role')
                  || el.getAttribute('data-is-human');
    if (dataRole === 'user' || dataRole === 'human' || dataRole === 'true') return 'user';
    if (dataRole === 'assistant' || dataRole === 'bot' || dataRole === 'model' || dataRole === 'false') return 'assistant';

    // 2. ARIA labels (platform-agnostic)
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (/\b(user|human|you|your\s+message)\b/.test(ariaLabel)) return 'user';
    if (/\b(assistant|ai|bot|model|response|answer|claude|chatgpt|gemini|grok)\b/.test(ariaLabel)) return 'assistant';

    // 3. ARIA role — skip containers
    const ariaRole = el.getAttribute('role');
    if (ariaRole === 'log' || ariaRole === 'feed' || ariaRole === 'list') return null;

    // 4. Structural: contains rich markdown rendering → likely assistant
    if (el.querySelector('pre > code, table, .katex, [class*="math"], [class*="highlight"]')) return 'assistant';

    // 5. Structural: short plaintext with no formatting → likely user
    const text = (el.innerText || '').trim();
    if (text.length > 0 && text.length < 500 && !el.querySelector('pre, code, table, ul, ol, h1, h2, h3, blockquote')) {
      return 'user';
    }

    return null;
  }

  // ── Component 4: Markdown Reconstruction ──

  /**
   * Converts a DOM element to structured Markdown, preserving:
   * - Code blocks (```lang ... ```)
   * - Inline code (`...`)
   * - Headers (# ## ###)
   * - Lists (- / 1.)
   * - Bold, italic, links
   * - Tables (| col | col |)
   * - Blockquotes (> ...)
   */
  function domToMarkdown(el) {
    if (!el) return '';
    const wasActive = isSessionActive;
    if (!wasActive) startScrapingSession();

    try {
      return walkNode(el).replace(/\n{3,}/g, '\n\n').trim();
    } finally {
      if (!wasActive) endScrapingSession();
    }
  }

  function walkNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    // Skip hidden elements (but not body/html)
    const tag = node.tagName;
    if (tag !== 'BODY' && tag !== 'HTML') {
      try {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return '';
      } catch (_) {}
    }

    // Skip scraping-noise elements
    if (tag === 'BUTTON' || tag === 'SVG' || tag === 'NAV' || tag === 'FORM') return '';
    if (node.getAttribute('role') === 'button') return '';

    const children = () => Array.from(node.childNodes).map(walkNode).join('');

    switch (tag) {
      case 'PRE': {
        const code = node.querySelector('code');
        const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
        const text = (code || node).textContent || '';
        return `\n\`\`\`${lang}\n${text.trimEnd()}\n\`\`\`\n`;
      }
      case 'CODE':
        if (node.parentElement?.tagName !== 'PRE') return `\`${node.textContent}\``;
        return node.textContent || '';
      case 'H1': return `\n# ${children().trim()}\n`;
      case 'H2': return `\n## ${children().trim()}\n`;
      case 'H3': return `\n### ${children().trim()}\n`;
      case 'H4': return `\n#### ${children().trim()}\n`;
      case 'H5': return `\n##### ${children().trim()}\n`;
      case 'H6': return `\n###### ${children().trim()}\n`;
      case 'STRONG': case 'B': return `**${children()}**`;
      case 'EM': case 'I': return `*${children()}*`;
      case 'DEL': case 'S': return `~~${children()}~~`;
      case 'A': {
        const href = node.getAttribute('href') || '';
        const text = children().trim();
        return href ? `[${text}](${href})` : text;
      }
      case 'UL': return '\n' + Array.from(node.children)
        .filter(c => c.tagName === 'LI')
        .map(li => `- ${walkNode(li).trim()}`).join('\n') + '\n';
      case 'OL': return '\n' + Array.from(node.children)
        .filter(c => c.tagName === 'LI')
        .map((li, i) => `${i + 1}. ${walkNode(li).trim()}`).join('\n') + '\n';
      case 'LI': return children();
      case 'BLOCKQUOTE': {
        const content = children().trim();
        return '\n' + content.split('\n').map(l => `> ${l}`).join('\n') + '\n';
      }
      case 'TABLE': return convertTableToMarkdown(node);
      case 'BR': return '\n';
      case 'HR': return '\n---\n';
      case 'P': return `\n${children()}\n`;
      case 'DIV': return children() + '\n';
      case 'IMG': {
        const alt = node.getAttribute('alt') || 'image';
        return `[${alt}]`;
      }
      case 'SUP': return ''; // strip citation superscripts
      default: return children();
    }
  }

  function convertTableToMarkdown(tableEl) {
    const rows = [...tableEl.querySelectorAll('tr')];
    if (rows.length === 0) return '';
    const result = [];
    rows.forEach((row, i) => {
      const cells = [...row.querySelectorAll('th, td')].map(c => c.textContent.trim().replace(/\|/g, '\\|'));
      result.push('| ' + cells.join(' | ') + ' |');
      if (i === 0) result.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    });
    return '\n' + result.join('\n') + '\n';
  }

  /**
   * Extracts content from a message element.
   * For assistant messages, reconstructs Markdown to preserve formatting.
   * For user messages, uses plain text.
   */
  function extractContent(el, role) {
    if (!el) return '';
    // For assistant messages, reconstruct markdown to preserve code blocks, tables, etc.
    if (role === 'assistant') {
      const md = domToMarkdown(el);
      if (md.length > 10) return md;
    }
    // For user messages or short assistant text, use plain text (faster, simpler)
    return getInnerText(el);
  }

  // ── Component 5: Virtualized List Handling ──

  /**
   * Smoothly scrolls to the very top (start) of the scroll container to load all messages.
   * This handles lazy-loading / virtualization, and visually demonstrates complete scraping to the user.
   */
  async function scrollToLoadAll(chatContainer, maxScrollTime = 8000) {
    // Find the actual scrollable viewport or inner container using our advanced heuristic
    const scrollEl = findActualScrollContainer(chatContainer);
    if (!scrollEl) return false;

    const startTime = Date.now();
    let lastScrollTop = scrollEl.scrollTop;
    let lastScrollHeight = scrollEl.scrollHeight;
    let staleCount = 0;

    // Smoothly scroll UP in steps, pausing to load lazy-content at the top
    while (Date.now() - startTime < maxScrollTime) {
      if (scrollEl.scrollTop <= 5) {
        // We are close to the top, let's wait to see if more content is prepended
        await sleep(400);
        await waitForDomSettled(scrollEl, 300, 1500);

        // If scrollHeight changed or scrollTop is no longer near 0, keep scrolling up.
        // Otherwise, we are truly at the start.
        if (scrollEl.scrollTop <= 5 && scrollEl.scrollHeight === lastScrollHeight) {
          break; // Truly at the top start of the conversation
        }
      }

      // Perform a smooth scroll step upwards
      const scrollStep = Math.round(scrollEl.clientHeight * 0.85);
      scrollEl.scrollBy({ top: -scrollStep, behavior: 'smooth' });

      // Wait for smooth scroll movement
      await sleep(250);
      await waitForDomSettled(scrollEl, 200, 1000);

      // Check if we are stuck (i.e. cannot scroll up anymore and height hasn't changed)
      if (scrollEl.scrollTop === lastScrollTop && scrollEl.scrollHeight === lastScrollHeight) {
        staleCount++;
        if (staleCount > 4) break;
      } else {
        staleCount = 0;
      }

      lastScrollTop = scrollEl.scrollTop;
      lastScrollHeight = scrollEl.scrollHeight;
    }

    // A final smooth scroll to absolute 0 to ensure we are perfectly at the start
    scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
    await sleep(500);

    return true;
  }

  /**
   * Finds the nearest scrollable ancestor of an element.
   */
  function findScrollableAncestor(el) {
    if (!el) return null;
    let curr = el;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      const style = window.getComputedStyle(curr);
      const overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && curr.scrollHeight > curr.clientHeight) {
        return curr;
      }
      curr = curr.parentElement;
    }
    // Fallback to the element itself if it has scroll
    if (el && el.scrollHeight > el.clientHeight) return el;
    return null;
  }

  /**
   * Locates the actual scrollable container of a chat thread by running multiple heuristics.
   * This ensures virtualization scrolls work flawlessly on Claude, Gemini, Perplexity, Grok, and ChatGPT.
   */
  function findActualScrollContainer(chatRoot) {
    // 1. Find any message container or tweet row on page and search UP for its scroll ancestor
    const msgSelector = 'article, [data-message-author-role], [data-message-id], .user-message, .assistant-message, [class*="message-bubble"], [class*="Messagebubble"], [class*="message-row"], [class*="chat-turn"], [class*="bubble"], [class*="Message"], [data-testid="tweet"]';
    
    const rootEl = chatRoot || document.body;
    const msgEl = rootEl.querySelector(msgSelector) || document.querySelector(msgSelector);
    if (msgEl) {
      const scrollEl = findScrollableAncestor(msgEl);
      if (scrollEl) return scrollEl;
    }

    // 2. Search UP or DOWN from the selected chatRoot container
    if (chatRoot) {
      const scrollEl = findScrollableAncestor(chatRoot);
      if (scrollEl) return scrollEl;
      
      const allChildren = chatRoot.querySelectorAll('*');
      for (const child of allChildren) {
        const style = window.getComputedStyle(child);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && child.scrollHeight > child.clientHeight) {
          return child;
        }
      }
    }

    // 3. Search DOWN from body for any element with overflow scrolling (excluding overlay host)
    const allBodyChildren = document.body.querySelectorAll('*');
    for (const child of allBodyChildren) {
      if (child.id === '__cross-context-host' || child.closest('#__cross-context-host')) continue;
      
      const style = window.getComputedStyle(child);
      const overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && child.scrollHeight > child.clientHeight) {
        return child;
      }
    }

    // 4. Default to standard scrolling element for the document window viewport
    return document.scrollingElement || document.documentElement || document.body;
  }

  // ── Component 6: Shadow DOM Traversal ──

  /**
   * querySelectorAll that also pierces open shadow roots.
   * Recursively searches through shadow DOM boundaries.
   */
  function querySelectorDeep(selector, root = document) {
    const results = [...root.querySelectorAll(selector)];

    // Traverse into open shadow roots
    const walk = (node) => {
      if (node.shadowRoot) {
        results.push(...node.shadowRoot.querySelectorAll(selector));
        node.shadowRoot.querySelectorAll('*').forEach(walk);
      }
    };

    root.querySelectorAll('*').forEach(walk);
    return results;
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

      const userSelectors = [
        '[data-message-author-role="user"]',
        '[data-testid*="user-message"]',
        '[class*="user-message"]',
        '[class*="user_message"]',
        '[class*="justify-end"] .whitespace-pre-wrap',
        '[class*="justify-end"] [class*="whitespace-pre-wrap"]',
        '.whitespace-pre-wrap:not(.markdown *):not([class*="prose"] *):not([class*="markdown"] *)'
      ].join(', ');

      const assistantSelectors = [
        '[data-message-author-role="assistant"]',
        '[data-testid*="assistant-message"]',
        '[class*="assistant-message"]',
        '[class*="assistant_message"]',
        '[class*="agent-"]',
        '[class*="agent_"]',
        '.markdown',
        '[class*="markdown"]',
        '[class*="prose"]'
      ].join(', ');

      const copyButtonSelectors = [
        'button[aria-label*="Copy" i]',
        'button[data-testid*="copy" i]',
        '[class*="copy-button"]',
        'button[class*="copy"]'
      ].join(', ');

      // Helper: determine if an element is an assistant response (markdown-rendered or has assistant indicators)
      function isAssistantBlock(el) {
        if (!el) return false;
        if (el.matches(assistantSelectors)) return true;
        if (el.querySelector(assistantSelectors)) return true;
        if (el.querySelector(copyButtonSelectors)) return true;
        if (el.querySelector('button[aria-label*="Good" i], button[aria-label*="Bad" i], button[aria-label*="feedback" i], [class*="thumbs"] button')) {
          return true;
        }
        if (el.querySelector('pre, code, table, ol, ul > li > p')) {
          return true;
        }
        return false;
      }

      // Helper: determine if an element is a user message bubble (plain text prompt)
      function isUserBubble(el) {
        if (!el) return false;
        if (isAssistantBlock(el)) return false;
        if (el.matches(userSelectors)) return true;
        if (el.querySelector(userSelectors)) return true;
        return false;
      }

      // Helper: extract clean text from a turn container
      function extractTurnText(el, role) {
        if (role === 'assistant') {
          const md = el.querySelector('.markdown, [class*="prose"], [class*="markdown"]');
          if (md) return getInnerText(md);
        }
        if (role === 'user') {
          const wp = el.querySelector('.whitespace-pre-wrap, [class*="whitespace-pre-wrap"]');
          if (wp) return getInnerText(wp);
        }
        return getInnerText(el);
      }

      // Helper: determine article role by multi-layered checks (including visual alignment)
      const mainEl = document.querySelector('main') || document.querySelector('[role="main"]');
      function determineArticleRole(art) {
        // 1. Check direct role attribute
        const roleEl = art.querySelector('[data-message-author-role]') ||
                       (art.hasAttribute('data-message-author-role') ? art : null);
        if (roleEl) {
          const role = roleEl.getAttribute('data-message-author-role');
          if (role === 'user' || role === 'assistant') return role;
        }

        // 2. Check layout classes
        const hasUserClass = art.querySelector('[class*="justify-end"], [class*="items-end"]') || 
                             art.classList.contains('justify-end') || 
                             art.classList.contains('items-end');
        if (hasUserClass) return 'user';

        const hasAssistantClass = art.querySelector('[class*="justify-start"], [class*="agent-"], [class*="assistant-"]') || 
                                  art.classList.contains('justify-start') ||
                                  art.classList.contains('agent-') ||
                                  art.classList.contains('assistant-');
        if (hasAssistantClass) return 'assistant';

        // 2.5. Semantic role detection (ARIA, structural heuristics)
        const semanticRole = classifyRoleSemantically(art);
        if (semanticRole) return semanticRole;

        // 3. Fallback to visual alignment
        if (mainEl) {
          const rect = art.getBoundingClientRect();
          const chatRect = mainEl.getBoundingClientRect();
          if (chatRect.width > 0) {
            const textEl = art.querySelector('.whitespace-pre-wrap, .markdown, [class*="prose"], [class*="message-content"]') || art;
            const tRect = textEl.getBoundingClientRect();
            const leftMargin = tRect.left - chatRect.left;
            const rightMargin = chatRect.right - tRect.right;
            if (leftMargin > rightMargin && leftMargin > chatRect.width * 0.15) {
              return 'user';
            } else {
              return 'assistant';
            }
          }
        }

        // 4. Default fallback: check for assistant-specific elements
        if (isAssistantBlock(art)) return 'assistant';
        if (isUserBubble(art)) return 'user';

        return 'user';
      }

      // ── Strategy 1: Interleaved direct selection (most robust for ChatGPT's unified article turns) ──
      const humanEls = [...document.querySelectorAll(userSelectors)].filter(filterInputArea);
      let assistantEls = [...document.querySelectorAll(assistantSelectors)].filter(filterInputArea);
      
      // Exclude assistant elements that are actually inside user elements
      assistantEls = assistantEls.filter(el => !humanEls.some(userEl => userEl.contains(el)));
      
      // Exclude user elements that are inside assistant elements (e.g. whitespace-pre-wrap in code blocks)
      const cleanUserEls = humanEls.filter(el => !assistantEls.some(assistantEl => assistantEl.contains(el)));

      if (cleanUserEls.length > 0 && assistantEls.length > 0) {
        const combined = [
          ...cleanUserEls.map(el => ({ el, role: 'user' })),
          ...assistantEls.map(el => ({ el, role: 'assistant' }))
        ];
        combined.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

        const msgs = combined.map(({ el, role }) => {
          const content = extractTurnText(el, role);
          return { role, content, element: el };
        }).filter(m => m.content.length > 2);

        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: chatTitle() };
        }
      }

      // ── Strategy 2: Article-based inner turns extraction ──
      const articles = [...document.querySelectorAll('article')].filter(filterInputArea);
      if (articles.length > 0) {
        const msgs = [];
        for (const art of articles) {
          const artUserEls = [...art.querySelectorAll(userSelectors)].filter(filterInputArea);
          let artAssistantEls = [...art.querySelectorAll(assistantSelectors)].filter(filterInputArea);
          
          artAssistantEls = artAssistantEls.filter(el => !artUserEls.some(userEl => userEl.contains(el)));
          const cleanArtUserEls = artUserEls.filter(el => !artAssistantEls.some(assistantEl => assistantEl.contains(el)));

          const combined = [
            ...cleanArtUserEls.map(el => ({ el, role: 'user' })),
            ...artAssistantEls.map(el => ({ el, role: 'assistant' }))
          ];
          combined.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

          combined.forEach(({ el, role }) => {
            const content = extractTurnText(el, role);
            if (content.length > 2) {
              msgs.push({ role, content, element: el });
            }
          });
        }
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: chatTitle() };
        }
      }

      // ── Strategy 3: Next-sibling anchor approach ──
      if (cleanUserEls.length > 0) {
        const msgs = [];
        cleanUserEls.forEach(humanEl => {
          const userText = getInnerText(humanEl);
          if (userText.length > 0) msgs.push({ role: 'user', content: userText, element: humanEl });

          let cursor = humanEl;
          let assistantText = '';

          for (let depth = 0; depth < 8 && !assistantText; depth++) {
            let sibling = cursor.nextElementSibling;
            while (sibling && !assistantText) {
              const containsHumanTurn =
                sibling.getAttribute('data-testid') === 'user-message' ||
                sibling.querySelector('[data-testid*="user-message"]') !== null ||
                sibling.matches(userSelectors) ||
                sibling.querySelector(userSelectors) !== null;
              
              if (containsHumanTurn) break;

              const innerContent = sibling.querySelector(
                '.markdown, [class*="prose"], [class*="markdown"], ' +
                '[class*="message-content"], [class*="response-content"], ' +
                '[class*="agent-"], [class*="assistant"]'
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
            msgs.push({ role: 'assistant', content: assistantText, element: humanEl });
          }
        });

        if (msgs.length > 0 && hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: chatTitle() };
        }
      }

      // ── Strategy 4: LCA-based turn extractor ──
      try {
        const lcaMsgs = extractConversationViaLCA(userSelectors, assistantSelectors, copyButtonSelectors);
        if (lcaMsgs && hasBothRoles(lcaMsgs)) {
          return { messages: deduplicate(lcaMsgs), title: chatTitle() };
        }
      } catch (e) {
        // Continue
      }

      // ── Strategy 5: Walk all direct children of the deepest multi-child container ──
      if (mainEl) {
        let container = mainEl;
        let found = false;
        const maxDepth = 15;
        for (let d = 0; d < maxDepth && !found; d++) {
          for (const child of container.children) {
            if (child.children.length >= 2) {
              let textChildCount = 0;
              let hasUserLike = false;
              let hasAssistantLike = false;
              for (const grandchild of child.children) {
                const text = (grandchild.innerText || '').trim();
                if (text.length > 10) textChildCount++;
                if (isAssistantBlock(grandchild)) hasAssistantLike = true;
                if (isUserBubble(grandchild)) hasUserLike = true;
              }
              if (textChildCount >= 2 && hasUserLike && hasAssistantLike) {
                container = child;
                found = true;
                break;
              }
            }
          }
          if (!found && container.children.length === 1) {
            container = container.children[0];
          } else if (!found) {
            break;
          }
        }

        if (found) {
          const msgs = [];
          for (const child of container.children) {
            if (!filterInputArea(child)) continue;
            const role = determineArticleRole(child);
            const content = extractTurnText(child, role);
            if (content.length > 3) {
              msgs.push({ role, content, element: child });
            }
          }
          if (hasBothRoles(msgs)) {
            return { messages: deduplicate(msgs), title: chatTitle() };
          }
        }
      }

      // ── Strategy 6: Alternating fallback ──
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

      // ── Strategy 2: custom element tags <user-query> / <model-response> (with shadow DOM piercing) ──
      const userEls  = querySelectorDeep('user-query').filter(filterInputArea);
      const modelEls = querySelectorDeep('model-response').filter(filterInputArea);
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

      // ── Strategy 4: Walk [role="main"] children by DOM order ──
      const mainContainer = document.querySelector('[role="main"], main');
      if (mainContainer) {
        const msgs = [];
        let lastRole = null;
        for (const child of mainContainer.children) {
          if (!filterInputArea(child)) continue;

          // Try to classify via semantic role or tag name
          const tag = child.tagName?.toLowerCase();
          const isUserEl = tag === 'user-query' || child.querySelector('user-query') ||
                           child.matches('[class*="user-query"], [class*="UserQuery"]') ||
                           child.querySelector('[class*="user-query"], [class*="UserQuery"]');
          const isModelEl = tag === 'model-response' || child.querySelector('model-response') ||
                            child.matches('[class*="model-response"], [class*="ModelResponse"]') ||
                            child.querySelector('[class*="model-response"], [class*="ModelResponse"]');

          let role = null;
          if (isUserEl && !isModelEl) role = 'user';
          else if (isModelEl && !isUserEl) role = 'assistant';
          else {
            const semRole = classifyRoleSemantically(child);
            if (semRole) role = semRole;
            else {
              const text = getInnerText(child);
              if (text.length > 15) {
                role = lastRole === 'user' ? 'assistant' : 'user';
              }
            }
          }

          if (role) {
            const text = extractContent(child, role);
            if (text.length > 10) {
              msgs.push({ role, content: text, element: child });
              lastRole = role;
            }
          }
        }
        if (hasBothRoles(msgs)) {
          return { messages: deduplicate(msgs), title: gemTitle() };
        }
      }

      // ── Strategy 5: Alternating container fallback ──
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
      const tracker = el._valueTracker;
      if (tracker) { try { tracker.setValue(''); } catch (_) {} }
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) { setter.call(el, value); return; }
    } else if (el.tagName === 'INPUT') {
      const tracker = el._valueTracker;
      if (tracker) { try { tracker.setValue(''); } catch (_) {} }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) { setter.call(el, value); return; }
    }
    el.value = value;
  }

  function dispatchInputEvents(el) {
    try {
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: el.value || el.textContent, bubbles: true, cancelable: true }));
    } catch (_) {}
    try {
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: el.value || el.textContent, bubbles: true }));
    } catch (_) {}
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function formatGeminiHtml(text) {
    if (!text) return '<p><br></p>';
    return text.split('\n').map(line => {
      const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return escaped.trim() ? `<p>${escaped}</p>` : '<p><br></p>';
    }).join('');
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
      setNativeValue(el, text);
      dispatchInputEvents(el);
      // Fallback execCommand if setNativeValue didn't stick
      if (el.value !== text) {
        el.select();
        document.execCommand('insertText', false, text);
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

    // Trigger post-input react/vue state bindings
    try {
      el.dispatchEvent(new InputEvent('input', {
        inputType: 'insertText',
        data: text,
        bubbles: true
      }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
  }

  async function trySubmit(inputEl, submitSelectors) {
    for (let i = 0; i < 25; i++) {
      const btn = document.querySelector(submitSelectors);
      const isDisabled = btn && (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('disabled'));
      if (btn && !isDisabled) {
        try {
          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        } catch (_) {}
        btn.click();
        return true;
      }
      await sleep(40);
    }
    if (inputEl) {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
    }
    return false;
  }

  async function waitForElement(selectors, maxRetries = 40, interval = 50) {
    for (let i = 0; i < maxRetries; i++) {
      const el = document.querySelector(selectors);
      if (el) return el;
      await sleep(interval);
    }
    return null;
  }

  /**
   * Creates an in-memory context.md File and attaches it to the platform's
   * file input via the DataTransfer API. Falls back to simulating a drop
   * event on the chat area if no <input type="file"> is found.
   *
   * @param {string} content - The formatted Markdown content
   * @param {string} [dropTargetSelector] - Optional CSS selector for a drop target fallback
   * @param {string} [fileName='context.md'] - Name of the file to attach
   * @returns {{ success: boolean, method: string, error?: string }}
   */
  async function attachMarkdownFile(content, dropTargetSelector, fileName = 'context.md') {
    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length === 0) {
      return { success: false, method: 'none', error: 'No file input found' };
    }

    const file = new File([content], fileName, { type: 'text/markdown' });

    // Strategy 1: Find a visible <input type="file"> and set its files via DataTransfer
    for (const fileInput of fileInputs) {
      const accept = (fileInput.getAttribute('accept') || '').toLowerCase();
      // Skip image-only inputs
      if (accept && accept.includes('image/') && !accept.includes('*/*') && !accept.includes('.md') && !accept.includes('text/')) {
        continue;
      }
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(150);
        return { success: true, method: 'file-input' };
      } catch (_) {
        // Next input
      }
    }

    // Strategy 2: Simulate a drop event on the chat area
    const dropTarget = dropTargetSelector
      ? document.querySelector(dropTargetSelector)
      : document.querySelector('[contenteditable="true"], textarea, #prompt-textarea, .ProseMirror');

    if (dropTarget) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);

        const dragEnterEvt = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt });
        const dragOverEvt = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
        const dropEvt = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });

        dropTarget.dispatchEvent(dragEnterEvt);
        dropTarget.dispatchEvent(dragOverEvt);
        dropTarget.dispatchEvent(dropEvt);

        await sleep(800);
        return { success: true, method: 'drop' };
      } catch (_) {
        // Drop simulation failed
      }
    }

    return { success: false, method: 'none', error: 'No file input or drop target found' };
  }

  /** Helper to generate companion message typed into the input alongside the attached file */
  function getCompanionMessage(fileName = 'context.md', contextId = '') {
    const idStr = contextId ? ` (Context ID: ${contextId})` : '';
    return `Please read the attached ${fileName}${idStr} and continue from where we left off. Use Context ID ${contextId || 'con_01'} to distinguish this conversation context.`;
  }

  /**
   * Preview-before-send: Shows a floating confirmation overlay with a truncated
   * preview of the injected prompt. Returns a Promise that resolves to the final prompt
   * string (send) or false (cancel). Uses Shadow DOM for CSS isolation.
   * @param {string} prompt - The full formatted prompt text
   * @param {boolean} [isFileMode=false] - If true, shows file-attachment badge in the header
   * @param {string} [fileName='context.md'] - File name for the badge
   */
  function showPreviewConfirmation(prompt, isFileMode = false, fileName = 'context.md') {
    return new Promise((resolve) => {
      // Remove any existing preview overlay
      const existingHost = document.getElementById('__cc-preview-host');
      if (existingHost) existingHost.remove();

      const host = document.createElement('div');
      host.id = '__cc-preview-host';
      host.style.cssText = `
        all: initial !important;
        position: fixed !important;
        bottom: 16px !important;
        right: 16px !important;
        z-index: 2147483647 !important;
        pointer-events: auto !important;
        display: block !important;
      `;
      document.documentElement.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });

      const previewText = prompt.length > 400
        ? prompt.substring(0, 400) + '…'
        : prompt;

      shadow.innerHTML = `
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

          .cc-preview-card {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, rgba(16, 20, 28, 0.97) 0%, rgba(8, 10, 14, 0.99) 100%);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 18px;
            width: 420px;
            max-width: calc(100vw - 32px);
            color: #e4e4e7;
            box-shadow:
              0 30px 70px rgba(0, 0, 0, 0.7),
              0 0 40px rgba(139, 92, 246, 0.1),
              inset 0 1px 0 rgba(255, 255, 255, 0.06);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            animation: cc-preview-slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            gap: 14px;
          }

          @keyframes cc-preview-slide-in {
            from { transform: translateY(30px) scale(0.96); opacity: 0; }
            to { transform: translateY(0) scale(1); opacity: 1; }
          }

          .cc-preview-header {
            display: flex;
            align-items: center;
            gap: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            padding-bottom: 12px;
          }

          .cc-preview-icon-wrapper {
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }

          .cc-preview-logo {
            width: 36px;
            height: 36px;
            object-fit: contain;
            filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.3));
          }

          .cc-preview-header-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .cc-preview-title {
            font-size: 14px;
            font-weight: 700;
            color: #ffffff;
            letter-spacing: -0.2px;
          }

          .cc-preview-subtitle {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.5);
            font-weight: 400;
          }

          .cc-mode-badge {
            font-size: 10px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 4px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            width: fit-content;
            margin-top: 3px;
          }
          .cc-mode-badge.file {
            background: rgba(167, 139, 250, 0.15);
            color: #c4b5fd;
            border: 1px solid rgba(167, 139, 250, 0.28);
          }
          .cc-mode-badge.text {
            background: rgba(245, 158, 11, 0.15);
            color: #fcd34d;
            border: 1px solid rgba(245, 158, 11, 0.28);
          }

          .cc-preview-body {
            width: 100%;
            height: 180px;
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 10px;
            padding: 12px 14px;
            font-size: 12px;
            line-height: 1.6;
            color: rgba(255, 255, 255, 0.85);
            box-sizing: border-box;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-word;
          }

          .cc-preview-body::-webkit-scrollbar {
            width: 4px;
          }
          .cc-preview-body::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
          }
          .cc-preview-body::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.2);
          }

          .cc-preview-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 4px;
          }

          .cc-preview-btn {
            font-family: inherit;
            font-size: 11.5px;
            font-weight: 600;
            padding: 8px 16px;
            height: 34px;
            border-radius: 20px; /* Modern Premium Pill Shape */
            border: 1px solid transparent;
            cursor: pointer;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            letter-spacing: 0.1px;
            box-sizing: border-box;
            outline: none;
          }

          .cc-preview-btn.cancel {
            background: rgba(255, 255, 255, 0.02);
            color: rgba(255, 255, 255, 0.6);
            border-color: rgba(255, 255, 255, 0.08);
          }
          .cc-preview-btn.cancel:hover {
            background: rgba(239, 68, 68, 0.05); /* Crimson alert background hover */
            color: #ef4444; /* Crimson text */
            border-color: rgba(239, 68, 68, 0.25);
            box-shadow: 0 0 12px rgba(239, 68, 68, 0.15);
          }
          .cc-preview-btn.cancel:active {
            transform: scale(0.97);
          }

          .cc-preview-btn.send {
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #db2777 100%);
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 4px 15px rgba(124, 58, 237, 0.35);
            position: relative;
            overflow: hidden;
          }
          /* Premium Shimmer sweep hover effect */
          .cc-preview-btn.send::after {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.25), transparent);
            transform: translateX(-100%);
            transition: transform 0.6s ease;
          }
          .cc-preview-btn.send:hover {
            box-shadow: 0 6px 20px rgba(124, 58, 237, 0.5), 0 0 12px rgba(219, 39, 119, 0.25);
            transform: translateY(-1px);
            border-color: rgba(255, 255, 255, 0.3);
          }
          .cc-preview-btn.send:hover::after {
            transform: translateX(100%);
          }
          .cc-preview-btn.send:active {
            transform: translateY(0) scale(0.97);
          }
        </style>

        <div class="cc-preview-card">
          <div class="cc-preview-header">
            <div class="cc-preview-icon-wrapper">
              <img src="${chrome.runtime.getURL('icons/icon128.png')}" class="cc-preview-logo" alt="Cross Context Logo" />
            </div>
            <div class="cc-preview-header-text">
              <div class="cc-preview-title">${isFileMode ? `📎 Attaching ${fileName}` : 'Cross Context Transfer Ready'}</div>
              <div class="cc-preview-subtitle">${isFileMode ? 'Markdown file attached to platform file input' : 'Review prompt before sending'}</div>
              <span class="cc-mode-badge ${isFileMode ? 'file' : 'text'}">${isFileMode ? `📄 Attached ${fileName}` : '📝 Text Paste Fallback'}</span>
            </div>
          </div>
          <div class="cc-preview-body" id="cc-preview-body-text">${previewText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          <div class="cc-preview-actions">
            <button class="cc-preview-btn cancel" id="cc-preview-cancel">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              <span>Cancel</span>
            </button>
            <button class="cc-preview-btn send" id="cc-preview-send">
              <span>Send</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-left: 2px;">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>
      `;

      const sendBtn = shadow.getElementById('cc-preview-send');
      const cancelBtn = shadow.getElementById('cc-preview-cancel');

      const cleanup = (resultValue) => {
        try { host.remove(); } catch (_) {}
      };

      const autoDismissId = setTimeout(() => cleanup(true), 1200);

      sendBtn.addEventListener('click', () => { clearTimeout(autoDismissId); cleanup(true); });
      cancelBtn.addEventListener('click', () => { clearTimeout(autoDismissId); cleanup(false); });

      // Fast non-blocking auto-resolve
      resolve(true);

      // Keyboard: Enter to send, Escape to cancel
      const keyHandler = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          wrappedCleanup(false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          wrappedCleanup(true);
        }
      };
      document.addEventListener('keydown', keyHandler);

      // Auto-timeout after 60 seconds (auto-send)
      const timeoutId = setTimeout(() => {
        if (document.getElementById('__cc-preview-host')) {
          wrappedCleanup(true);
        }
      }, 60000);
    });
  }

  /** Helper to generate minimal companion instruction typed into the input box alongside attached context.md */
  function getCompanionMessage(fileName = 'context.md', contextId = '') {
    const idVal = contextId || 'con_01';
    return `Continue this project using the attached \`${fileName}\` (Context ID: \`${idVal}\`). Respond only to the current task.`;
  }

  /** Generates Markdown File Block payload when native host file chip upload is blocked */
  function formatFileBlockPayload(promptText, fileName = 'context.md', contextId = '') {
    const idVal = contextId || 'con_01';
    return `📁 **Attached Context File**: \`${fileName}\` (Context ID: \`${idVal}\`)
================================================================

\`\`\`markdown
${promptText}
\`\`\`

================================================================
Continue this project using the attached \`${fileName}\` file block above. Respond only to the current task.`;
  }

  /**
   * Polls for file attachment upload readiness on the target platform
   * @param {string} platform - The host platform name
   * @param {number} [timeoutMs=1500] - Max wait time in ms
   */
  async function waitForFileUploadComplete(platform, timeoutMs = 250) {
    const selectors = {
      claude: '[aria-label*="Attachment"], [class*="file-thumbnail"], [class*="attachment"], [data-testid*="file"]',
      chatgpt: '[data-testid="file-chip"], [class*="attachment-item"], [class*="file-"], [data-testid*="attachment"]',
      gemini: 'uploader-file-chip, [class*="file-preview"], [class*="attachment"], [class*="upload-chip"]',
      grok: '[class*="attachment"], [class*="file-chip"], [class*="file-"]',
      perplexity: '[class*="file-badge"], [class*="attachment"], [class*="file-"]'
    };
    const sel = selectors[platform];
    if (!sel) return true;
    if (document.querySelector(sel)) return true;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.querySelector(sel)) return true;
      await sleep(30);
    }
    return false;
  }

  const INJECTORS = {

    async claude(prompt, contextId) {
      const el = await waitForElement(
        'div.ProseMirror[contenteditable="true"], [contenteditable="true"][data-placeholder], [data-testid="compose-input"] [contenteditable], [contenteditable="true"], textarea'
      );
      if (!el) return { success: false, error: 'Claude input not found' };

      const fileName = contextId ? `context-${contextId}.md` : 'context.md';
      const fileResult = await attachMarkdownFile(prompt, null, fileName);
      const isFileAttached = fileResult.success && (await waitForFileUploadComplete('claude', 1000));

      const payload = isFileAttached
        ? getCompanionMessage(fileName, contextId)
        : formatFileBlockPayload(prompt, fileName, contextId);

      insertTextProgrammatically(el, payload);
      const confirmed = await showPreviewConfirmation(prompt, isFileAttached, fileName);
      if (!confirmed) return { success: false, error: 'Injection cancelled by user' };
      await sleep(300);
      trySubmit(el, 'button[aria-label*="Send"], button[data-testid*="send"], button[aria-label="Send Message"], button[class*="send"]');
      return { success: true };
    },

    async chatgpt(prompt, contextId) {
      const el = await waitForElement(
        '#prompt-textarea, div[contenteditable="true"].ProseMirror, textarea[placeholder], [contenteditable="true"]'
      );
      if (!el) return { success: false, error: 'ChatGPT input not found' };

      const fileName = contextId ? `context-${contextId}.md` : 'context.md';
      const fileResult = await attachMarkdownFile(prompt, null, fileName);
      const isFileAttached = fileResult.success && (await waitForFileUploadComplete('chatgpt', 1000));

      const payload = isFileAttached
        ? getCompanionMessage(fileName, contextId)
        : formatFileBlockPayload(prompt, fileName, contextId);

      insertTextProgrammatically(el, payload);
      const confirmed = await showPreviewConfirmation(prompt, isFileAttached, fileName);
      if (!confirmed) return { success: false, error: 'Injection cancelled by user' };
      await sleep(300);
      trySubmit(el, '[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="Send prompt"], button[data-testid*="send"], button[class*="send"]');
      return { success: true };
    },

    async gemini(prompt, contextId) {
      const el = await waitForElement(
        'rich-textarea div[contenteditable="true"], rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"], div[contenteditable="true"]'
      );
      if (!el) return { success: false, error: 'Gemini input not found' };

      const fileName = contextId ? `context-${contextId}.md` : 'context.md';

      // 1. Reveal file input by triggering Gemini upload button if present
      const uploadBtn = document.querySelector('button[aria-label*="Upload"], button[aria-label*="Add files"], button[aria-label*="file"], uploader-button, button[mattooltip*="Upload"]');
      if (uploadBtn) {
        try { uploadBtn.click(); await sleep(250); } catch (_) {}
      }

      // 2. Attach Markdown file
      const fileResult = await attachMarkdownFile(prompt, 'rich-textarea', fileName);
      const isFileAttached = fileResult.success && (await waitForFileUploadComplete('gemini', 1200));

      // 3. Choose payload: short companion message if native chip attached, otherwise formatted File Block
      const payload = isFileAttached
        ? getCompanionMessage(fileName, contextId)
        : formatFileBlockPayload(prompt, fileName, contextId);

      // 4. Set formatted innerHTML for Gemini Angular contenteditable editor
      el.focus();
      try {
        el.innerHTML = formatGeminiHtml(payload);
      } catch (_) {
        insertTextProgrammatically(el, payload);
      }

      dispatchInputEvents(el);
      try {
        const richTextarea = el.closest('rich-textarea');
        if (richTextarea) dispatchInputEvents(richTextarea);
      } catch (_) {}

      await sleep(200);

      // 5. Show preview confirmation overlay
      const confirmed = await showPreviewConfirmation(prompt, isFileAttached, fileName);
      if (!confirmed) return { success: false, error: 'Injection cancelled by user' };
      await sleep(350);

      // 6. Submit to Gemini
      const submitSelectors = 'button.send-button, button[aria-label*="Send message"], button[aria-label*="Send prompt"], button[aria-label*="Send"], button[mattooltip*="Send"], button.send-button-container, [data-test-id="send-button"], button.submit-button';
      await trySubmit(el, submitSelectors);
      return { success: true };
    },

    async grok(prompt, contextId) {
      const grokSelectors = [
        'textarea[data-testid*="grok"]',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Grok"]',
        'textarea[placeholder*="anything"]',
        'textarea[placeholder*="know"]',
        'textarea[placeholder*="prompt"]',
        'textarea[placeholder*="message"]',
        'div[contenteditable="true"][data-testid*="grok"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'textarea.r-30o5oe',
        'textarea[class*="input"]',
        'form textarea',
        'textarea'
      ].join(', ');

      const el = await waitForElement(grokSelectors, 20, 500);
      if (!el) return { success: false, error: 'Grok input not found' };

      const fileName = contextId ? `context-${contextId}.md` : 'context.md';
      const fileResult = await attachMarkdownFile(prompt, null, fileName);
      const isFileAttached = fileResult.success && (await waitForFileUploadComplete('grok', 1000));

      const payload = isFileAttached
        ? getCompanionMessage(fileName, contextId)
        : formatFileBlockPayload(prompt, fileName, contextId);

      insertTextProgrammatically(el, payload);
      const confirmed = await showPreviewConfirmation(prompt, isFileAttached, fileName);
      if (!confirmed) return { success: false, error: 'Injection cancelled by user' };

      // Re-focus and ensure value binding is active after user clicks send in preview dialog
      el.focus();
      insertTextProgrammatically(el, payload);
      await sleep(350);

      const grokSubmitSelectors = [
        'button[aria-label*="Send"]',
        'button[aria-label*="Submit"]',
        'button[aria-label*="Grok"]',
        'button[aria-label*="Ask"]',
        'button[data-testid*="grok"]',
        'button[data-testid*="send"]',
        'button[data-testid*="submit"]',
        'button[type="submit"]',
        'form button[type="submit"]',
        'button[class*="send"]',
        'button[class*="submit"]',
        'div[role="button"][aria-label*="Send"]',
        'form button'
      ].join(', ');

      await trySubmit(el, grokSubmitSelectors);
      return { success: true };
    },

    async perplexity(prompt, contextId) {
      const el = await waitForElement(
        'textarea[placeholder*="Ask"], textarea[placeholder*="Search"], textarea[class*="textarea"], textarea, [contenteditable="true"]'
      );
      if (!el) return { success: false, error: 'Perplexity input not found' };

      const fileName = contextId ? `context-${contextId}.md` : 'context.md';
      const fileResult = await attachMarkdownFile(prompt, null, fileName);
      const isFileAttached = fileResult.success && (await waitForFileUploadComplete('perplexity', 1000));

      const payload = isFileAttached
        ? getCompanionMessage(fileName, contextId)
        : formatFileBlockPayload(prompt, fileName, contextId);

      insertTextProgrammatically(el, payload);
      const confirmed = await showPreviewConfirmation(prompt, isFileAttached, fileName);
      if (!confirmed) return { success: false, error: 'Injection cancelled by user' };
      await sleep(300);
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
    
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');

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
        background-color: rgba(4, 5, 10, 0.4) !important;
        backdrop-filter: blur(0px) !important;
        -webkit-backdrop-filter: blur(0px) !important;
        transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1),
                    backdrop-filter 0.5s cubic-bezier(0.16, 1, 0.3, 1),
                    -webkit-backdrop-filter 0.5s cubic-bezier(0.16, 1, 0.3, 1) !important;
        will-change: opacity, backdrop-filter !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      
      .halo-container.agent-active {
        opacity: 1 !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
      }

      .halo-container::before {
        content: '' !important;
        position: absolute !important;
        inset: 0 !important;
        box-sizing: border-box !important;
        pointer-events: none !important;
        box-shadow: 
          inset 0 0 100px rgba(0, 0, 0, 0.8),
          inset 0 0 200px rgba(var(--active-rgb), 0.15) !important;
        opacity: 0 !important;
        transition: opacity 0.8s ease !important;
        will-change: opacity !important;
      }

      .halo-container.agent-active::before {
        opacity: 1 !important;
        animation: cc-glow-pulse 4s infinite cubic-bezier(0.4, 0, 0.2, 1) !important;
      }

      .console-card {
        background: linear-gradient(135deg, rgba(22, 26, 33, 0.9) 0%, rgba(13, 16, 21, 0.95) 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.05) !important;
        border-radius: 18px !important;
        padding: 20px 24px !important;
        width: 440px !important;
        position: relative !important;
        box-shadow: 
          0 20px 50px rgba(0, 0, 0, 0.6),
          0 0 0 1px rgba(255, 255, 255, 0.03),
          inset 0 1px 0px rgba(255, 255, 255, 0.08) !important;
        font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif !important;
        color: #ffffff !important;
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 20px !important;
        backdrop-filter: blur(24px) saturate(120%) !important;
        -webkit-backdrop-filter: blur(24px) saturate(120%) !important;
        transform: scale(0.94) translateY(15px) !important;
        opacity: 0 !important;
        transition: transform 0.55s cubic-bezier(0.175, 0.885, 0.32, 1.175),
                    opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                    border-color 0.4s ease,
                    box-shadow 0.4s ease !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
      }

      /* State-specific background ambient glows */
      .console-card::before {
        content: '' !important;
        position: absolute !important;
        inset: 0 !important;
        border-radius: 18px !important;
        background: radial-gradient(circle at 45px 50%, rgba(var(--active-rgb), 0.22) 0%, transparent 60%) !important;
        transition: background 0.4s ease !important;
        pointer-events: none !important;
        z-index: 0 !important;
      }

      .halo-container.agent-active .console-card {
        transform: scale(1) translateY(0) !important;
        opacity: 1 !important;
        box-shadow: 
          0 25px 60px rgba(0, 0, 0, 0.65),
          0 0 40px rgba(var(--active-rgb), 0.14),
          inset 0 1px 0px rgba(255, 255, 255, 0.08) !important;
        border-color: rgba(var(--active-rgb), 0.25) !important;
      }

      /* Concentric Icon Wrapper System */
      .console-icon-wrapper {
        width: 44px !important;
        height: 44px !important;
        border-radius: 50% !important;
        background: rgba(var(--active-rgb), 0.14) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex-shrink: 0 !important;
        transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1) !important;
        z-index: 2 !important;
        box-shadow: 0 0 0 1px rgba(var(--active-rgb), 0.15) !important;
      }

      .console-icon-inner {
        width: 28px !important;
        height: 28px !important;
        border-radius: 50% !important;
        background: rgb(var(--active-rgb)) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        color: #ffffff !important;
        transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1) !important;
        box-shadow: 0 2px 6px rgba(var(--active-rgb), 0.3) !important;
        flex-shrink: 0 !important;
      }

      /* Right Text System */
      .console-text-container {
        display: flex !important;
        flex-direction: column !important;
        gap: 4px !important;
        flex: 1 !important;
        z-index: 2 !important;
      }

      .console-title {
        font-size: 15px !important;
        font-weight: 600 !important;
        color: #ffffff !important;
        line-height: 1.25 !important;
        letter-spacing: -0.1px !important;
        transition: all 0.3s ease !important;
      }

      .console-subtitle {
        font-size: 12.5px !important;
        font-weight: 400 !important;
        color: rgba(255, 255, 255, 0.6) !important;
        line-height: 1.4 !important;
        transition: all 0.3s ease !important;
      }

      /* Animations */
      .cc-spin-icon {
        animation: cc-spin 1.2s linear infinite !important;
      }

      .cc-pulse-icon {
        animation: cc-pulse-scale 1.4s infinite ease-in-out !important;
      }

      .cc-bounce-up-icon {
        animation: cc-bounce-up 1s infinite ease-in-out !important;
      }

      .cc-sparkle-icon {
        animation: cc-sparkle 1.4s infinite ease-in-out !important;
      }

      .cc-bounce-icon {
        animation: cc-pop-check 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards !important;
      }

      .cc-shake-icon {
        animation: cc-shake 0.45s ease-in-out forwards !important;
      }

      @keyframes cc-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      @keyframes cc-pulse-scale {
        0%, 100% { transform: scale(0.92); opacity: 0.85; }
        50% { transform: scale(1.08); opacity: 1; }
      }

      @keyframes cc-bounce-up {
        0%, 100% { transform: translateY(1.5px); }
        50% { transform: translateY(-2.5px); }
      }

      @keyframes cc-sparkle {
        0%, 100% { transform: scale(0.9); filter: drop-shadow(0 0 1px rgba(var(--active-rgb), 0.3)); }
        50% { transform: scale(1.15); filter: drop-shadow(0 0 5px rgba(var(--active-rgb), 0.7)); }
      }

      @keyframes cc-pop-check {
        0% { transform: scale(0.6); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }

      @keyframes cc-shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-3px); }
        40%, 80% { transform: translateX(3px); }
      }

      @keyframes cc-glow-pulse {
        0%, 100% { opacity: 0.35 !important; }
        50% { opacity: 0.65 !important; }
      }
    `;
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'halo-container';
    
    const consoleCard = document.createElement('div');
    consoleCard.className = 'console-card';
    consoleCard.style.setProperty('--active-rgb', '59, 130, 246');
    
    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'console-icon-wrapper';
    
    const iconInner = document.createElement('div');
    iconInner.className = 'console-icon-inner';
    iconWrapper.appendChild(iconInner);
    
    const textContainer = document.createElement('div');
    textContainer.className = 'console-text-container';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'console-title';
    
    const subtitleDiv = document.createElement('div');
    subtitleDiv.className = 'console-subtitle';
    
    textContainer.appendChild(titleDiv);
    textContainer.appendChild(subtitleDiv);
    
    consoleCard.appendChild(iconWrapper);
    consoleCard.appendChild(textContainer);
    container.appendChild(consoleCard);
    shadow.appendChild(container);

    const STATES = {
      detecting: {
        rgb: '59, 130, 246',
        title: 'Analyzing Platform',
        subtitle: 'Analyzing LLM workspace environment layout...',
        icon: `
          <svg class="cc-spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" opacity="0.3"></circle>
            <path d="M12 2a10 10 0 0 1 10 10"></path>
          </svg>
        `
      },
      locating: {
        rgb: '139, 92, 246',
        title: 'Aligning History',
        subtitle: 'Scrolling chat viewport to locate conversation start...',
        icon: `
          <svg class="cc-bounce-up-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <polyline points="5 11 12 4 19 11"></polyline>
          </svg>
        `
      },
      scraping: {
        rgb: '6, 182, 212',
        title: 'Parsing Dialogue',
        subtitle: 'Extracting dialogue turns and rich structural Markdown...',
        icon: `
          <svg class="cc-pulse-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
        `
      },
      formatting: {
        rgb: '245, 158, 11',
        title: 'Synthesizing Context',
        subtitle: 'Compiling and optimizing context data structures...',
        icon: `
          <svg class="cc-sparkle-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z"></path>
          </svg>
        `
      },
      completed: {
        rgb: '16, 185, 129',
        title: 'Scraped Successfully',
        subtitle: 'Conversation context fully prepared for handoff.',
        icon: `
          <svg class="cc-bounce-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `
      },
      failed: {
        rgb: '239, 68, 68',
        title: 'Scraping Failed',
        subtitle: 'No conversation elements detected on this page.',
        icon: `
          <svg class="cc-shake-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `
      }
    };

    function setStepState(stateKey, customSubtitle = null) {
      const config = STATES[stateKey];
      if (!config) return;
      
      consoleCard.style.setProperty('--active-rgb', config.rgb);
      iconInner.innerHTML = config.icon;
      titleDiv.textContent = config.title;
      subtitleDiv.textContent = customSubtitle || config.subtitle;
    }

    // Set initial state
    setStepState('detecting');

    requestAnimationFrame(() => {
      container.classList.add('agent-active');
    });

    let isFinished = false;

    function cleanup() {
      container.classList.remove('agent-active');
      setTimeout(() => {
        if (host.parentNode) {
          host.remove();
        }
      }, 450);
    }

    return {
      setState: (stateKey) => {
        setStepState(stateKey);
      },
      success: () => {
        isFinished = true;
        setStepState('completed');
        setTimeout(cleanup, 1200);
      },
      fail: (errorMsg) => {
        isFinished = true;
        setStepState('failed', errorMsg);
        setTimeout(cleanup, 4500);
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
    const idVal = context.id || 'con_01';
    const idTag = `# 📄 Cross-Context Knowledge Transfer — Context ID: \`${idVal}\`

> ⚠️ **SYSTEM INSTRUCTION FOR RECEIVING AI MODEL**:
> This file contains an exported context snapshot identified by **Context ID: \`${idVal}\`**.
> Use this **Context ID (\`${idVal}\`)** to uniquely identify, track, and differentiate this project history and state from any other context files (e.g. \`con_01\`, \`con_02\`, \`con_03\`). Do not mix up memory states across different Context IDs.

---

`;

    const srcName = PLATFORM_NAMES[context.platform] || context.platform;
    const transcriptSection = Array.isArray(context.messages) && context.messages.length > 0
      ? `\n\n---\n\n## 💬 Full Conversation Transcript\n\n` + context.messages.map(m => {
          const roleHeader = m.role === 'user' ? '### 👤 User' : `### 🤖 ${srcName}`;
          return `${roleHeader}\n${m.content}`;
        }).join('\n\n')
      : '';

    if (context.aiEnhanced && context.aiStatus === 'success') {
      const src = srcName;
      const e = context.aiEnhanced;
      const summary = e.project_summary || '';
      const task = e.current_task || '';
      const intent = e.user_intent || '';
      const tech = Array.isArray(e.technical_stack) ? e.technical_stack.join(', ') : '';
      const decisions = Array.isArray(e.architecture_decisions)
        ? e.architecture_decisions.map(pt => `• ${pt}`).join('\n')
        : '';
      const constraints = Array.isArray(e.constraints) ? e.constraints.join(', ') : '';
      const files = Array.isArray(e.files_mentioned) ? e.files_mentioned.join(', ') : '';
      const pending = Array.isArray(e.pending_tasks) ? e.pending_tasks.map(pt => `• ${pt}`).join('\n') : '';
      const handoff = e.handoffPrompt || '';

      // List builders helper
      const bulletJoin = (arr) => (Array.isArray(arr) && arr.length) ? arr.map(x => `• ${x}`).join('\n') : 'None recorded';
      const codeBlocksJoin = (arr) => {
        if (!Array.isArray(arr) || !arr.length) return 'No snippets recorded';
        return arr.map((code, i) => `--- Snippet #${i + 1} ---\n${code}`).join('\n\n');
      };

      // Detect Dominant Intent
      const types = Array.isArray(e.conversation_type) ? e.conversation_type.map(t => t.toLowerCase()) : [];
      let dominantIntent = 'general';
      if (types.includes('coding') || types.includes('architecture design')) {
        dominantIntent = 'coding';
      } else if (types.includes('debugging')) {
        dominantIntent = 'debugging';
      } else if (types.includes('brainstorming') || types.includes('planning')) {
        dominantIntent = 'brainstorming';
      } else if (types.includes('research') || types.includes('studying')) {
        dominantIntent = 'research';
      } else if (types.includes('writing')) {
        dominantIntent = 'writing';
      }

      const divider = '═'.repeat(60);

      if (dominantIntent === 'coding') {
        return `[🔄 AI-Enhanced Cross Context Transfer — Coding Briefing]
${idTag}I was working on a coding project with ${src}. Here is where we left off:

📁 What I was building:
- Project Summary: ${summary}
- Tech Stack: ${tech}
- Target Files: ${files}

🛠️ Key Code & Configurations:
${codeBlocksJoin(e.important_code)}

🔑 Key decisions made so far:
${decisions}

⚠️ Constraints & Limits:
${constraints}

🎯 What I was working toward:
- Objective: ${task}
- Specific Intent: ${intent}

📋 Tasks I was working on:
${pending}

🚀 Please continue from:
${handoff}${transcriptSection}`;
      }

      if (dominantIntent === 'debugging') {
        return `[🔄 AI-Enhanced Cross Context Transfer — Debugging Briefing]
${idTag}I was working on debugging an issue with ${src}. Here is where we left off:

📁 What I was building & testing:
- Project Summary: ${summary}
- Tech Stack: ${tech}
- Target Files: ${files}

🛠️ Error-Prone Code Snippets:
${codeBlocksJoin(e.important_code)}

❌ What I was stuck on:
- Core Debugging Target: ${task}
- Intent: ${intent}
- Tracked Errors & Issues:
${bulletJoin(e.errors_and_issues)}

💡 Attempted Solves & Solutions:
- Failed Attempts:
${bulletJoin(e.failed_attempts)}
- Successful Solutions:
${bulletJoin(e.successful_solutions)}

🚀 Please continue from:
${handoff}${transcriptSection}`;
      }

      if (dominantIntent === 'brainstorming') {
        return `[🔄 AI-Enhanced Cross Context Transfer — Brainstorming Briefing]
${idTag}I was brainstorming and planning with ${src}. Here is where we left off:

📁 What I was building/planning:
- Core Topic/Overview: ${summary}
- Referenced Files: ${files || 'None recorded'}

💡 Key concepts & ideas developed:
${bulletJoin(e.deduplicated_context)}

🧠 Long term project memory:
${bulletJoin(e.long_term_memory)}

🔑 Key decisions made so far:
${decisions}

⚠️ Constraints & Limits:
${constraints}

🎯 What I was working toward:
- Target Objective: ${task}
- Intent/Vision: ${intent}

📋 Tasks I was working on:
${pending}

🚀 Please continue from:
${handoff}${transcriptSection}`;
      }

      if (dominantIntent === 'research') {
        return `[🔄 AI-Enhanced Cross Context Transfer — Research Briefing]
${idTag}I was researching and studying with ${src}. Here is where we left off:

📁 What I was researching:
- Research Focus: ${summary}
- Referenced Files & Sources: ${files || 'None recorded'}

💡 Core concepts discovered:
${bulletJoin(e.deduplicated_context)}

🧠 Long term project memory:
${bulletJoin(e.long_term_memory)}

🤖 AI-inferred insights:
${bulletJoin(e.ai_inferred_context)}

⚙️ My preferences:
${bulletJoin(e.user_preferences)}

🎯 What I was working toward:
- Focus Area: ${task}
- Knowledge Goal: ${intent}

🚀 Please continue from:
${handoff}${transcriptSection}`;
      }

      if (dominantIntent === 'writing') {
        return `[🔄 AI-Enhanced Cross Context Transfer — Writing Briefing]
${idTag}I was drafting and composing text with ${src}. Here is where we left off:

📁 What I was writing:
- Narrative/Content Overview: ${summary}
- Referenced Documents: ${files || 'None recorded'}

💡 Synthesized ideas & guidelines:
${bulletJoin(e.deduplicated_context)}

⚙️ My style preferences:
${bulletJoin(e.user_preferences)}

🎯 What I was working toward:
- Current Target: ${task}
- Creative Intent: ${intent}

📋 Next composition steps:
${pending}

🚀 Please continue from:
${handoff}${transcriptSection}`;
      }

      // General fallback
      return `[🔄 AI-Enhanced Cross Context Transfer — Briefing]
${idTag}I was working on a project with ${src}. Here is where we left off:

📁 What I was building:
- Project Summary: ${summary}
- Tech Stack & Active Files: Stack: ${tech} | Files: ${files}

🔑 Key decisions made so far:
${decisions}

⚠️ Constraints & Limits:
${constraints}

🎯 What I was working toward:
- Task: ${task}
- Intent: ${intent}

📋 Tasks I was working on:
${pending}

🚀 Please continue from:
${handoff}${transcriptSection}`;
    }

    // ──────────────────────────────────────────────────────────────
    // DETERMINISTIC FALLBACK — Run Memory Graph & Deduplication Engine locally
    // ──────────────────────────────────────────────────────────────
    class LocalContextIntelligenceEngine {
      constructor() {
        this.nodes = new Map();
        this.edges = [];
        this.priorityMemories = [];
        this.executionContext = {
          topicsDiscussed: new Set(),
          solvedProblems: new Set(),
          failedApproaches: new Set(),
          currentFocus: ''
        };
      }

      scoreMessage(content, role) {
        if (!content) return 0;
        const hasCode = content.includes('```');
        const highPatterns = [
          /requirement/i, /architecture/i, /technical decision/i, /tech stack/i,
          /todo/i, /active task/i, /unresolved/i, /error/i, /bug/i, /exception/i,
          /debugging/i, /blocker/i, /user preference/i, /conventions/i, /decision/i,
          /how to/i, /solves/i, /fails/i, /attempt/i, /config/i
        ];
        const lowPatterns = [
          /^hello/i, /^hi /i, /^hey/i, /thanks/i, /thank you/i, /awesome/i,
          /perfect/i, /ok/i, /confirm/i, /^yes$/i, /filler/i, /conversation fluff/i,
          /helpful assistant/i
        ];
        let score = 5;
        if (role === 'user') score += 1;
        if (hasCode) score += 3;
        let highMatchCount = 0;
        highPatterns.forEach(pat => { if (pat.test(content)) highMatchCount++; });
        score += Math.min(highMatchCount * 1.5, 4);
        let lowMatchCount = 0;
        lowPatterns.forEach(pat => { if (pat.test(content)) lowMatchCount++; });
        score -= Math.min(lowMatchCount * 2, 4);
        return Math.max(1, Math.min(10, Math.round(score)));
      }

      calculateJaccard(str1, str2) {
        const getWords = (str) => new Set(str.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
        const set1 = getWords(str1);
        const set2 = getWords(str2);
        if (set1.size === 0 || set2.size === 0) return 0;
        let intersection = 0;
        for (const item of set1) { if (set2.has(item)) intersection++; }
        const union = set1.size + set2.size - intersection;
        return intersection / union;
      }

      deduplicateItems(items) {
        const canonicalList = [];
        items.forEach(item => {
          if (!item || item.trim().length < 5) return;
          let merged = false;
          for (let i = 0; i < canonicalList.length; i++) {
            const canonical = canonicalList[i];
            const similarity = this.calculateJaccard(item, canonical);
            const isSub1 = item.toLowerCase().includes(canonical.toLowerCase()) && item.length < canonical.length * 2;
            const isSub2 = canonical.toLowerCase().includes(item.toLowerCase()) && canonical.length < item.length * 2;
            if (similarity > 0.45 || isSub1 || isSub2) {
              if (item.length > canonical.length) { canonicalList[i] = item; }
              merged = true;
              break;
            }
          }
          if (!merged) { canonicalList.push(item); }
        });
        return canonicalList;
      }

      addNode(id, type, label, properties = {}) {
        if (!this.nodes.has(id)) { this.nodes.set(id, { type, label, properties }); }
      }

      addEdge(from, to, type) {
        const exists = this.edges.some(e => e.from === from && e.to === to && e.type === type);
        if (!exists && this.nodes.has(from) && this.nodes.has(to)) { this.edges.push({ from, to, type }); }
      }

      processConversation(messages) {
        let messageIndex = 0;
        this.addNode('project_root', 'PROJECT', 'Active Working Project', { description: 'Target transfer workspace' });

        messages.forEach(msg => {
          const content = msg.content || '';
          const role = msg.role || 'user';
          const score = this.scoreMessage(content, role);
          const msgId = `msg_${messageIndex++}`;

          if (content.toLowerCase().includes('solved') || content.toLowerCase().includes('fixed') || content.toLowerCase().includes('working now')) {
            const sentenceMatch = content.match(/[^.!?]*?(?:solved|fixed)[^.!?]*/i);
            if (sentenceMatch) this.executionContext.solvedProblems.add(sentenceMatch[0].trim());
          }
          if (content.toLowerCase().includes('avoid') || content.toLowerCase().includes('failed') || content.toLowerCase().includes('do not repeat')) {
            const sentenceMatch = content.match(/[^.!?]*?(?:avoid|failed)[^.!?]*/i);
            if (sentenceMatch) this.executionContext.failedApproaches.add(sentenceMatch[0].trim());
          }

          if (score >= 6) {
            this.priorityMemories.push({
              content: content.length > 150 ? content.substring(0, 150) + '...' : content,
              priority_score: score,
              priority_reason: role === 'user' ? 'Direct user requirement' : 'Developer instructions'
            });
          }

          const techKeywords = ['react', 'next.js', 'node', 'vue', 'chrome extension', 'javascript', 'typescript', 'rust', 'actix-web', 'sqlx', 'css', 'vanilla css', 'flexbox', 'html', 'gemini', 'gemini api', 'tailwind'];
          techKeywords.forEach(tech => {
            if (content.toLowerCase().includes(tech)) {
              const techId = `tech_${tech.replace(/\s+/g, '_')}`;
              this.addNode(techId, 'TECH_STACK', tech.toUpperCase(), { name: tech });
              this.addEdge(techId, 'project_root', 'IMPLEMENTED_WITH');
              this.executionContext.topicsDiscussed.add(tech);
            }
          });

          if (content.toLowerCase().includes('todo') || content.toLowerCase().includes('task') || content.toLowerCase().includes('objective')) {
            const sentences = content.split(/[.!?\n]/);
            sentences.forEach((s, idx) => {
              if (s.toLowerCase().includes('todo') || s.toLowerCase().includes('task') || s.toLowerCase().includes('objective')) {
                const taskId = `${msgId}_task_${idx}`;
                const cleanLabel = s.replace(/[-*•]/g, '').trim();
                if (cleanLabel.length > 10) {
                  this.addNode(taskId, 'TASK', cleanLabel, { status: 'active' });
                  this.addEdge(taskId, 'project_root', 'DEPENDS_ON');
                }
              }
            });
          }

          if (content.toLowerCase().includes('decided') || content.toLowerCase().includes('let\'s use') || content.toLowerCase().includes('we will use')) {
            const sentences = content.split(/[.!?\n]/);
            sentences.forEach((s, idx) => {
              if (s.toLowerCase().includes('decided') || s.toLowerCase().includes('use')) {
                const decId = `${msgId}_dec_${idx}`;
                const cleanLabel = s.replace(/[-*•]/g, '').trim();
                if (cleanLabel.length > 10) {
                  this.addNode(decId, 'DECISION', cleanLabel);
                  this.addEdge(decId, 'project_root', 'RELATED_TO');
                }
              }
            });
          }

          if (content.toLowerCase().includes('error') || content.toLowerCase().includes('bug') || content.toLowerCase().includes('fail')) {
            const sentences = content.split(/[.!?\n]/);
            sentences.forEach((s, idx) => {
              if (s.toLowerCase().includes('error') || s.toLowerCase().includes('bug') || s.toLowerCase().includes('fail')) {
                const issueId = `${msgId}_issue_${idx}`;
                const cleanLabel = s.replace(/[-*•]/g, '').trim();
                if (cleanLabel.length > 10) {
                  this.addNode(issueId, 'ISSUE', cleanLabel);
                  this.addEdge(issueId, 'project_root', 'BLOCKED_BY');
                }
              }
            });
          }
        });

        const rawMemories = this.priorityMemories.map(m => m.content);
        const dedupedMemories = this.deduplicateItems(rawMemories);
        this.priorityMemories = this.priorityMemories.filter(m => dedupedMemories.includes(m.content));
      }

      getStructuredPacket() {
        return {
          system_context: 'Deterministic State Restoration & Continuity Protocol — Version 2.0',
          priority_memory: this.priorityMemories.map(m => `[Score ${m.priority_score}/10] ${m.content}`).slice(0, 8),
          active_tasks: Array.from(this.nodes.values()).filter(n => n.type === 'TASK').map(n => n.label),
          unresolved_issues: Array.from(this.nodes.values()).filter(n => n.type === 'ISSUE').map(n => n.label),
          important_decisions: Array.from(this.nodes.values()).filter(n => n.type === 'DECISION').map(n => n.label),
          execution_context: {
            topics_discussed: Array.from(this.executionContext.topicsDiscussed),
            problems_solved: Array.from(this.executionContext.solvedProblems),
            approaches_to_avoid: Array.from(this.executionContext.failedApproaches),
            current_focus: Array.from(this.nodes.values()).filter(n => n.type === 'TASK').map(n => n.label)[0] || 'General System Implementation'
          },
          user_preferences: Array.from(this.nodes.values()).filter(n => n.type === 'PREFERENCE').map(n => n.label)
        };
      }
    }

    const localEngine = new LocalContextIntelligenceEngine();
    localEngine.processConversation(context.messages);
    const packet = localEngine.getStructuredPacket();

    const src = PLATFORM_NAMES[context.platform] || context.platform;
    const firstUser = context.messages.find(m => m.role === 'user');
    const handoffHint = firstUser ? firstUser.content : 'Continue active working session';
    const handoffTruncated = handoffHint.length > 300 ? handoffHint.substring(0, 300) + '...' : handoffHint;

    return `[🔄 Cross Context Transfer — State Restoration Briefing]
${idTag}I was working on a project with ${src}. Here is where we left off:

⚙️ What I was building:
- System Context: ${packet.system_context}
- Active Execution Context:
  - Current Focus Area: ${packet.execution_context.current_focus}
  - Core Topics Discussed: ${packet.execution_context.topics_discussed.join(', ') || 'None'}
  - Solved Problems & Closed Issues:
${packet.execution_context.problems_solved.map(p => `  ✓ ${p}`).join('\n') || '  None'}
  - Failed Approaches to Avoid:
${packet.execution_context.approaches_to_avoid.map(a => `  ⚠️ ${a}`).join('\n') || '  None'}

🧠 Distilled priority specifications:
${packet.priority_memory.map(m => `• ${m}`).join('\n') || 'None recorded'}

🔑 Key decisions made so far:
${packet.important_decisions.map(d => `• ${d}`).join('\n') || 'None recorded'}

❌ What I was stuck on (Unresolved Issues):
${packet.unresolved_issues.map(i => `• ${i}`).join('\n') || 'None active'}

⚙️ My preferences:
${packet.user_preferences.map(p => `• ${p}`).join('\n') || 'None configured'}

🎯 Tasks I was working on:
${packet.active_tasks.map(t => `[ ] ${t}`).join('\n') || 'No pending tasks'}

🚀 Please continue from:
${handoffTruncated}

---
Please acknowledge these details. Tell me what tasks you are taking over, and ask me what we should focus on next to continue seamlessly.${transcriptSection}`;
  }

  // ════════════════════════════════════════════
  // PAGE-LEVEL DRAG & DROP — drop context onto this LLM page
  // ════════════════════════════════════════════

  let dropOverlayHost = null;
  let dropOverlayShadow = null;
  let dragEnterCount = 0; // counter to handle child dragenter/dragleave

  const PLATFORM_COLORS = {
    claude:     { primary: '#d97752', rgb: '217, 119, 82', glow: 'rgba(217, 119, 82, 0.35)', bg: 'rgba(217, 119, 82, 0.06)' },
    chatgpt:    { primary: '#10b981', rgb: '16, 185, 129', glow: 'rgba(16, 185, 129, 0.35)',  bg: 'rgba(16, 185, 129, 0.06)' },
    gemini:     { primary: '#3b82f6', rgb: '59, 130, 246', glow: 'rgba(59, 130, 246, 0.35)',  bg: 'rgba(59, 130, 246, 0.06)' },
    grok:       { primary: '#f4f4f5', rgb: '244, 244, 245', glow: 'rgba(244, 244, 245, 0.25)', bg: 'rgba(244, 244, 245, 0.04)' },
    perplexity: { primary: '#0ea5e9', rgb: '14, 165, 233', glow: 'rgba(14, 165, 233, 0.35)',  bg: 'rgba(14, 165, 233, 0.06)' },
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

  function runInjectionAnimation(srcPlatform) {
    createDropOverlay(srcPlatform);
    
    const ol = getOverlayEl();
    const iconEl  = dropOverlayShadow?.getElementById('cc-drop-icon');
    const titleEl = dropOverlayShadow?.getElementById('cc-drop-title');
    const subEl   = dropOverlayShadow?.getElementById('cc-drop-subtitle');
    const arrowEl = dropOverlayShadow?.getElementById('cc-drop-arrow');

    if (ol) {
      ol.classList.remove('over');
      ol.classList.add('injecting');
    }
    if (arrowEl) arrowEl.innerHTML  = SPINNER_SVG;
    if (titleEl) titleEl.textContent = 'Injecting...';
    if (subEl) {
      const srcName = PLATFORM_NAMES[srcPlatform] || srcPlatform;
      subEl.innerHTML = `Transferring context from <strong>${srcName}</strong>…`;
    }

    return {
      success: (tgtPlatform) => {
        if (ol) {
          ol.classList.remove('injecting');
          ol.classList.add('success');
        }
        if (arrowEl) arrowEl.innerHTML  = CHECK_SVG;
        if (titleEl) titleEl.textContent = 'Context injected!';
        if (subEl) {
          const srcName = PLATFORM_NAMES[srcPlatform] || srcPlatform;
          subEl.innerHTML = `From <strong style="color:#34d399">${srcName}</strong> — submitted to this chat.`;
        }
        setTimeout(removeDropOverlay, 2000);
      },
      fail: (errorMsg) => {
        if (ol) {
          ol.classList.remove('injecting');
          ol.classList.add('error-state');
        }
        if (arrowEl) arrowEl.innerHTML  = ERROR_SVG;
        if (titleEl) titleEl.textContent = 'Injection failed';
        if (subEl)   subEl.textContent   = errorMsg || 'An unexpected error occurred.';
        setTimeout(removeDropOverlay, 3500);
      }
    };
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

    // 1) Try dataTransfer
    try {
      const raw = e.dataTransfer?.getData('text/x-cross-context');
      if (raw) contextId = JSON.parse(raw).id;
    } catch (_) {}

    try {
      plainText = e.dataTransfer?.getData('text/plain') || null;
      if (plainText) {
        // Extract context ID if embedded in text (e.g. Context ID: `con_02`)
        const idMatch = plainText.match(/Context ID:\s*[`"]?([a-zA-Z0-9_-]+)[`"]?/i);
        if (idMatch && !contextId) contextId = idMatch[1];
        if (!contextId && !plainText.includes('Cross-Context') && !plainText.includes('Cross Context')) {
          contextId = plainText.trim();
        }
      }
    } catch (_) {}

    // 2) Prefer storage from popup dragstart
    try {
      const { pendingDrop } = await chrome.storage.local.get('pendingDrop');
      if (pendingDrop?.id && Date.now() - pendingDrop.timestamp < 30000) {
        contextId = pendingDrop.id;
      }
    } catch (_) {}

    const hasFallbackText = plainText && (plainText.includes('Cross-Context') || plainText.includes('Cross Context'));
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

      // Format and inject (pass contextId explicitly!)
      const result = await injector(formatted, contextId);
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

          // Wait for DOM to settle
          await waitForDomSettled(document.body, 150, 1200);

          // Handle virtualized / lazy-loaded scroll containers
          const chatRoot = document.querySelector(
            'main, [role="main"], [role="log"], [class*="conversation"], [class*="chat-window"]'
          );
          anim.setState('locating');
          await scrollToLoadAll(chatRoot);

          anim.setState('scraping');
          const scraper = SCRAPERS[platform];
          if (!scraper) {
            anim.fail('Unsupported platform');
            sendResponse({ success: false, error: `No scraper for platform: ${platform}` });
            return;
          }

          await sleep(30);
          const { messages, title } = scraper();
          
          anim.setState('formatting');

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
          
          await sleep(40);
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

    // Respond to PING from background for poll-based injection readiness
    if (message.type === 'PING') {
      sendResponse({ alive: true });
      return true;
    }

    if (message.type === 'DO_INJECT') {
      if (isInjectionActive) {
        sendResponse({ success: true, info: 'Injection already in progress or completed' });
        return true;
      }
      isInjectionActive = true;

      const injector = INJECTORS[message.targetPlatform];
      if (!injector) {
        isInjectionActive = false;
        sendResponse({ success: false, error: `No injector for: ${message.targetPlatform}` });
        return true;
      }
      const anim = runInjectionAnimation(message.context.platform);
      const formatted = formatContextPrompt(message.context, message.targetPlatform);
      injector(formatted, message.context?.id).then(result => {
        if (result?.success) {
          anim.success(message.targetPlatform);
        } else {
          isInjectionActive = false;
          anim.fail(result?.error || 'Injection failed');
        }
        chrome.storage.local.remove('pendingInjection');
        sendResponse(result);
      }).catch(err => {
        isInjectionActive = false;
        anim.fail(err.message || 'Injection failed');
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
    if (isInjectionActive) return;
    try {
      const { pendingInjection } = await chrome.storage.local.get('pendingInjection');
      if (!pendingInjection) return;

      const { context, targetPlatform, timestamp } = pendingInjection;
      const isRecent = Date.now() - timestamp < 30000;
      const isTarget = targetPlatform === platform;

      if (!isRecent || !isTarget) return;

      isInjectionActive = true; // Lock immediately!

      const injector = INJECTORS[targetPlatform];
      if (!injector) {
        isInjectionActive = false;
        return;
      }

      const anim = runInjectionAnimation(context.platform);
      const formatted = formatContextPrompt(context, targetPlatform);
      
      try {
        const result = await injector(formatted, context.id);
        if (result?.success) {
          anim.success(targetPlatform);
        } else {
          isInjectionActive = false;
          anim.fail(result?.error || 'Injection failed');
        }
      } catch (err) {
        isInjectionActive = false;
        anim.fail(err.message || 'Injection failed');
      }

      await chrome.storage.local.remove('pendingInjection');

    } catch (err) {
      isInjectionActive = false;
      console.error('Cross Context: Auto-inject failed:', err);
    }
  }

  // Run auto-inject check on page load immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingInjection);
  } else {
    checkPendingInjection();
  }

})();
