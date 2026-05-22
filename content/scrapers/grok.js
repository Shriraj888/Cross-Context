// Cross Context — Grok Scraper
// Scrapes conversation from grok.com

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

    // Grok uses a React-based structure
    // Try to find message rows — Grok typically uses r-* Tailwind classes
    // or specific role indicators

    // Primary: look for message containers with role indicators
    const messageRows = document.querySelectorAll(
      '[class*="message-row"], [class*="MessageRow"], [data-role]'
    );

    if (messageRows.length > 0) {
      messageRows.forEach(row => {
        const role = row.getAttribute('data-role')
          || (row.querySelector('[class*="user-bubble"], [class*="UserBubble"]') ? 'user' : 'assistant');
        const content = extractText(row);
        if (content.trim()) {
          messages.push({ role, content: content.trim() });
        }
      });
    } else {
      // Fallback: Grok uses distinct user vs AI message styling
      // User messages are typically right-aligned in a specific container
      const allBlocks = document.querySelectorAll(
        '[class*="conversation"] > div, main > div > div > div'
      );

      allBlocks.forEach(block => {
        const text = extractText(block);
        if (text.trim().length < 5) return;

        // Heuristic: Grok user messages often have a specific class
        const isUser = block.querySelector('img[alt*="Avatar"], [class*="user"]') !== null
          || block.style.textAlign === 'right';
        const role = isUser ? 'user' : 'assistant';
        messages.push({ role, content: text.trim() });
      });
    }

    if (messages.length === 0) {
      return { success: false, error: 'No conversation found. Make sure you have an active Grok conversation open.' };
    }

    const title = document.title.replace('Grok', '').replace('-', '').trim() || 'Grok Conversation';

    return {
      success: true,
      context: {
        platform: 'grok',
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
