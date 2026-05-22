// Cross Context — Perplexity Scraper
// Scrapes conversation from perplexity.ai

export function scrapeConversation() {
  try {
    const messages = [];

    // Perplexity uses a Q&A / thread structure
    // User queries: typically in a "query" container
    // AI responses: in the main answer section

    // Primary: look for query + answer pairs
    const queryEls = document.querySelectorAll(
      '[class*="query"], [data-testid*="query"], [class*="QueryText"]'
    );
    const answerEls = document.querySelectorAll(
      '[class*="answer"], [data-testid*="answer"], [class*="prose"], .col-span-8'
    );

    if (queryEls.length > 0) {
      // Pair queries with answers by order
      const maxLen = Math.max(queryEls.length, answerEls.length);
      for (let i = 0; i < maxLen; i++) {
        if (queryEls[i]) {
          const q = extractText(queryEls[i]);
          if (q.trim()) messages.push({ role: 'user', content: q.trim() });
        }
        if (answerEls[i]) {
          const a = extractText(answerEls[i]);
          if (a.trim()) messages.push({ role: 'assistant', content: a.trim() });
        }
      }
    } else {
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
  }
}

function extractText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll(
    'button, svg, [class*="citation"], [class*="source"], [class*="action"], sup'
  ).forEach(n => n.remove());
  return (clone.innerText || clone.textContent || '').trim();
}
