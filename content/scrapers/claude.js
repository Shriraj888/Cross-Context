// Cross Context — Claude Scraper
// Scrapes conversation from claude.ai

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
      return {
        success: true,
        context: {
          platform: 'claude',
          title: claudeTitle(),
          messages: deduplicate(lcaMsgs),
          url: window.location.href,
        }
      };
    }

    const humanEls = [...document.querySelectorAll(userSelectors)].filter(filterInputArea);
    let assistantEls = [...document.querySelectorAll(assistantSelectors)].filter(filterInputArea);

    // Exclude assistant elements that are actually inside user elements
    assistantEls = assistantEls.filter(el => !humanEls.some(userEl => userEl.contains(el)));

    // ── Strategy 2: Interleaved selection using broad user & assistant selectors ──
    if (humanEls.length > 0 && assistantEls.length > 0) {
      const msgs = interleaveByDomOrder(humanEls, assistantEls, getInnerText);
      if (hasBothRoles(msgs)) {
        return {
          success: true,
          context: {
            platform: 'claude',
            title: claudeTitle(),
            messages: deduplicate(msgs),
            url: window.location.href,
          }
        };
      }
    }

    // ── Strategy 3: Next-sibling anchor approach (if Strategy 2 has missing roles) ──
    const humanTurns = humanEls;
    if (humanTurns.length > 0) {
      const msgs = [];
      humanTurns.forEach(humanEl => {
        const userText = getInnerText(humanEl);
        if (userText.length > 0) msgs.push({ role: 'user', content: userText });

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
          msgs.push({ role: 'assistant', content: assistantText });
        }
      });

      if (msgs.length > 0 && hasBothRoles(msgs)) {
        return {
          success: true,
          context: {
            platform: 'claude',
            title: claudeTitle(),
            messages: deduplicate(msgs),
            url: window.location.href,
          }
        };
      }
    }

    // ── Strategy 4: Alternating fallback ──
    const fallback = [];
    const allMessages = document.querySelectorAll(
      '[class*="prose"] > p, [class*="prose"] > ul, [class*="prose"] > ol, ' +
      '[class*="prose"] > pre, [class*="prose"] > blockquote'
    );
    let lastRole = null;
    allMessages.forEach(el => {
      const text = getInnerText(el);
      if (text.trim().length > 10) {
        const role = lastRole === 'user' ? 'assistant' : 'user';
        lastRole = role;
        fallback.push({ role, content: text.trim() });
      }
    });

    if (fallback.length === 0) {
      return { success: false, error: 'No conversation found. Make sure you have an active conversation open.' };
    }

    return {
      success: true,
      context: {
        platform: 'claude',
        title: claudeTitle(),
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
