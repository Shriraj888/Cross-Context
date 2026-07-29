// Cross Context — Context Formatter
// Converts scraped messages into a structured handoff prompt

const MAX_TURNS = 40; // max message turns to include
const CHAR_LIMIT = 80000; // ~20k tokens safety limit

// ────────────────────────────────────────────────────────────────
// Deterministic Context Intelligence & Memory Graph Engine
// ────────────────────────────────────────────────────────────────

export function formatContextPrompt(context, targetPlatform) {
  // Inner function generates the raw prompt, then we apply truncation tracking
  const rawPrompt = _buildPrompt(context, targetPlatform);

  // Truncation tracking: if the prompt exceeds CHAR_LIMIT, truncate and flag the context
  if (rawPrompt.length > CHAR_LIMIT) {
    context.truncated = true;
    context.truncatedAt = CHAR_LIMIT;
    return rawPrompt.substring(0, CHAR_LIMIT) + '\n\n⚠️ [Cross Context: Conversation was truncated at ~' + Math.round(CHAR_LIMIT / 4) + ' tokens to fit transfer limits. Some earlier context may be missing.]';
  }

  context.truncated = false;
  return rawPrompt;
}

function _buildPrompt(context, targetPlatform) {
  const src = getPlatformDisplayName(context.platform);

  if (context.aiEnhanced && context.aiStatus === 'success') {
    const idVal = context.id || 'con_01';
    const idTag = `# 📄 Cross-Context Knowledge Transfer — Context ID: \`${idVal}\`

> ⚠️ **SYSTEM INSTRUCTION FOR RECEIVING AI MODEL**:
> This file contains an exported context snapshot identified by **Context ID: \`${idVal}\`**.
> Use this **Context ID (\`${idVal}\`)** to uniquely identify, track, and differentiate this project history and state from any other context files (e.g. \`con_01\`, \`con_02\`, \`con_03\`). Do not mix up memory states across different Context IDs.

---

`;
    const e = context.aiEnhanced;
    const summary = e.project_summary || '';
    const task = e.current_task || '';
    const intent = e.user_intent || '';
    const tech = Array.isArray(e.technical_stack) ? e.technical_stack.join(', ') : '';
    const decisions = Array.isArray(e.architecture_decisions)
      ? e.architecture_decisions.map(pt => `• ${pt}`).join('\n')
      : '';
    const constraints = Array.isArray(e.constraints) ? e.constraints.join(', ') : '';
    const files = Array.isArray(e.files_mentioned) ? e.files_mentioned.join(', ') : '';
    const pending = Array.isArray(e.pending_tasks) ? e.pending_tasks.map(pt => `• ${pt}`).join('\n') : '';
    const handoff = e.handoffPrompt || '';

    // List builders helper
    const bulletJoin = (arr) => (Array.isArray(arr) && arr.length) ? arr.map(x => `• ${x}`).join('\n') : 'None recorded';
    const codeBlocksJoin = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return 'No snippets recorded';
      return arr.map((code, i) => `--- Snippet #${i + 1} ---\n${code}`).join('\n\n');
    };

    // Helper for transcript rendering
    const transcriptSection = Array.isArray(context.messages) && context.messages.length > 0
      ? `\n\n---\n\n## 💬 Full Conversation Transcript\n\n` + context.messages.map(m => {
          const roleHeader = m.role === 'user' ? '### 👤 User' : `### 🤖 ${src}`;
          return `${roleHeader}\n${m.content}`;
        }).join('\n\n')
      : '';

    // Detect Dominant Intent
    const types = Array.isArray(e.conversation_type) ? e.conversation_type.map(t => t.toLowerCase()) : [];
    let dominantIntent = 'general';
    if (types.includes('coding') || types.includes('architecture design')) {
      dominantIntent = 'coding';
    } else if (types.includes('debugging')) {
      dominantIntent = 'debugging';
    } else if (types.includes('brainstorming') || types.includes('planning')) {
      dominantIntent = 'brainstorming';
    } else if (types.includes('research') || types.includes('studying')) {
      dominantIntent = 'research';
    } else if (types.includes('writing')) {
      dominantIntent = 'writing';
    }

    if (dominantIntent === 'coding') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Coding Briefing]
${idTag}I was working on a coding project with ${src}. Here is where we left off:

📁 What I was building:
- Project Summary: ${summary}
- Tech Stack: ${tech}
- Target Files: ${files}

🛠️ Key Code & Configurations:
${codeBlocksJoin(e.important_code)}

🔑 Key decisions made so far:
${decisions}

⚠️ Constraints & Limits:
${constraints}

🎯 What I was working toward:
- Objective: ${task}
- Specific Intent: ${intent}

📋 Tasks I was working on:
${pending}

🚀 Please continue from:
${handoff}`;
    }

    if (dominantIntent === 'debugging') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Debugging Briefing]
${idTag}I was working on debugging an issue with ${src}. Here is where we left off:

📁 What I was building & testing:
- Project Summary: ${summary}
- Tech Stack: ${tech}
- Target Files: ${files}

🛠️ Error-Prone Code Snippets:
${codeBlocksJoin(e.important_code)}

❌ What I was stuck on:
- Core Debugging Target: ${task}
- Intent: ${intent}
- Tracked Errors & Issues:
${bulletJoin(e.errors_and_issues)}

💡 Attempted Solves & Solutions:
- Failed Attempts:
${bulletJoin(e.failed_attempts)}
- Successful Solutions:
${bulletJoin(e.successful_solutions)}

🚀 Please continue from:
${handoff}`;
    }

    if (dominantIntent === 'brainstorming') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Brainstorming Briefing]
${idTag}I was brainstorming and planning with ${src}. Here is where we left off:

📁 What I was building/planning:
- Core Topic/Overview: ${summary}
- Referenced Files: ${files || 'None recorded'}

💡 Key concepts & ideas developed:
${bulletJoin(e.deduplicated_context)}

🧠 Long term project memory:
${bulletJoin(e.long_term_memory)}

🔑 Key decisions made so far:
${decisions}

⚠️ Constraints & Limits:
${constraints}

🎯 What I was working toward:
- Target Objective: ${task}
- Intent/Vision: ${intent}

📋 Tasks I was working on:
${pending}

🚀 Please continue from:
${handoff}`;
    }

    if (dominantIntent === 'research') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Research Briefing]
${idTag}I was researching and studying with ${src}. Here is where we left off:

📁 What I was researching:
- Research Focus: ${summary}
- Referenced Files & Sources: ${files || 'None recorded'}

💡 Core concepts discovered:
${bulletJoin(e.deduplicated_context)}

🧠 Long term project memory:
${bulletJoin(e.long_term_memory)}

🤖 AI-inferred insights:
${bulletJoin(e.ai_inferred_context)}

⚙️ My preferences:
${bulletJoin(e.user_preferences)}

🎯 What I was working toward:
- Focus Area: ${task}
- Knowledge Goal: ${intent}

🚀 Please continue from:
${handoff}`;
    }

    if (dominantIntent === 'writing') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Writing Briefing]
${idTag}I was drafting and composing text with ${src}. Here is where we left off:

📁 What I was writing:
- Narrative/Content Overview: ${summary}
- Referenced Documents: ${files || 'None recorded'}

💡 Synthesized ideas & guidelines:
${bulletJoin(e.deduplicated_context)}

⚙️ My style preferences:
${bulletJoin(e.user_preferences)}

🎯 What I was working toward:
- Current Target: ${task}
- Creative Intent: ${intent}

📋 Next composition steps:
${pending}

🚀 Please continue from:
${handoff}`;
    }

    // General fallback
    return `[🔄 AI-Enhanced Cross Context Transfer — Briefing]
${idTag}I was working on a project with ${src}. Here is where we left off:

📁 What I was building:
- Project Summary: ${summary}
- Tech Stack & Active Files: Stack: ${tech} | Files: ${files}

🔑 Key decisions made so far:
${decisions}

⚠️ Constraints & Limits:
${constraints}

🎯 What I was working toward:
- Task: ${task}
- Intent: ${intent}

📋 Tasks I was working on:
${pending}

🚀 Please continue from:
${handoff}`;
  }

  // ──────────────────────────────────────────────────────────────
  // STANDARD FALLBACK — Raw Conversation Handoff
  // ──────────────────────────────────────────────────────────────
  const firstUser = Array.isArray(context.messages) ? context.messages.find(m => m.role === 'user') : null;
  const handoffHint = firstUser ? firstUser.content : 'Continue active working session';
  const handoffTruncated = handoffHint.length > 300 ? handoffHint.substring(0, 300) + '...' : handoffHint;
  const idTag = context.id ? `[Context ID: ${context.id}]\n` : '';

  const transcriptSection = Array.isArray(context.messages) && context.messages.length > 0
    ? `\n\n---\n\n## 💬 Full Conversation Transcript\n\n` + context.messages.map(m => {
        const roleHeader = m.role === 'user' ? '### 👤 User' : `### 🤖 ${src}`;
        return `${roleHeader}\n${m.content}`;
      }).join('\n\n')
    : '';

  return `[🔄 Cross Context Transfer — State Restoration Briefing]
${idTag}I was working on a project with ${src}. Here is where we left off:

🚀 Recent Focus / Context:
${handoffTruncated}
${transcriptSection}

---
Please acknowledge these details. Tell me what tasks you are taking over, and ask me what we should focus on next to continue seamlessly.`;
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
