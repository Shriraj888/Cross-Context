// Cross Context — Perplexity Scraper
// Scrapes conversation from perplexity.ai

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

function extractText(el) {
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

function interleaveByDomOrder(userEls, assistantEls, extractFn = extractText) {
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

export function scrapeConversation() {
  try {
    startScrapingSession();

    // Perplexity uses a Q&A / thread structure
    // User queries: typically in a "query" container
    // AI responses: in the main answer section

    // Primary: look for query + answer pairs sorted by DOM order
    const queryEls = [...document.querySelectorAll(
      '[data-testid*="query"], [class*="query"]:not([class*="answer"])'
    )].filter(filterInputArea);
    
    const answerEls = [...document.querySelectorAll(
      '.prose, [class*="answer"]:not([class*="query"])'
    )].filter(filterInputArea);

    let messages = [];

    if (queryEls.length > 0 || answerEls.length > 0) {
      messages = interleaveByDomOrder(queryEls, answerEls, extractText);
    }

    if (messages.length === 0) {
      // Fallback: look for thread-based structure
      const threadItems = document.querySelectorAll(
        '[class*="threadItem"], [class*="ThreadItem"], section'
      );

      threadItems.forEach((item, idx) => {
        const content = extractText(item);
        if (content.trim().length < 5) return;
        // Alternating: first is user, second is assistant
        const role = idx % 2 === 0 ? 'user' : 'assistant';
        messages.push({ role, content: content.trim() });
      });
    }

    if (messages.length === 0) {
      return { success: false, error: 'No conversation found. Make sure you have an active Perplexity conversation open.' };
    }

    const title = document.title.replace('Perplexity', '').replace('-', '').trim() || 'Perplexity Conversation';

    return {
      success: true,
      context: {
        platform: 'perplexity',
        title,
        messages,
        url: window.location.href,
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    endScrapingSession();
  }
}
