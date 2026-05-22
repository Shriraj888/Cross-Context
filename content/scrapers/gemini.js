// Cross Context — Gemini Scraper
// Scrapes conversation from gemini.google.com

export function scrapeConversation() {
  try {
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
  }
}

function extractText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll(
    'button, mat-icon, [aria-label], .copy-button, [class*="action"], [class*="toolbar"]'
  ).forEach(n => n.remove());
  return (clone.innerText || clone.textContent || '').trim();
}
