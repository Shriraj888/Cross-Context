// Cross Context — Gemini Scraper
// Scrapes conversation from gemini.google.com

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

export function scrapeConversation() {
  try {
    startScrapingSession();

    const messages = [];

    // Gemini uses message-content elements with user-query or model-response
    // Primary: look for user queries and model responses
    const userMessages = document.querySelectorAll(
      'user-query, [class*="user-query"], .user-query-container'
    );
    const modelMessages = document.querySelectorAll(
      'model-response, [class*="model-response"], .model-response-text'
    );

    // Build an ordered list by DOM position
    const allNodes = [];

    userMessages.forEach(el => {
      allNodes.push({ el, role: 'user', top: el.getBoundingClientRect().top + window.scrollY });
    });
    modelMessages.forEach(el => {
      allNodes.push({ el, role: 'assistant', top: el.getBoundingClientRect().top + window.scrollY });
    });

    // Sort by vertical position in the page
    allNodes.sort((a, b) => a.top - b.top);

    allNodes.forEach(({ el, role }) => {
      const content = extractText(el);
      if (content.trim().length > 2) {
        messages.push({ role, content: content.trim() });
      }
    });

    if (messages.length === 0) {
      // Fallback: look for message containers with data attributes
      const containers = document.querySelectorAll('[data-message-id], [class*="message-bubble"]');
      containers.forEach(container => {
        const isUser = container.closest('user-query, [class*="user"]') !== null;
        const role = isUser ? 'user' : 'assistant';
        const content = extractText(container);
        if (content.trim().length > 2) {
          messages.push({ role, content: content.trim() });
        }
      });
    }

    if (messages.length === 0) {
      return { success: false, error: 'No conversation found. Make sure you have an active Gemini conversation open.' };
    }

    const title = document.title.replace('Gemini', '').replace('-', '').trim() || 'Gemini Conversation';

    return {
      success: true,
      context: {
        platform: 'gemini',
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
