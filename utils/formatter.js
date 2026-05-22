// Cross Context — Context Formatter
// Converts scraped messages into a structured handoff prompt

const MAX_TURNS = 40; // max message turns to include
const CHAR_LIMIT = 80000; // ~20k tokens safety limit

/**
 * Formats a context object into a handoff prompt string for the target LLM.
 * @param {Object} context - { platform, title, messages: [{role, content}] }
 * @param {string} targetPlatform - the destination LLM name
 * @returns {string} formatted prompt
 */
export function formatContextPrompt(context, targetPlatform) {
  let messages = [...context.messages];
  let truncated = false;

  // Trim to MAX_TURNS (keep last N turns, preserving pairs)
  if (messages.length > MAX_TURNS) {
    messages = messages.slice(messages.length - MAX_TURNS);
    truncated = true;
  }

  // Build conversation transcript
  let transcript = '';
  let charCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
    const line = `${role}:\n${msg.content}\n\n`;

    if (charCount + line.length > CHAR_LIMIT) {
      // Truncate here
      messages = messages.slice(i);
      truncated = true;
      break;
    }

    transcript += line;
    charCount += line.length;
  }

  const sourceName = getPlatformDisplayName(context.platform);
  const targetName = getPlatformDisplayName(targetPlatform);
  const turnCount = messages.length;

  const header = `[🔄 Cross Context Transfer]
You are continuing a conversation that was started on ${sourceName}.
The user has reached the free-tier limit there and needs your help to continue seamlessly.
${truncated ? `\n⚠️ Note: This is a partial history (last ${MAX_TURNS} turns shown due to length).\n` : ''}
Please read the conversation history below carefully, then acknowledge that you understand the context and are ready to continue helping the user from where they left off. Do NOT re-introduce yourself — just confirm you have the context and ask what they'd like to continue with.

${'═'.repeat(60)}
📋 Conversation History (${turnCount} messages from ${sourceName})
${'═'.repeat(60)}

${transcript.trim()}

${'═'.repeat(60)}
✅ End of conversation history from ${sourceName}
${'═'.repeat(60)}

Please confirm you have the full context above and are ready to continue the conversation.`;

  return header;
}

/**
 * Returns a short summary of the context for display in UI
 */
export function getContextSummary(context) {
  const firstUser = context.messages.find(m => m.role === 'user');
  return firstUser ? firstUser.content.substring(0, 100) : 'No content';
}

/**
 * Display names for each platform
 */
export function getPlatformDisplayName(platform) {
  const names = {
    claude:      'Claude (Anthropic)',
    chatgpt:     'ChatGPT (OpenAI)',
    gemini:      'Gemini (Google)',
    grok:        'Grok (xAI)',
    perplexity:  'Perplexity AI',
  };
  return names[platform] || platform;
}

/**
 * Platform color accents
 */
export const PLATFORM_CONFIG = {
  claude: {
    name: 'Claude',
    color: '#D97706',
    gradient: 'linear-gradient(135deg, #D97706, #F59E0B)',
    icon: '🟠',
    url: 'https://claude.ai/new',
  },
  chatgpt: {
    name: 'ChatGPT',
    color: '#10B981',
    gradient: 'linear-gradient(135deg, #059669, #10B981)',
    icon: '🟢',
    url: 'https://chatgpt.com/',
  },
  gemini: {
    name: 'Gemini',
    color: '#6366F1',
    gradient: 'linear-gradient(135deg, #4F46E5, #8B5CF6)',
    icon: '🔵',
    url: 'https://gemini.google.com/app',
  },
  grok: {
    name: 'Grok',
    color: '#E2E8F0',
    gradient: 'linear-gradient(135deg, #94A3B8, #E2E8F0)',
    icon: '⚪',
    url: 'https://grok.com/',
  },
  perplexity: {
    name: 'Perplexity',
    color: '#14B8A6',
    gradient: 'linear-gradient(135deg, #0D9488, #14B8A6)',
    icon: '🩵',
    url: 'https://www.perplexity.ai/',
  },
};
