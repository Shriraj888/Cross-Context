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

function getInnerText(el) {
  if (!el) return '';
  const wasActive = isSessionActive;
  if (!wasActive) startScrapingSession();
  const text = (el.innerText || el.textContent || '').trim();
  if (!wasActive) endScrapingSession();
  return text;
}

function extractText(el) {
  return getInnerText(el);
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

function interleaveByDomOrder(userEls, assistantEls, extractFn = getInnerText) {
  const combinedEls = [...userEls, ...assistantEls];
  const topLevel = filterTopLevelOnly(combinedEls);
  
  const all = topLevel.map(el => {
    const isUser = userEls.includes(el);
    return { el, role: isUser ? 'user' : 'assistant' };
  });
  
  all.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  return all
    .map(({ el, role }) => ({ role, content: extractFn(el) }))
    .filter(m => m.content.length > 5);
}

function universalFallback(containerSelector, minLen = 20) {
  const messages = [];
  const blocks = document.querySelectorAll(containerSelector);
  let lastRole = null;
  blocks.forEach(el => {
    const text = getInnerText(el);
    if (text.length < minLen) return;
    const role = lastRole === 'user' ? 'assistant' : 'user';
    lastRole = role;
    messages.push({ role, content: text });
  });
  return messages;
}

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

function extractConversationViaLCA(userSelectors, assistantSelectors, copyButtonSelectors) {
  let userEls = [...document.querySelectorAll(userSelectors)].filter(filterInputArea);
  let assistantEls = assistantSelectors ? [...document.querySelectorAll(assistantSelectors)].filter(filterInputArea) : [];
  let copyBtns = copyButtonSelectors ? [...document.querySelectorAll(copyButtonSelectors)].filter(filterInputArea) : [];

  // Exclude assistant elements that are actually inside user elements
  assistantEls = assistantEls.filter(el => !userEls.some(userEl => userEl.contains(el)));

  if (userEls.length === 0) return null;

  let chatContainer = null;
  let curr = userEls[0];
  while (curr && curr !== document.body && curr !== document.documentElement) {
    const parent = curr.parentElement;
    if (!parent) break;
    
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

  if (!chatContainer) {
    const allIndicators = [...userEls, ...assistantEls, ...copyBtns];
    chatContainer = findLCA(allIndicators);
  }

  if (!chatContainer || chatContainer === document.body || chatContainer === document.documentElement) return null;

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
      const text = getInnerText(child);
      if (text.length > 10) {
        role = lastRole === 'user' ? 'assistant' : 'user';
      }
    }

    if (role) {
      const text = getInnerText(child);
      if (text.length > 0) {
        if (role === 'assistant' && text.length < 10) continue;
        messages.push({ role, content: text });
        lastRole = role;
      }
    }
  }

  return messages.length > 0 ? messages : null;
}

export function scrapeConversation() {
  try {
    startScrapingSession();

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
        return { role, content: getInnerText(inner) };
      }).filter(m => m && m.content.length > 3);
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

    // ── Strategy 2: article elements with embedded role attribute ──
    // Each ChatGPT message turn is wrapped in an <article>. Find the role indicator inside.
    const articles = [...document.querySelectorAll('article[data-testid*="conversation-turn"]')].filter(filterInputArea);
    if (articles.length > 0) {
      const msgs = articles.flatMap(art => {
        const roleEl = art.querySelector('[data-message-author-role]');
        if (!roleEl) return [];
        const role = roleEl.getAttribute('data-message-author-role');
        if (role !== 'user' && role !== 'assistant') return [];
        let textEl = roleEl;
        if (role === 'assistant') {
          textEl = art.querySelector('.markdown, .whitespace-pre-wrap, [class*="prose"]') || roleEl;
        }
        const content = getInnerText(textEl);
        return content.length > 3 ? [{ role, content }] : [];
      });
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
        return content.length > 5 ? [{ role, content }] : [];
      });
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

    // ── Strategy 4: LCA-based turn extractor (fallback for changed DOM) ──
    const lcaMsgs = extractConversationViaLCA(
      '[data-message-author-role="user"]',
      '[data-message-author-role="assistant"]',
      'button[aria-label*="Copy" i], button[data-testid*="copy" i]'
    );
    if (lcaMsgs && hasBothRoles(lcaMsgs)) {
      return {
        success: true,
        context: {
          platform: 'chatgpt',
          title: chatTitle(),
          messages: deduplicate(lcaMsgs),
          url: window.location.href,
        }
      };
    }

    // ── Strategy 5: Alternating fallback ──
    const fallback = universalFallback('main > div > div > div', 20);
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
