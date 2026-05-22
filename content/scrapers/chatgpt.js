// Cross Context — ChatGPT Scraper
// Scrapes conversation from chatgpt.com

function getInnerText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll(
    'button, svg, [role="button"], mat-icon, ' +
    '[class*="action-bar"], [class*="toolbar"], [class*="copy-button"], ' +
    '[data-testid*="copy"], [data-testid*="action"], [data-testid*="share"], ' +
    '[class*="feedback"], [class*="thumbs"], [class*="vote"], ' +
    '[class*="like"], [class*="share"], form, ' +
    '.juice\\:flex, .juice\\:items-center, [class*="speech-button"]'
  ).forEach(n => n.remove());

  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-9999px';
  wrapper.style.top = '-9999px';
  wrapper.style.width = '800px';
  wrapper.style.height = 'auto';
  wrapper.style.visibility = 'visible';
  wrapper.style.opacity = '0';
  wrapper.style.pointerEvents = 'none';
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  const text = (clone.innerText || clone.textContent || '').trim();
  document.body.removeChild(wrapper);
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
  return msgs.some(m => m.role === 'user') && msgs.some(m => m.role === 'assistant');
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
    const chatTitle = () =>
      document.title.replace(/[-–|]?\s*ChatGPT.*$/i, '').trim() || 'ChatGPT Conversation';

    // ── Strategy 1: LCA-based turn extractor ──
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

    // ── Strategy 2: data-message-author-role (most reliable) ──
    const roleEls = [...document.querySelectorAll('[data-message-author-role]')].filter(filterInputArea);
    if (roleEls.length > 0) {
      const msgs = roleEls.map(el => {
        const role = el.getAttribute('data-message-author-role'); // 'user' or 'assistant'
        const inner = el.querySelector('.markdown, .whitespace-pre-wrap, [class*="prose"]') || el;
        return { role, content: getInnerText(inner) };
      }).filter(m => m.content.length > 3);
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

    // ── Strategy 3: articles with embedded role attribute ──
    const articles = [...document.querySelectorAll('article')].filter(filterInputArea);
    if (articles.length > 0) {
      const msgs = articles.flatMap(art => {
        const roleEl = art.querySelector('[data-message-author-role]');
        if (!roleEl) return [];
        const role = roleEl.getAttribute('data-message-author-role');
        const content = getInnerText(art);
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

    // ── Strategy 4: Alternating fallback ──
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
  }
}
