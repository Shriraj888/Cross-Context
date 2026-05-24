// Cross Context — Context Formatter
// Converts scraped messages into a structured handoff prompt

const MAX_TURNS = 40; // max message turns to include
const CHAR_LIMIT = 80000; // ~20k tokens safety limit

// ────────────────────────────────────────────────────────────────
// Deterministic Context Intelligence & Memory Graph Engine
// ────────────────────────────────────────────────────────────────

export class ContextIntelligenceEngine {
  constructor() {
    this.nodes = new Map(); // id -> { type, label, properties }
    this.edges = [];        // { from, to, type }
    this.deduplicatedConcepts = [];
    this.priorityMemories = [];
    this.executionContext = {
      topicsDiscussed: new Set(),
      solvedProblems: new Set(),
      failedApproaches: new Set(),
      currentFocus: ''
    };
  }

  // 1. Deterministic Priority Scoring
  scoreMessage(content, role) {
    if (!content) return 0;
    
    // Check for code blocks
    const hasCode = content.includes('```');
    
    // High Priority Patterns
    const highPatterns = [
      /requirement/i, /architecture/i, /technical decision/i, /tech stack/i,
      /todo/i, /active task/i, /unresolved/i, /error/i, /bug/i, /exception/i,
      /debugging/i, /blocker/i, /user preference/i, /conventions/i, /decision/i,
      /how to/i, /solves/i, /fails/i, /attempt/i, /config/i
    ];
    
    // Low Priority Patterns
    const lowPatterns = [
      /^hello/i, /^hi /i, /^hey/i, /thanks/i, /thank you/i, /awesome/i,
      /perfect/i, /ok/i, /confirm/i, /^yes$/i, /filler/i, /conversation fluff/i,
      /helpful assistant/i
    ];

    let score = 5; // Neutral baseline

    if (role === 'user') score += 1; // User intent is high baseline
    if (hasCode) score += 3;

    let highMatchCount = 0;
    highPatterns.forEach(pat => {
      if (pat.test(content)) highMatchCount++;
    });
    score += Math.min(highMatchCount * 1.5, 4);

    let lowMatchCount = 0;
    lowPatterns.forEach(pat => {
      if (pat.test(content)) lowMatchCount++;
    });
    score -= Math.min(lowMatchCount * 2, 4);

    return Math.max(1, Math.min(10, Math.round(score)));
  }

  // Jaccard similarity helper for deduplication
  calculateJaccard(str1, str2) {
    const getWords = (str) => new Set(str.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
    const set1 = getWords(str1);
    const set2 = getWords(str2);
    if (set1.size === 0 || set2.size === 0) return 0;

    let intersection = 0;
    for (const item of set1) {
      if (set2.has(item)) intersection++;
    }
    const union = set1.size + set2.size - intersection;
    return intersection / union;
  }

  // 2. Semantic Deduplication
  deduplicateItems(items) {
    const canonicalList = [];
    
    items.forEach(item => {
      if (!item || item.trim().length < 5) return;
      
      let merged = false;
      for (let i = 0; i < canonicalList.length; i++) {
        const canonical = canonicalList[i];
        const similarity = this.calculateJaccard(item, canonical);
        
        // Substring inclusions or high Jaccard matches
        const isSub1 = item.toLowerCase().includes(canonical.toLowerCase()) && item.length < canonical.length * 2;
        const isSub2 = canonical.toLowerCase().includes(item.toLowerCase()) && canonical.length < item.length * 2;
        
        if (similarity > 0.45 || isSub1 || isSub2) {
          // Merge: keep the longer/more complete version
          if (item.length > canonical.length) {
            canonicalList[i] = item;
          }
          merged = true;
          break;
        }
      }
      if (!merged) {
        canonicalList.push(item);
      }
    });
    
    return canonicalList;
  }

  // 3. Memory Graph Construction & Querying
  addNode(id, type, label, properties = {}) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { type, label, properties });
    }
  }

  addEdge(from, to, type) {
    // Prevent duplicate edges
    const exists = this.edges.some(e => e.from === from && e.to === to && e.type === type);
    if (!exists && this.nodes.has(from) && this.nodes.has(to)) {
      this.edges.push({ from, to, type });
    }
  }

  // Traverse the memory graph to extract relevant subgraphs
  getRelevantSubgraph(focusNodeId, maxHops = 2) {
    const visited = new Set();
    const resultNodes = [];
    const resultEdges = [];
    const queue = [{ id: focusNodeId, hop: 0 }];

    visited.add(focusNodeId);

    while (queue.length > 0) {
      const { id, hop } = queue.shift();
      const node = this.nodes.get(id);
      if (node) {
        resultNodes.push({ id, ...node });
      }

      if (hop < maxHops) {
        this.edges.forEach(edge => {
          if (edge.from === id && !visited.has(edge.to)) {
            visited.add(edge.to);
            queue.push({ id: edge.to, hop: hop + 1 });
            resultEdges.push(edge);
          } else if (edge.to === id && !visited.has(edge.from)) {
            visited.add(edge.from);
            queue.push({ id: edge.from, hop: hop + 1 });
            resultEdges.push(edge);
          }
        });
      }
    }

    return { nodes: resultNodes, edges: resultEdges };
  }

  // 4 & 6. Core Parsing & Extraction
  processConversation(messages) {
    let messageIndex = 0;
    
    // Setup standard PROJECT root node
    this.addNode('project_root', 'PROJECT', 'Active Working Project', { description: 'Target transfer workspace' });

    messages.forEach(msg => {
      const content = msg.content || '';
      const role = msg.role || 'user';
      const score = this.scoreMessage(content, role);
      const msgId = `msg_${messageIndex++}`;

      // Track Execution Context Topics & Solved problems deterministically
      if (content.toLowerCase().includes('solved') || content.toLowerCase().includes('fixed') || content.toLowerCase().includes('working now')) {
        const sentenceMatch = content.match(/[^.!?]*?(?:solved|fixed)[^.!?]*/i);
        if (sentenceMatch) this.executionContext.solvedProblems.add(sentenceMatch[0].trim());
      }
      if (content.toLowerCase().includes('avoid') || content.toLowerCase().includes('failed') || content.toLowerCase().includes('do not repeat')) {
        const sentenceMatch = content.match(/[^.!?]*?(?:avoid|failed)[^.!?]*/i);
        if (sentenceMatch) this.executionContext.failedApproaches.add(sentenceMatch[0].trim());
      }

      // Populate priority memories
      if (score >= 6) {
        this.priorityMemories.push({
          content: content.length > 150 ? content.substring(0, 150) + '...' : content,
          priority_score: score,
          priority_reason: role === 'user' ? 'Direct user requirement/intent' : 'Key developer implementation instructions'
        });
      }

      // Deterministic Node & Relationship extraction
      // A. Extract Tech Stack
      const techKeywords = ['react', 'next.js', 'node', 'vue', 'chrome extension', 'javascript', 'typescript', 'rust', 'actix-web', 'sqlx', 'css', 'vanilla css', 'flexbox', 'html', 'gemini', 'gemini api', 'tailwind'];
      techKeywords.forEach(tech => {
        if (content.toLowerCase().includes(tech)) {
          const techId = `tech_${tech.replace(/\s+/g, '_')}`;
          this.addNode(techId, 'TECH_STACK', tech.toUpperCase(), { name: tech });
          this.addEdge(techId, 'project_root', 'IMPLEMENTED_WITH');
          this.executionContext.topicsDiscussed.add(tech);
        }
      });

      // B. Extract Tasks / Objectives
      if (content.toLowerCase().includes('todo') || content.toLowerCase().includes('task') || content.toLowerCase().includes('objective')) {
        const sentences = content.split(/[.!?\n]/);
        sentences.forEach((s, idx) => {
          if (s.toLowerCase().includes('todo') || s.toLowerCase().includes('task') || s.toLowerCase().includes('objective')) {
            const taskId = `${msgId}_task_${idx}`;
            const cleanLabel = s.replace(/[-*•]/g, '').trim();
            if (cleanLabel.length > 10) {
              this.addNode(taskId, 'TASK', cleanLabel, { status: 'active' });
              this.addEdge(taskId, 'project_root', 'DEPENDS_ON');
            }
          }
        });
      }

      // C. Extract Decisions
      if (content.toLowerCase().includes('decided') || content.toLowerCase().includes('let\'s use') || content.toLowerCase().includes('we will use')) {
        const sentences = content.split(/[.!?\n]/);
        sentences.forEach((s, idx) => {
          if (s.toLowerCase().includes('decided') || s.toLowerCase().includes('use')) {
            const decId = `${msgId}_dec_${idx}`;
            const cleanLabel = s.replace(/[-*•]/g, '').trim();
            if (cleanLabel.length > 10) {
              this.addNode(decId, 'DECISION', cleanLabel);
              this.addEdge(decId, 'project_root', 'RELATED_TO');
            }
          }
        });
      }

      // D. Extract Issues / Errors
      if (content.toLowerCase().includes('error') || content.toLowerCase().includes('bug') || content.toLowerCase().includes('fail')) {
        const sentences = content.split(/[.!?\n]/);
        sentences.forEach((s, idx) => {
          if (s.toLowerCase().includes('error') || s.toLowerCase().includes('bug') || s.toLowerCase().includes('fail')) {
            const issueId = `${msgId}_issue_${idx}`;
            const cleanLabel = s.replace(/[-*•]/g, '').trim();
            if (cleanLabel.length > 10) {
              this.addNode(issueId, 'ISSUE', cleanLabel);
              this.addEdge(issueId, 'project_root', 'BLOCKED_BY');
            }
          }
        });
      }
    });

    // DEDUPLICATE Priority memories and execution context topics
    const rawMemories = this.priorityMemories.map(m => m.content);
    const dedupedMemories = this.deduplicateItems(rawMemories);
    this.priorityMemories = this.priorityMemories.filter(m => dedupedMemories.includes(m.content));
  }

  // Compile deterministic data into a Structured Memory Packet
  getStructuredPacket() {
    return {
      system_context: 'Deterministic State Restoration & Continuity Protocol — Version 2.0',
      priority_memory: this.priorityMemories.map(m => `[Score ${m.priority_score}/10] ${m.content}`).slice(0, 8),
      active_tasks: Array.from(this.nodes.values()).filter(n => n.type === 'TASK').map(n => n.label),
      unresolved_issues: Array.from(this.nodes.values()).filter(n => n.type === 'ISSUE').map(n => n.label),
      important_decisions: Array.from(this.nodes.values()).filter(n => n.type === 'DECISION').map(n => n.label),
      execution_context: {
        topics_discussed: Array.from(this.executionContext.topicsDiscussed),
        problems_solved: Array.from(this.executionContext.solvedProblems),
        approaches_to_avoid: Array.from(this.executionContext.failedApproaches),
        current_focus: Array.from(this.nodes.values()).filter(n => n.type === 'TASK').map(n => n.label)[0] || 'General System Implementation'
      },
      user_preferences: Array.from(this.nodes.values()).filter(n => n.type === 'PREFERENCE').map(n => n.label)
    };
  }
}

export function formatContextPrompt(context, targetPlatform) {
  if (context.aiEnhanced && context.aiStatus === 'success') {
    const src = getPlatformDisplayName(context.platform);
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

    const divider = '═'.repeat(60);

    if (dominantIntent === 'coding') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Optimized for Coding]
You are continuing a software development and implementation session started on ${src}.
The conversation history has been processed, verified, and distilled by the Advanced AI Context Distillation Engine.

📋 Project Summary:
${summary}

🎯 Current Coding Objective:
- Objective: ${task}
- Specific Intent: ${intent}

💻 Tech Stack & Active Files:
- Stack: ${tech}
- Target Files: ${files}

📁 Key Code & Configurations:
${codeBlocksJoin(e.important_code)}

🔑 Architecture Decisions:
${decisions}

⚠️ Constraints & Limits:
${constraints}

📋 Pending Actions:
${pending}

${divider}
🚀 Optimized Handoff Prompt & Instructions:
${handoff}`;
    }

    if (dominantIntent === 'debugging') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Optimized for Debugging]
You are continuing a critical software debugging session started on ${src}.
The conversation history has been processed, verified, and distilled by the Advanced AI Context Distillation Engine.

📋 Project Summary:
${summary}

🎯 Core Debugging Target:
- Objective: ${task}
- Intent: ${intent}

❌ Tracked Errors & Issues:
${bulletJoin(e.errors_and_issues)}

💡 Attempted Solves & Approaches:
${bulletJoin(e.failed_attempts)}

✅ Successful Solutions:
${bulletJoin(e.successful_solutions)}

💻 Tech Stack & Active Files:
- Stack: ${tech}
- Target Files: ${files}

📁 Error-Prone Code Snippets:
${codeBlocksJoin(e.important_code)}

${divider}
🚀 Optimized Handoff Prompt & Instructions:
${handoff}`;
    }

    if (dominantIntent === 'brainstorming') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Optimized for Brainstorming & Planning]
You are continuing a brainstorming, ideation, or product planning session started on ${src}.
The conversation history has been processed, verified, and distilled by the Advanced AI Context Distillation Engine.

📋 Core Topic/Overview:
${summary}

🎯 Brainstorming Goal:
- Target Objective: ${task}
- Intent/Vision: ${intent}

💡 Deduplicated Key Concepts (Phase 2):
${bulletJoin(e.deduplicated_context)}

💭 Long Term Project Memory:
${bulletJoin(e.long_term_memory)}

🔑 Key Choices & Decisions:
${decisions}

⚠️ Constraints & Limits:
${constraints}

📋 Next Planning Actions:
${pending}

${divider}
🚀 Optimized Handoff Prompt & Instructions:
${handoff}`;
    }

    if (dominantIntent === 'research') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Optimized for Research & Studying]
You are continuing a conceptual research or academic study session started on ${src}.
The conversation history has been processed, verified, and distilled by the Advanced AI Context Distillation Engine.

📋 Research Focus:
${summary}

🎯 Study Target:
- Focus Area: ${task}
- Knowledge Goal: ${intent}

💡 Deduplicated Core Concepts:
${bulletJoin(e.deduplicated_context)}

💭 Long Term Project Memory:
${bulletJoin(e.long_term_memory)}

🤖 AI Inferred Intelligence Layer:
${bulletJoin(e.ai_inferred_context)}

⚙️ Developer/User Preferences:
${bulletJoin(e.user_preferences)}

${divider}
🚀 Optimized Handoff Prompt & Instructions:
${handoff}`;
    }

    if (dominantIntent === 'writing') {
      return `[🔄 AI-Enhanced Cross Context Transfer — Optimized for Composition & Writing]
You are continuing a text composition or writing session started on ${src}.
The conversation history has been processed, verified, and distilled by the Advanced AI Context Distillation Engine.

📋 Narrative/Content Overview:
${summary}

🎯 Writing Objective:
- Current Target: ${task}
- Creative Intent: ${intent}

⚙️ Style Guidelines & Preferences:
${bulletJoin(e.user_preferences)}

💡 Synthesized Ideas & Contexts:
${bulletJoin(e.deduplicated_context)}

📋 Next Composition Steps:
${pending}

${divider}
🚀 Optimized Handoff Prompt & Instructions:
${handoff}`;
    }

    // General fallback
    return `[🔄 AI-Enhanced Cross Context Transfer]
You are continuing a conversation that was started on ${src}.
The conversation history has been processed, verified, and distilled by the Advanced AI Context Distillation Engine.

📋 Project Summary:
${summary}

🎯 Current Task & Intent:
- Task: ${task}
- Intent: ${intent}

💻 Tech Stack & Active Files:
- Stack: ${tech}
- Files: ${files}

🔑 Architecture Decisions:
${decisions}

⚠️ Constraints & Limits:
${constraints}

📋 Pending Tasks:
${pending}

${divider}
🚀 Optimized Handoff Prompt & Instructions:
${handoff}`;
  }

  // ──────────────────────────────────────────────────────────────
  // DETERMINISTIC FALLBACK — Run Memory Graph & Deduplication Engine locally
  // ──────────────────────────────────────────────────────────────
  const engine = new ContextIntelligenceEngine();
  engine.processConversation(context.messages);
  const packet = engine.getStructuredPacket();

  const sourceName = getPlatformDisplayName(context.platform);
  
  // Choose the first user query as initial prompt focus / handoff hint
  const firstUser = context.messages.find(m => m.role === 'user');
  const handoffHint = firstUser ? firstUser.content : 'Continue active working session';
  const handoffTruncated = handoffHint.length > 300 ? handoffHint.substring(0, 300) + '...' : handoffHint;

  return `[🔄 Cross Context Transfer — State Restoration Continuity Protocol]
You are continuing a software engineering and collaborative session started on ${sourceName}.
The active conversation context has been compiled into a structured Memory Graph by our Context Intelligence Engine to enable seamless continuation and absolute technical continuity.

⚠️ COLLABORATOR CONTINUITY INSTRUCTIONS:
1. CONTINUE INSTANTLY from the current state outlined below.
2. DO NOT restart context, summarize the project, or re-explain topics.
3. DO NOT re-introduce yourself or write conversational filler. Act as an active, ongoing pair-programmer/collaborator.
4. Verify the active checklist and focus area and align immediately.

════════════════════════════════════════════════════════════
📋 DETERMINISTIC STATE RESTORATION PACKET
════════════════════════════════════════════════════════════

⚙️ SYSTEM CONTEXT:
${packet.system_context}

🧠 DISTILLED PRIORITY SPECIFICATIONS:
${packet.priority_memory.map(m => `• ${m}`).join('\n') || 'None recorded'}

🎯 ACTIVE TASKS Checklist:
${packet.active_tasks.map(t => `[ ] ${t}`).join('\n') || 'No pending tasks'}

❌ UNRESOLVED BLOCKERS & ISSUES:
${packet.unresolved_issues.map(i => `• ${i}`).join('\n') || 'None active'}

🔑 ARCHITECTURE & TECHNICAL DECISIONS:
${packet.important_decisions.map(d => `• ${d}`).join('\n') || 'None recorded'}

🔄 ACTIVE EXECUTION CONTEXT:
- Current Focus Area: ${packet.execution_context.current_focus}
- Core Topics Discussed: ${packet.execution_context.topics_discussed.join(', ') || 'None'}
- Solved Problems & Closed Issues:
${packet.execution_context.problems_solved.map(p => `  ✓ ${p}`).join('\n') || '  None'}
- Failed Approaches to Avoid:
${packet.execution_context.approaches_to_avoid.map(a => `  ⚠️ ${a}`).join('\n') || '  None'}

⚙️ DEVELOPER PREFERENCES:
${packet.user_preferences.map(p => `• ${p}`).join('\n') || 'None configured'}

════════════════════════════════════════════════════════════
🚀 CONTINUATION FOCUS & HANDOFF:
${handoffTruncated}
════════════════════════════════════════════════════════════
Please confirm receipt of this context state. Acknowledge what tasks you are taking over, and ask the user what to focus on next to continue seamlessly.`;
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
