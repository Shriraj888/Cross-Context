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
        // Core CE optimization: Do not traverse through project_root to unrelated siblings
        if (id === 'project_root') continue;

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
      const messageNodes = [];

      // Track Execution Context Topics & Solved problems deterministically
      if (content.toLowerCase().includes('solved') || content.toLowerCase().includes('fixed') || content.toLowerCase().includes('working now')) {
        const sentenceMatch = content.match(/[^.!?]*?(?:solved|fixed|working now)[^.!?]*/i);
        if (sentenceMatch) this.executionContext.solvedProblems.add(sentenceMatch[0].trim());
      }
      if (content.toLowerCase().includes('avoid') || content.toLowerCase().includes('failed') || content.toLowerCase().includes('do not repeat')) {
        const sentenceMatch = content.match(/[^.!?]*?(?:avoid|failed|do not repeat)[^.!?]*/i);
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
      const techKeywords = [
        'react', 'next.js', 'node', 'vue', 'chrome extension', 'javascript', 'typescript', 'rust', 'actix-web', 'sqlx', 
        'css', 'vanilla css', 'flexbox', 'html', 'gemini', 'gemini api', 'tailwind', 'tailwindcss', 'python', 'django', 
        'flask', 'fastapi', 'express', 'mongodb', 'postgresql', 'sqlite', 'mysql', 'docker', 'kubernetes', 'aws', 
        'firebase', 'supabase', 'git', 'github', 'svelte', 'angular'
      ];
      techKeywords.forEach(tech => {
        const regex = new RegExp(`\\b${tech.replace('.', '\\.')}\\b`, 'i');
        if (regex.test(content)) {
          const techId = `tech_${tech.replace(/\s+/g, '_').replace('.', '_')}`;
          this.addNode(techId, 'TECH_STACK', tech.toUpperCase(), { name: tech });
          this.addEdge(techId, 'project_root', 'IMPLEMENTED_WITH');
          this.executionContext.topicsDiscussed.add(tech);
          messageNodes.push(techId);
        }
      });

      // B. Extract Tasks / Objectives
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        const taskId = `${msgId}_task_${idx}`;
        if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]')) {
          const cleanLabel = trimmed.replace(/^-\s*\[[ x]\]\s*/i, '').trim();
          if (cleanLabel.length > 5) {
            const isCompleted = trimmed.includes('[x]');
            this.addNode(taskId, 'TASK', cleanLabel, { status: isCompleted ? 'completed' : 'active' });
            this.addEdge(taskId, 'project_root', 'DEPENDS_ON');
            messageNodes.push(taskId);
          }
        } else if (trimmed.toLowerCase().startsWith('todo:') || trimmed.toLowerCase().startsWith('task:')) {
          const cleanLabel = trimmed.replace(/^(todo|task):\s*/i, '').trim();
          if (cleanLabel.length > 5) {
            this.addNode(taskId, 'TASK', cleanLabel, { status: 'active' });
            this.addEdge(taskId, 'project_root', 'DEPENDS_ON');
            messageNodes.push(taskId);
          }
        }
      });

      // Fallback sentence-based task extraction if no lists found
      if (!content.includes('- [ ]') && !content.includes('- [x]')) {
        if (content.toLowerCase().includes('todo') || content.toLowerCase().includes('task') || content.toLowerCase().includes('objective')) {
          const sentences = content.split(/[.!?\n]/);
          sentences.forEach((s, idx) => {
            if (s.toLowerCase().includes('todo') || s.toLowerCase().includes('task') || s.toLowerCase().includes('objective')) {
              const taskId = `${msgId}_task_fallback_${idx}`;
              const cleanLabel = s.replace(/[-*•]/g, '').trim();
              if (cleanLabel.length > 12) {
                this.addNode(taskId, 'TASK', cleanLabel, { status: 'active' });
                this.addEdge(taskId, 'project_root', 'DEPENDS_ON');
                messageNodes.push(taskId);
              }
            }
          });
        }
      }

      // C. Extract Decisions
      if (content.toLowerCase().includes('decided') || content.toLowerCase().includes('let\'s use') || content.toLowerCase().includes('we will use') || content.toLowerCase().includes('decided to')) {
        const sentences = content.split(/[.!?\n]/);
        sentences.forEach((s, idx) => {
          const lower = s.toLowerCase();
          if (lower.includes('decided') || lower.includes('we will use') || lower.includes('let\'s use') || lower.includes('resolved to')) {
            const decId = `${msgId}_dec_${idx}`;
            const cleanLabel = s.replace(/[-*•]/g, '').trim();
            if (cleanLabel.length > 12) {
              this.addNode(decId, 'DECISION', cleanLabel);
              this.addEdge(decId, 'project_root', 'RELATED_TO');
              messageNodes.push(decId);
            }
          }
        });
      }

      // D. Extract Issues / Errors
      if (content.toLowerCase().includes('error') || content.toLowerCase().includes('bug') || content.toLowerCase().includes('fail') || content.toLowerCase().includes('fails with') || content.toLowerCase().includes('fails on')) {
        const sentences = content.split(/[.!?\n]/);
        sentences.forEach((s, idx) => {
          const lower = s.toLowerCase();
          if (lower.includes('error') || lower.includes('bug') || lower.includes('fail') || lower.includes('crash') || lower.includes('exception')) {
            const issueId = `${msgId}_issue_${idx}`;
            const cleanLabel = s.replace(/[-*•]/g, '').trim();
            if (cleanLabel.length > 12) {
              this.addNode(issueId, 'ISSUE', cleanLabel);
              this.addEdge(issueId, 'project_root', 'BLOCKED_BY');
              messageNodes.push(issueId);
            }
          }
        });
      }

      // Connect all nodes created in this message to form a semantic cluster
      for (let i = 0; i < messageNodes.length; i++) {
        for (let j = i + 1; j < messageNodes.length; j++) {
          this.addEdge(messageNodes[i], messageNodes[j], 'RELATED_TO');
        }
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

    const divider = '═'.repeat(60);

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
${handoff}${transcriptSection}`;
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
${handoff}${transcriptSection}`;
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
${handoff}${transcriptSection}`;
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
${handoff}${transcriptSection}`;
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
${handoff}${transcriptSection}`;
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
${handoff}${transcriptSection}`;
  }

  // ──────────────────────────────────────────────────────────────
  // DETERMINISTIC FALLBACK — Run Memory Graph & Deduplication Engine locally
  // ──────────────────────────────────────────────────────────────
  const engine = new ContextIntelligenceEngine();
  engine.processConversation(context.messages);

  // 1. Identify current focus node (most recent TASK or ISSUE)
  const nodesArray = Array.from(engine.nodes.entries()); // [[id, node], ...]
  let focusNodeId = null;
  let focusNodeLabel = '';
  for (let i = nodesArray.length - 1; i >= 0; i--) {
    const [id, node] = nodesArray[i];
    if (node.type === 'TASK' || node.type === 'ISSUE') {
      focusNodeId = id;
      focusNodeLabel = node.label;
      break;
    }
  }

  // Fallback to project root if no specific focus node found
  if (!focusNodeId) {
    focusNodeId = 'project_root';
    focusNodeLabel = 'General System Implementation';
  }

  // 2. Retrieve relevant subgraph (within 2 hops of focus node)
  const subgraph = engine.getRelevantSubgraph(focusNodeId, 2);
  const subgraphNodeIds = new Set(subgraph.nodes.map(n => n.id));

  // 3. Filter deterministic lists to only include nodes present in the relevant subgraph
  const allNodes = Array.from(engine.nodes.values());
  const relevantNodes = allNodes.filter(n => subgraphNodeIds.has(n.id) || n.id === 'project_root');

  const activeTasks = relevantNodes.filter(n => n.type === 'TASK').map(n => n.label);
  const unresolvedIssues = relevantNodes.filter(n => n.type === 'ISSUE').map(n => n.label);
  const importantDecisions = relevantNodes.filter(n => n.type === 'DECISION').map(n => n.label);
  const techStack = relevantNodes.filter(n => n.type === 'TECH_STACK').map(n => n.label);
  const userPreferences = relevantNodes.filter(n => n.type === 'PREFERENCE').map(n => n.label);

  const priorityMemories = engine.priorityMemories.map(m => `[Score ${m.priority_score}/10] ${m.content}`).slice(0, 8);

  const sourceName = getPlatformDisplayName(context.platform);
  
  // Choose the first user query as initial prompt focus / handoff hint
  const firstUser = context.messages.find(m => m.role === 'user');
  const handoffHint = firstUser ? firstUser.content : 'Continue active working session';
  const handoffTruncated = handoffHint.length > 300 ? handoffHint.substring(0, 300) + '...' : handoffHint;
  const idTag = context.id ? `[Context ID: ${context.id}]\n` : '';

  return `[🔄 Cross Context Transfer — State Restoration Briefing]
${idTag}I was working on a project with ${sourceName}. Here is where we left off:

⚙️ What I was building:
- System Context: Deterministic State Restoration & Continuity Protocol — Version 2.0
- Active Execution Context:
  - Current Focus Area: ${focusNodeLabel}
  - Core Topics Discussed: ${techStack.join(', ') || 'None'}
  - Solved Problems & Closed Issues:
${Array.from(engine.executionContext.solvedProblems).map(p => `  ✓ ${p}`).join('\n') || '  None'}
  - Failed Approaches to Avoid:
${Array.from(engine.executionContext.failedApproaches).map(a => `  ⚠️ ${a}`).join('\n') || '  None'}

🧠 Distilled priority memories:
${priorityMemories.map(m => `• ${m}`).join('\n') || 'None recorded'}

🔑 Key decisions made so far (relevant to focus):
${importantDecisions.map(d => `• ${d}`).join('\n') || 'None recorded'}

❌ What I was stuck on (unresolved issues relevant to focus):
${unresolvedIssues.map(i => `• ${i}`).join('\n') || 'None active'}

⚙️ My preferences:
${userPreferences.map(p => `• ${p}`).join('\n') || 'None configured'}

🎯 Tasks I was working on (relevant to focus):
${activeTasks.map(t => `[ ] ${t}`).join('\n') || 'No pending tasks'}

🚀 Please continue from:
${handoffTruncated}

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
