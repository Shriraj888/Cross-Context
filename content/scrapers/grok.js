// Cross Context — Grok Scraper
// Scrapes conversation from grok.com

export function scrapeConversation() {
  try {
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
  }
}

function extractText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll(
    'button, svg, [role="button"], [class*="action"], [class*="toolbar"]'
  ).forEach(n => n.remove());
  return (clone.innerText || clone.textContent || '').trim();
}
