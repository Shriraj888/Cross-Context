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

  // §5.4 Fix: Truncate on message boundaries rather than raw character index to avoid
  // splitting code fences, tables, or words mid-token.
  if (rawPrompt.length > CHAR_LIMIT) {
    context.truncated = true;
    context.truncatedAt = CHAR_LIMIT;

    // Try to build a truncated version by dropping whole messages from the end
    if (Array.isArray(context.messages) && context.messages.length > 0) {
      const truncationNotice = '\n\n⚠️ [Cross Context: Conversation was truncated at ~' + Math.round(CHAR_LIMIT / 4) + ' tokens to fit transfer limits. Some earlier context may be missing.]';
      // Build a trimmed context with progressively fewer messages until it fits
      const trimmedContext = { ...context };
      for (let i = context.messages.length - 1; i >= 0; i--) {
        trimmedContext.messages = context.messages.slice(0, i);
        const candidate = _buildPrompt(trimmedContext, targetPlatform);
        if (candidate.length + truncationNotice.length <= CHAR_LIMIT) {
          return candidate + truncationNotice;
        }
      }
      // Even zero messages is too long — fall back to raw substring as last resort
    }

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
    const bulletJoin = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return 'None recorded';
      return arr.map(x => {
        if (typeof x === 'object' && x !== null) {
          if (x.content) {
            const score = x.priority_score != null ? `[Priority ${x.priority_score}/10] ` : '';
            const reason = x.priority_reason ? ` (${x.priority_reason})` : '';
            return `• ${score}${x.content}${reason}`;
          }
          return `• ${JSON.stringify(x)}`;
        }
        return `• ${x}`;
      }).join('\n');
    };

    const codeBlocksJoin = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return 'No snippets recorded';
      return arr.map((code, i) => {
        const trimmed = typeof code === 'string' ? code.trim() : String(code);
        if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
          return `--- Snippet #${i + 1} ---\n${trimmed}`;
        }
        return `--- Snippet #${i + 1} ---\n\`\`\`\n${trimmed}\n\`\`\``;
      }).join('\n\n');
    };

    const formatOptionalSection = (title, items, isCode = false) => {
      if (!Array.isArray(items) || !items.length) return '';
      const content = isCode ? codeBlocksJoin(items) : bulletJoin(items);
      return `\n\n### ${title}\n${content}`;
    };

    const buildQualityFooter = (e, src, types) => {
      const q = e.context_quality || {};
      const s = e.deduplication_stats || {};

      const snr = q.signal_to_noise_ratio != null ? `${q.signal_to_noise_ratio}` : 'High';
      const completeness = q.context_completeness != null ? `${Math.round(q.context_completeness * 100)}%` : '100%';
      const readiness = q.transfer_readiness_score != null ? `${q.transfer_readiness_score}/10` : '10/10';

      const tokenRed = s.estimated_token_reduction_percent != null ? `~${Math.round(s.estimated_token_reduction_percent)}%` : null;
      const dupRemoved = s.duplicate_items_removed != null ? s.duplicate_items_removed : 0;
      const merged = s.merged_concepts != null ? s.merged_concepts : 0;

      let dedupText = '';
      if (tokenRed) {
        dedupText = `\n- 📉 **Optimization Efficiency:** ${tokenRed} token reduction (${dupRemoved} duplicates removed, ${merged} concepts merged)`;
      }

      return `\n\n---

### 📊 AI Optimization & Quality Metrics
- 🌐 **Source AI Platform:** ${src}
- 🏷️ **Conversation Type:** ${types.length ? types.join(', ') : 'General'}
- 🎯 **Signal-to-Noise Ratio:** ${snr}
- 📦 **Context Completeness:** ${completeness}
- ⚡ **Cross-LLM Readiness:** ${readiness}${dedupText}`;
    };

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
${idTag}## 🤖 AI Executive Summary
${summary}

### 🎯 Objective & Current Intent
- **Active Task:** ${task}
- **Developer Intent:** ${intent}

### 🧠 Priority Memories & Key Context
${bulletJoin(e.priority_memories)}

### 📁 Technical Stack & Target Files
- **Tech Stack:** ${tech || 'None specified'}
- **Target Files:** ${files || 'None recorded'}

### 🔑 Architectural & Technical Decisions
${decisions || 'None recorded'}

### 🛠️ Key Code & Configurations
${codeBlocksJoin(e.important_code)}
${formatOptionalSection('💡 Synthesized Core Concepts', e.deduplicated_context)}
${formatOptionalSection('✅ Successful Solutions & Working Implementations', e.successful_solutions)}
${formatOptionalSection('❌ Failed Approaches & Pitfalls to Avoid', e.failed_attempts)}
${formatOptionalSection('⚙️ User Preferences & Style Guidelines', e.user_preferences)}
${formatOptionalSection('⚠️ Constraints & Limits', e.constraints)}
${formatOptionalSection('🤖 AI-Inferred Insights', e.ai_inferred_context)}
${formatOptionalSection('⚡ Temporary Session Context', e.temporary_context)}
${formatOptionalSection('🧠 Long-Term Project Memory', e.long_term_memory)}

### 📋 Pending Tasks & Action Items
${pending || 'None recorded'}

### 🚀 Next Step Briefing (Continue From Here)
${handoff}${buildQualityFooter(e, src, types)}`;
    }

    if (dominantIntent === 'debugging') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Debugging Briefing]
${idTag}## 🤖 AI Executive Summary
${summary}

### 🎯 Debugging Target & User Intent
- **Core Target:** ${task}
- **Developer Intent:** ${intent}

### 🧠 Priority Memories & Key Context
${bulletJoin(e.priority_memories)}

### 📁 Environment & Target Files
- **Tech Stack:** ${tech || 'None specified'}
- **Target Files:** ${files || 'None recorded'}

### ❌ Tracked Errors, Exceptions & Issues
${bulletJoin(e.errors_and_issues)}

### 🛠️ Error-Prone Code & Configurations
${codeBlocksJoin(e.important_code)}

### 💡 Attempted Solves & Solutions
- **Failed Attempts (What didn't work):**
${bulletJoin(e.failed_attempts)}
- **Successful Solutions (What worked):**
${bulletJoin(e.successful_solutions)}
${formatOptionalSection('🔑 Architectural Decisions & Fix Logic', e.architecture_decisions)}
${formatOptionalSection('💡 Synthesized Concepts', e.deduplicated_context)}
${formatOptionalSection('⚙️ User Preferences & Style', e.user_preferences)}
${formatOptionalSection('⚠️ Constraints & Limits', e.constraints)}
${formatOptionalSection('🤖 AI-Inferred Root Cause & Insights', e.ai_inferred_context)}
${formatOptionalSection('⚡ Temporary Session Context', e.temporary_context)}
${formatOptionalSection('🧠 Long-Term Project Memory', e.long_term_memory)}

### 📋 Pending Tasks & Unresolved Checklist
${pending || 'None recorded'}

### 🚀 Next Step Briefing (Continue From Here)
${handoff}${buildQualityFooter(e, src, types)}`;
    }

    if (dominantIntent === 'brainstorming') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Brainstorming Briefing]
${idTag}## 🤖 AI Executive Summary
${summary}

### 🎯 Vision, Goal & User Intent
- **Target Objective:** ${task}
- **Creative Intent:** ${intent}

### 🧠 Priority Memories & Key Context
${bulletJoin(e.priority_memories)}

### 💡 Key Concepts & Ideation
${bulletJoin(e.deduplicated_context)}

### 🔑 Key Decisions Made
${decisions || 'None recorded'}
${formatOptionalSection('📁 Referenced Files & Documents', e.files_mentioned)}
${formatOptionalSection('🛠️ Relevant Code Snippets & Mockups', e.important_code, true)}
${formatOptionalSection('🧠 Long-Term Project Memory', e.long_term_memory)}
${formatOptionalSection('🤖 AI-Inferred Opportunities & Directions', e.ai_inferred_context)}
${formatOptionalSection('⚙️ User Preferences & Creative Principles', e.user_preferences)}
${formatOptionalSection('⚠️ Boundaries, Constraints & Limits', e.constraints)}
${formatOptionalSection('⚡ Temporary Session Context', e.temporary_context)}

### 📋 Action Items & Next Exploration Tasks
${pending || 'None recorded'}

### 🚀 Next Step Briefing (Continue From Here)
${handoff}${buildQualityFooter(e, src, types)}`;
    }

    if (dominantIntent === 'research') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Research Briefing]
${idTag}## 🤖 AI Executive Summary
${summary}

### 🎯 Research Objective & Inquiries
- **Focus Area:** ${task}
- **Knowledge Goal:** ${intent}

### 🧠 Priority Memories & Key Context
${bulletJoin(e.priority_memories)}

### 💡 Core Findings & Synthesized Concepts
${bulletJoin(e.deduplicated_context)}

### 🤖 AI-Inferred Insights & Synthesis
${bulletJoin(e.ai_inferred_context)}

### 🧠 Long-Term Knowledge & Findings
${bulletJoin(e.long_term_memory)}
${formatOptionalSection('📁 Referenced Sources & Files', e.files_mentioned)}
${formatOptionalSection('🔑 Key Decisions & Validated Facts', e.architecture_decisions)}
${formatOptionalSection('🛠️ Important Code / Configurations', e.important_code, true)}
${formatOptionalSection('⚙️ User Research Preferences', e.user_preferences)}
${formatOptionalSection('⚠️ Constraints, Quotas & Boundaries', e.constraints)}
${formatOptionalSection('⚡ Temporary Investigation Context', e.temporary_context)}

### 📋 Pending Research Questions & Next Steps
${pending || 'None recorded'}

### 🚀 Next Step Briefing (Continue From Here)
${handoff}${buildQualityFooter(e, src, types)}`;
    }

    if (dominantIntent === 'writing') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Writing Briefing]
${idTag}## 🤖 AI Executive Summary
${summary}

### 🎯 Composition Target & Creative Intent
- **Current Target:** ${task}
- **Creative Intent:** ${intent}

### 🧠 Priority Memories & Key Context
${bulletJoin(e.priority_memories)}

### 💡 Synthesized Ideas & Content Guidelines
${bulletJoin(e.deduplicated_context)}

### ⚙️ Style Preferences & Tone Guidelines
${bulletJoin(e.user_preferences)}
${formatOptionalSection('📁 Referenced Documents & Sources', e.files_mentioned)}
${formatOptionalSection('🔑 Key Content Decisions', e.architecture_decisions)}
${formatOptionalSection('🧠 Long-Term Document Memory', e.long_term_memory)}
${formatOptionalSection('🤖 AI-Inferred Tone & Context', e.ai_inferred_context)}
${formatOptionalSection('⚠️ Content Constraints & Word Limits', e.constraints)}
${formatOptionalSection('⚡ Temporary Draft Context', e.temporary_context)}

### 📋 Next Composition Steps & Revisions
${pending || 'None recorded'}

### 🚀 Next Step Briefing (Continue From Here)
${handoff}${buildQualityFooter(e, src, types)}`;
    }

    // General fallback
    return `[🔄 AI-Enhanced Cross Context Transfer — Briefing]
${idTag}## 🤖 AI Executive Summary
${summary}

### 🎯 Target Objective & User Intent
- **Current Task:** ${task}
- **Intent:** ${intent}

### 🧠 Priority Memories & Key Context
${bulletJoin(e.priority_memories)}

### 💡 Synthesized Core Context
${bulletJoin(e.deduplicated_context)}

### 📁 Technical Stack & Referenced Files
- **Stack:** ${tech || 'None specified'}
- **Files:** ${files || 'None recorded'}

### 🔑 Key Decisions Made
${decisions || 'None recorded'}
${formatOptionalSection('🛠️ Key Code & Configurations', e.important_code, true)}
${formatOptionalSection('✅ Successful Solutions', e.successful_solutions)}
${formatOptionalSection('❌ Tracked Errors & Issues', e.errors_and_issues)}
${formatOptionalSection('⚙️ User Preferences & Guidelines', e.user_preferences)}
${formatOptionalSection('⚠️ Constraints & Limits', e.constraints)}
${formatOptionalSection('🤖 AI-Inferred Context & Insights', e.ai_inferred_context)}
${formatOptionalSection('⚡ Temporary Session Context', e.temporary_context)}
${formatOptionalSection('🧠 Long-Term Project Memory', e.long_term_memory)}

### 📋 Pending Tasks & Next Steps
${pending || 'None recorded'}

### 🚀 Next Step Briefing (Continue From Here)
${handoff}${buildQualityFooter(e, src, types)}`;
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
 * §3.1 Fix: Shared helper that builds the full verbatim transcript section.
 * Used by both the AI-enhanced branches and the standard fallback.
 */
function buildTranscriptSection(context, src) {
  if (!Array.isArray(context.messages) || context.messages.length === 0) return '';
  return `\n\n---\n\n## 💬 Full Conversation Transcript\n\n` +
    context.messages.map(m => {
      const roleHeader = m.role === 'user' ? '### 👤 User' : `### 🤖 ${src}`;
      return `${roleHeader}\n${m.content}`;
    }).join('\n\n');
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
