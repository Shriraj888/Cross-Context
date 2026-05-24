// Cross Context — ChatGPT Scraper
// Scrapes conversation from chatgpt.com

let isSessionActive = false;
let tempStyle = null;

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

function getInnerText(el) {
  if (!el) return '';
  const wasActive = isSessionActive;
  if (!wasActive) startScrapingSession();
  const text = (el.innerText || el.textContent || '').trim();
  if (!wasActive) endScrapingSession();
  return text;
}

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

function hasBothRoles(msgs) {
  return msgs.some(m => m.role === 'user' && m.content.trim()) && msgs.some(m => m.role === 'assistant' && m.content.trim());
}

function deduplicate(messages) {
  return messages.filter((msg, i) => {
    if (i === 0) return true;
    return !(msg.role === messages[i-1].role && msg.content === messages[i-1].content);
  });
}

/**
 * Determine the role of a DOM element by walking up through its ancestors
 * looking for the closest data-message-author-role attribute.
 */
function getRoleFromAncestor(el) {
  let cur = el;
  while (cur && cur !== document.body) {
    const role = cur.getAttribute('data-message-author-role');
    if (role === 'user' || role === 'assistant') return role;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Extract text content from a message container, preferring the inner
 * markdown/prose element for assistant messages for cleaner output.
 */
function extractMessageText(container, role) {
  if (role === 'assistant') {
    // For assistant messages, prefer the markdown-rendered content
    const inner = container.querySelector('.markdown, [class*="prose"], [class*="markdown"]');
    if (inner) return getInnerText(inner);
  }
  if (role === 'user') {
    // For user messages, prefer the whitespace-pre-wrap div (plain text prompt)
    const inner = container.querySelector('.whitespace-pre-wrap, [class*="whitespace-pre-wrap"]');
    if (inner) return getInnerText(inner);
  }
  return getInnerText(container);
}

export function scrapeConversation() {
  try {
    startScrapingSession();

    const chatTitle = () =>
      document.title.replace(/[-–|]?\s*ChatGPT.*$/i, '').trim() || 'ChatGPT Conversation';

    // ══════════════════════════════════════════════════════════════════════
    // Strategy 1: Direct data-message-author-role attribute (MOST RELIABLE)
    // ══════════════════════════════════════════════════════════════════════
    // ChatGPT marks every message container with data-message-author-role="user"|"assistant".
    // Read the role straight from the attribute — no guessing needed.
    const roleEls = [...document.querySelectorAll('[data-message-author-role]')].filter(filterInputArea);
    if (roleEls.length > 0) {
      const msgs = [];
      for (const el of roleEls) {
        const role = el.getAttribute('data-message-author-role');
        if (role !== 'user' && role !== 'assistant') continue;
        const content = extractMessageText(el, role);
        if (content.length > 3) {
          msgs.push({ role, content });
        }
      }
      if (hasBothRoles(msgs)) {
        return {
          success: true,
          context: {
            platform: 'chatgpt',
            title: chatTitle(),
            messages: deduplicate(msgs),
            url: window.location.href,
          }
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Strategy 2: Article-based conversation turns
    // ══════════════════════════════════════════════════════════════════════
    // ChatGPT wraps each turn in <article data-testid="conversation-turn-N">.
    // Inside each article, find the role attribute and extract text.
    const articles = [...document.querySelectorAll('article')].filter(filterInputArea);
    if (articles.length > 0) {
      const msgs = [];
      for (const art of articles) {
        // Look for role indicator inside the article
        const roleEl = art.querySelector('[data-message-author-role]');
        if (roleEl) {
          const role = roleEl.getAttribute('data-message-author-role');
          if (role !== 'user' && role !== 'assistant') continue;
          const content = extractMessageText(art, role);
          if (content.length > 3) {
            msgs.push({ role, content });
          }
        }
      }
      if (hasBothRoles(msgs)) {
        return {
          success: true,
          context: {
            platform: 'chatgpt',
            title: chatTitle(),
            messages: deduplicate(msgs),
            url: window.location.href,
          }
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Strategy 3: Walk the main chat container, determine role per child
    // ══════════════════════════════════════════════════════════════════════
    // Find the main scrollable chat area and iterate its direct children.
    // For each child, check if it contains a data-message-author-role attribute.
    const mainEl = document.querySelector('main') || document.querySelector('[role="main"]');
    if (mainEl) {
      // Find the deepest container that holds multiple conversation turn articles/divs
      let chatContainer = mainEl;
      const articleInMain = mainEl.querySelectorAll('article, [data-message-author-role]');
      if (articleInMain.length > 0) {
        // Find common parent of all articles
        let lca = articleInMain[0].parentElement;
        while (lca && lca !== mainEl) {
          const containsAll = [...articleInMain].every(a => lca.contains(a));
          if (containsAll && lca.children.length > 1) {
            chatContainer = lca;
            break;
          }
          lca = lca.parentElement;
        }
      }

      const msgs = [];
      for (const child of chatContainer.children) {
        // Check for role attribute anywhere inside this child
        const roleEl = child.querySelector('[data-message-author-role]') ||
                        (child.hasAttribute('data-message-author-role') ? child : null);
        if (!roleEl) continue;

        const role = roleEl.getAttribute('data-message-author-role');
        if (role !== 'user' && role !== 'assistant') continue;

        const content = extractMessageText(child, role);
        if (content.length > 3) {
          msgs.push({ role, content });
        }
      }

      if (hasBothRoles(msgs)) {
        return {
          success: true,
          context: {
            platform: 'chatgpt',
            title: chatTitle(),
            messages: deduplicate(msgs),
            url: window.location.href,
          }
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Strategy 4: Heuristic — find user prompts via whitespace-pre-wrap,
    //             find assistant responses via .markdown/.prose siblings
    // ══════════════════════════════════════════════════════════════════════
    // Only reach here if data-message-author-role is completely absent.
    const allWhitespace = [...document.querySelectorAll('.whitespace-pre-wrap, [class*="whitespace-pre-wrap"]')].filter(filterInputArea);
    const allMarkdown = [...document.querySelectorAll('.markdown, [class*="prose"]')].filter(filterInputArea);

    // Filter: whitespace-pre-wrap elements that are NOT inside a .markdown or .prose container are user prompts
    const userBubbles = allWhitespace.filter(el => {
      return !el.closest('.markdown') && !el.closest('[class*="prose"]') && !el.closest('[class*="markdown"]');
    });
    // Filter: markdown/prose elements that are NOT inside a user prompt element
    const assistantBubbles = allMarkdown.filter(el => {
      return !userBubbles.some(ub => ub.contains(el));
    });

    if (userBubbles.length > 0 && assistantBubbles.length > 0) {
      // Interleave by DOM order
      const combined = [
        ...userBubbles.map(el => ({ el, role: 'user' })),
        ...assistantBubbles.map(el => ({ el, role: 'assistant' })),
      ];
      combined.sort((a, b) => {
        const pos = a.el.compareDocumentPosition(b.el);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });

      const msgs = combined
        .map(({ el, role }) => ({ role, content: getInnerText(el) }))
        .filter(m => m.content.length > 5);

      if (hasBothRoles(msgs)) {
        return {
          success: true,
          context: {
            platform: 'chatgpt',
            title: chatTitle(),
            messages: deduplicate(msgs),
            url: window.location.href,
          }
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Strategy 5: Absolute last resort — alternate blocks from main
    // ══════════════════════════════════════════════════════════════════════
    const fallback = [];
    const blocks = document.querySelectorAll('main > div > div > div');
    let lastRole = null;
    blocks.forEach(el => {
      if (!filterInputArea(el)) return;
      const text = getInnerText(el);
      if (text.length < 20) return;
      const role = lastRole === 'user' ? 'assistant' : 'user';
      lastRole = role;
      fallback.push({ role, content: text });
    });

    if (fallback.length === 0) {
      return { success: false, error: 'No conversation found. Make sure you have an active ChatGPT conversation open.' };
    }

    return {
      success: true,
      context: {
        platform: 'chatgpt',
        title: chatTitle(),
        messages: deduplicate(fallback),
        url: window.location.href,
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    endScrapingSession();
  }
}
