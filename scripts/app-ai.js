// AI graph assistant: a chat sidebar that lets an OpenRouter-hosted model read
// the current graph and edit it through tool calls. Every mutating tool goes
// through the normal snapshot/restore path, so each one is a regular undo step.

var AI_KEY_STORAGE = 'noodle-openrouter-key';
var AI_MODEL_STORAGE = 'noodle-openrouter-model';
var AI_DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash-1017:nitro';
var AI_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
var AI_MAX_STEPS = 16;
var AI_MAX_CONTEXT_NODES = 600;
var AI_NODE_TYPES = ['start', 'process', 'decision', 'group', 'floatingText', 'database', 'note', 'document'];

var aiState = {
    messages: [],
    busy: false,
    abortController: null,
    refMap: {}
};

function getAIKey() {
    try { return window.localStorage?.getItem(AI_KEY_STORAGE) || ''; } catch { return ''; }
}

function setAIKey(key) {
    try {
        if (key) window.localStorage?.setItem(AI_KEY_STORAGE, key);
        else window.localStorage?.removeItem(AI_KEY_STORAGE);
    } catch {}
}

function getAIModel() {
    try { return window.localStorage?.getItem(AI_MODEL_STORAGE) || AI_DEFAULT_MODEL; } catch { return AI_DEFAULT_MODEL; }
}

function setAIModel(model) {
    try {
        if (model && model !== AI_DEFAULT_MODEL) window.localStorage?.setItem(AI_MODEL_STORAGE, model);
        else window.localStorage?.removeItem(AI_MODEL_STORAGE);
    } catch {}
}

// ---------------------------------------------------------------------------
// Graph context

function getAIGraphSummary() {
    const nodeList = Object.values(nodes);
    const summary = {
        nodeCount: nodeList.length,
        tableCount: Object.keys(tables || {}).length,
        selectedNodeIds: Array.from(selectedNodes),
        nodes: nodeList.slice(0, AI_MAX_CONTEXT_NODES).map(node => {
            const rect = getNodeRect(node);
            const text = getNodeText(node);
            const metadata = getNodeMetadata(node);
            return {
                id: node.id,
                type: node.type,
                text: text.length > 280 ? `${text.slice(0, 280)}…` : text,
                x: Math.round(node.x),
                y: Math.round(node.y),
                w: rect ? rect.width : null,
                h: rect ? rect.height : null,
                ...(node.bgColor && node.bgColor !== '#ffffff' ? { bg: node.bgColor } : {}),
                ...(node.parentGroupId ? { group: node.parentGroupId } : {}),
                ...(node.el.style.display === 'none' ? { hidden: true } : {}),
                ...(hasVisibleNodeMetadata(metadata) ? { metadata } : {})
            };
        }),
        connections: connections.map(conn => ({
            from: conn.from,
            to: conn.to,
            type: conn.type,
            ...(conn.label ? { label: conn.label } : {}),
            ...(conn.style !== 'straight' ? { style: conn.style } : {})
        }))
    };
    if (nodeList.length > AI_MAX_CONTEXT_NODES) summary.truncated = true;
    return summary;
}

function buildAISystemPrompt() {
    const title = typeof activeDocumentTitle === 'string' ? activeDocumentTitle : '';
    return [
        'You are the graph assistant inside Noodle, a flowchart and whiteboard app.',
        'The user talks to you about their diagram. Answer questions about it, and edit it with the provided tools when asked to create, restructure, clean up or organize.',
        '',
        'Model of the graph:',
        `- Node types: ${AI_NODE_TYPES.join(', ')}. "start" is a start/end pill, "decision" a diamond, "group" a container box, "note" a sticky note, "floatingText" a borderless label.`,
        '- Connections are directed. type "sequence" means "next step" (A then B); type "dependency" means "part of" (B is part of A / hierarchy). Optional label and style (straight, curved, orthogonal).',
        '- Coordinates are canvas pixels; x grows right, y grows down. Group membership comes from geometry: a node inside a group box belongs to it.',
        '',
        'How to work:',
        '- Prefer few batched tool calls (one add_nodes with many nodes, then one add_connections).',
        '- New nodes can carry a "ref" name; use that ref as from/to in add_connections within the same conversation turn.',
        '- After structural changes, call run_layout ("dag" for left-to-right flows, "tidy" for compact per-component layout) instead of hand-placing coordinates, unless the user wants a specific arrangement.',
        '- Use group_nodes to cluster related nodes into labelled containers; run layout BEFORE grouping, since grouping wraps nodes where they currently are.',
        '- Keep node text short (a few words). Do not delete or rewrite content the user did not ask you to change.',
        '- When finished, reply with a brief plain summary of what you changed. Use short markdown (bold, lists) only when helpful.',
        '',
        `Document title: ${title || 'Untitled'}`,
        'Current graph (JSON, refreshed every step):',
        JSON.stringify(getAIGraphSummary())
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Tool definitions

var AI_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'add_nodes',
            description: 'Create one or more nodes. Omit x/y to auto-place them beside the existing graph (then call run_layout).',
            parameters: {
                type: 'object',
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                ref: { type: 'string', description: 'Temporary name to reference this node in later tool calls.' },
                                type: { type: 'string', enum: AI_NODE_TYPES },
                                text: { type: 'string' },
                                x: { type: 'number' },
                                y: { type: 'number' },
                                bg_color: { type: 'string', description: 'CSS color, e.g. #dcfce7' },
                                text_color: { type: 'string' }
                            },
                            required: ['text']
                        }
                    }
                },
                required: ['nodes']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_nodes',
            description: 'Change text, type, colors, position or size of existing nodes. Only provided fields change.',
            parameters: {
                type: 'object',
                properties: {
                    updates: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                text: { type: 'string' },
                                type: { type: 'string', enum: AI_NODE_TYPES },
                                x: { type: 'number' },
                                y: { type: 'number' },
                                width: { type: 'number' },
                                height: { type: 'number' },
                                bg_color: { type: 'string' },
                                text_color: { type: 'string' }
                            },
                            required: ['id']
                        }
                    }
                },
                required: ['updates']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_nodes',
            description: 'Delete nodes and their connections. Deleting a group node only removes the container (ungroups); its members stay.',
            parameters: {
                type: 'object',
                properties: { ids: { type: 'array', items: { type: 'string' } } },
                required: ['ids']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'add_connections',
            description: 'Connect nodes. from/to accept node ids or refs from add_nodes.',
            parameters: {
                type: 'object',
                properties: {
                    connections: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                from: { type: 'string' },
                                to: { type: 'string' },
                                type: { type: 'string', enum: ['sequence', 'dependency'] },
                                label: { type: 'string' },
                                style: { type: 'string', enum: ['straight', 'curved', 'orthogonal'] }
                            },
                            required: ['from', 'to']
                        }
                    }
                },
                required: ['connections']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_connections',
            description: 'Change type, label or style of existing connections identified by from/to.',
            parameters: {
                type: 'object',
                properties: {
                    updates: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                from: { type: 'string' },
                                to: { type: 'string' },
                                type: { type: 'string', enum: ['sequence', 'dependency'] },
                                label: { type: 'string' },
                                style: { type: 'string', enum: ['straight', 'curved', 'orthogonal'] }
                            },
                            required: ['from', 'to']
                        }
                    }
                },
                required: ['updates']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_connections',
            description: 'Remove connections identified by from/to.',
            parameters: {
                type: 'object',
                properties: {
                    connections: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: { from: { type: 'string' }, to: { type: 'string' } },
                            required: ['from', 'to']
                        }
                    }
                },
                required: ['connections']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'group_nodes',
            description: 'Wrap nodes in a labelled group container sized around their current positions.',
            parameters: {
                type: 'object',
                properties: {
                    ids: { type: 'array', items: { type: 'string' } },
                    label: { type: 'string' },
                    bg_color: { type: 'string' }
                },
                required: ['ids', 'label']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_layout',
            description: 'Auto-arrange nodes. "dag" = layered left-to-right flow; "tidy" = compact layout per connected component. Optionally limit to ids.',
            parameters: {
                type: 'object',
                properties: {
                    kind: { type: 'string', enum: ['dag', 'tidy'] },
                    ids: { type: 'array', items: { type: 'string' } }
                },
                required: ['kind']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'select_nodes',
            description: 'Select (highlight) nodes for the user, e.g. to point at answers. Empty list clears selection.',
            parameters: {
                type: 'object',
                properties: { ids: { type: 'array', items: { type: 'string' } } },
                required: ['ids']
            }
        }
    }
];

// ---------------------------------------------------------------------------
// Tool execution

function resolveAINodeId(idOrRef) {
    const key = String(idOrRef ?? '');
    if (nodes[key]) return key;
    if (aiState.refMap[key] && nodes[aiState.refMap[key]]) return aiState.refMap[key];
    return null;
}

function mutateAIGraph(mutator) {
    const snapshot = serializeGraphState();
    snapshot.selectedConnectionIndexes = [];
    const result = mutator(snapshot);
    restoreGraphState(snapshot);
    saveHistoryState();
    return result;
}

function getAIAutoPlacementOrigin() {
    const rects = Object.values(nodes).map(node => getNodeRect(node)).filter(Boolean);
    if (!rects.length) return { x: 100, y: 100 };
    return {
        x: Math.max(...rects.map(rect => rect.right)) + 140,
        y: Math.min(...rects.map(rect => rect.top))
    };
}

function applyAINodeColors(target, spec) {
    const bg = sanitizeCSSColor(spec.bg_color);
    const fg = sanitizeCSSColor(spec.text_color);
    if (bg) target.bgColor = bg;
    if (fg) target.textColor = fg;
}

var AI_TOOL_HANDLERS = {
    add_nodes(args) {
        const specs = Array.isArray(args.nodes) ? args.nodes : [];
        if (!specs.length) return { error: 'nodes is empty' };
        const origin = getAIAutoPlacementOrigin();
        const created = [];
        mutateAIGraph(snapshot => {
            let autoIndex = 0;
            specs.forEach(spec => {
                const type = AI_NODE_TYPES.includes(spec.type) ? spec.type : 'process';
                const id = `node_${snapshot.nodeIdCounter++}`;
                const hasPosition = Number.isFinite(spec.x) && Number.isFinite(spec.y);
                const node = {
                    id,
                    type,
                    x: hasPosition ? Math.round(spec.x) : origin.x + Math.floor(autoIndex / 8) * 240,
                    y: hasPosition ? Math.round(spec.y) : origin.y + (autoIndex % 8) * 110,
                    text: String(spec.text ?? getDefaultNodeLabel(type))
                };
                if (!hasPosition) autoIndex += 1;
                if (type === 'group') {
                    node.width = GROUP_NODE_DEFAULT_SIZE.width;
                    node.height = GROUP_NODE_DEFAULT_SIZE.height;
                }
                applyAINodeColors(node, spec);
                snapshot.nodes.push(node);
                if (spec.ref) aiState.refMap[String(spec.ref)] = id;
                created.push(spec.ref ? { ref: spec.ref, id } : { id });
            });
        });
        return { created };
    },

    update_nodes(args) {
        const updates = Array.isArray(args.updates) ? args.updates : [];
        const missing = [];
        let updated = 0;
        mutateAIGraph(snapshot => {
            const byId = Object.fromEntries(snapshot.nodes.map(node => [node.id, node]));
            updates.forEach(spec => {
                const node = byId[resolveAINodeId(spec.id)];
                if (!node || node.type === 'table') { missing.push(spec.id); return; }
                if (typeof spec.text === 'string') {
                    node.text = spec.text;
                    delete node.html;
                }
                if (AI_NODE_TYPES.includes(spec.type)) node.type = spec.type;
                if (Number.isFinite(spec.x)) node.x = Math.round(spec.x);
                if (Number.isFinite(spec.y)) node.y = Math.round(spec.y);
                if (Number.isFinite(spec.width)) node.width = Math.round(spec.width);
                if (Number.isFinite(spec.height)) node.height = Math.round(spec.height);
                applyAINodeColors(node, spec);
                updated += 1;
            });
        });
        return missing.length ? { updated, missing } : { updated };
    },

    delete_nodes(args) {
        const ids = new Set((Array.isArray(args.ids) ? args.ids : []).map(resolveAINodeId).filter(Boolean));
        if (!ids.size) return { error: 'no matching nodes' };
        mutateAIGraph(snapshot => {
            snapshot.nodes = snapshot.nodes.filter(node => !ids.has(node.id));
            snapshot.nodes.forEach(node => {
                if (node.parentGroupId && ids.has(node.parentGroupId)) delete node.parentGroupId;
            });
            snapshot.connections = snapshot.connections.filter(conn => !ids.has(conn.from) && !ids.has(conn.to));
            ['collapsedNodes', 'collapsedSequenceNodes', 'collapsedDependencyNodes', 'selectedNodes'].forEach(key => {
                if (Array.isArray(snapshot[key])) snapshot[key] = snapshot[key].filter(id => !ids.has(id));
            });
        });
        return { deleted: ids.size };
    },

    add_connections(args) {
        const specs = Array.isArray(args.connections) ? args.connections : [];
        const skipped = [];
        let added = 0;
        mutateAIGraph(snapshot => {
            specs.forEach(spec => {
                const from = resolveAINodeId(spec.from);
                const to = resolveAINodeId(spec.to);
                if (!from || !to || from === to) { skipped.push({ from: spec.from, to: spec.to, reason: 'unknown node' }); return; }
                if (snapshot.connections.some(conn => conn.from === from && conn.to === to)) {
                    skipped.push({ from: spec.from, to: spec.to, reason: 'already connected' });
                    return;
                }
                snapshot.connections.push(normalizeConnection({ from, to, type: spec.type, label: spec.label, style: spec.style }));
                added += 1;
            });
        });
        return skipped.length ? { added, skipped } : { added };
    },

    update_connections(args) {
        const updates = Array.isArray(args.updates) ? args.updates : [];
        const missing = [];
        let updated = 0;
        mutateAIGraph(snapshot => {
            updates.forEach(spec => {
                const from = resolveAINodeId(spec.from);
                const to = resolveAINodeId(spec.to);
                const conn = snapshot.connections.find(c => c.from === from && c.to === to);
                if (!conn) { missing.push({ from: spec.from, to: spec.to }); return; }
                if (spec.type) conn.type = normalizeConnectionType(spec.type);
                if (typeof spec.label === 'string') conn.label = normalizeConnectionLabel(spec.label);
                if (spec.style) conn.style = normalizeConnectionStyle(spec.style);
                updated += 1;
            });
        });
        return missing.length ? { updated, missing } : { updated };
    },

    delete_connections(args) {
        const pairs = (Array.isArray(args.connections) ? args.connections : [])
            .map(spec => `${resolveAINodeId(spec.from)}->${resolveAINodeId(spec.to)}`);
        const pairSet = new Set(pairs);
        let deleted = 0;
        mutateAIGraph(snapshot => {
            const before = snapshot.connections.length;
            snapshot.connections = snapshot.connections.filter(conn => !pairSet.has(`${conn.from}->${conn.to}`));
            deleted = before - snapshot.connections.length;
        });
        return { deleted };
    },

    group_nodes(args) {
        const ids = (Array.isArray(args.ids) ? args.ids : []).map(resolveAINodeId).filter(Boolean);
        if (!ids.length) return { error: 'no matching nodes' };
        const rects = ids.map(id => getNodeRect(id)).filter(Boolean);
        const padX = 32;
        const padTop = 56;
        const padBottom = 28;
        const left = Math.min(...rects.map(rect => rect.left)) - padX;
        const top = Math.min(...rects.map(rect => rect.top)) - padTop;
        const right = Math.max(...rects.map(rect => rect.right)) + padX;
        const bottom = Math.max(...rects.map(rect => rect.bottom)) + padBottom;
        let groupId = null;
        mutateAIGraph(snapshot => {
            groupId = `node_${snapshot.nodeIdCounter++}`;
            const group = {
                id: groupId,
                type: 'group',
                x: Math.round(left),
                y: Math.round(top),
                width: Math.round(right - left),
                height: Math.round(bottom - top),
                text: String(args.label || 'Group')
            };
            applyAINodeColors(group, args);
            // Groups render beneath members, so insert before them.
            snapshot.nodes.unshift(group);
            const idSet = new Set(ids);
            snapshot.nodes.forEach(node => {
                if (idSet.has(node.id)) node.parentGroupId = groupId;
            });
        });
        return { groupId, members: ids.length };
    },

    run_layout(args) {
        const ids = (Array.isArray(args.ids) ? args.ids : []).map(resolveAINodeId).filter(Boolean);
        const previousSelection = Array.from(selectedNodes);
        clearSelection();
        ids.forEach(id => addToSelection(id));
        if (args.kind === 'tidy') runVisualTidyLayout();
        else runTopologicalLayout();
        clearSelection();
        previousSelection.forEach(id => { if (nodes[id]) addToSelection(id); });
        return { ok: true, scope: ids.length > 1 ? ids.length : 'all' };
    },

    select_nodes(args) {
        const ids = (Array.isArray(args.ids) ? args.ids : []).map(resolveAINodeId).filter(Boolean);
        clearSelection();
        ids.forEach(id => {
            if (nodes[id] && nodes[id].el.style.display !== 'none') addToSelection(id);
        });
        if (typeof updateToolbarColors === 'function') updateToolbarColors();
        return { selected: ids.length };
    }
};

var AI_READONLY_TOOLS = new Set(['select_nodes']);

function executeAIToolCall(toolCall) {
    const name = toolCall.function?.name || '';
    const handler = AI_TOOL_HANDLERS[name];
    if (!handler) return { error: `unknown tool ${name}` };
    let args;
    try {
        args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
    } catch {
        return { error: 'arguments were not valid JSON' };
    }
    try {
        return handler(args || {});
    } catch (err) {
        console.warn('AI tool failed', name, err);
        return { error: String(err?.message || err) };
    }
}

function describeAIToolCall(toolCall, result) {
    const name = toolCall.function?.name || 'tool';
    if (result?.error) return `${name}: ${result.error}`;
    switch (name) {
        case 'add_nodes': return `Added ${result.created?.length || 0} node${result.created?.length === 1 ? '' : 's'}`;
        case 'update_nodes': return `Updated ${result.updated} node${result.updated === 1 ? '' : 's'}`;
        case 'delete_nodes': return `Deleted ${result.deleted} node${result.deleted === 1 ? '' : 's'}`;
        case 'add_connections': return `Added ${result.added} connection${result.added === 1 ? '' : 's'}`;
        case 'update_connections': return `Updated ${result.updated} connection${result.updated === 1 ? '' : 's'}`;
        case 'delete_connections': return `Removed ${result.deleted} connection${result.deleted === 1 ? '' : 's'}`;
        case 'group_nodes': return `Grouped ${result.members} node${result.members === 1 ? '' : 's'}`;
        case 'run_layout': return 'Ran layout';
        case 'select_nodes': return `Selected ${result.selected} node${result.selected === 1 ? '' : 's'}`;
        default: return name;
    }
}

// ---------------------------------------------------------------------------
// OpenRouter streaming client

function mergeAIReasoningDetails(target, incoming) {
    incoming.forEach((detail, position) => {
        const index = Number.isInteger(detail.index) ? detail.index : position;
        const existing = target[index];
        if (!existing) {
            target[index] = { ...detail };
            return;
        }
        ['text', 'summary', 'data'].forEach(field => {
            if (typeof detail[field] === 'string') existing[field] = (existing[field] || '') + detail[field];
        });
        if (detail.signature) existing.signature = detail.signature;
    });
}

async function requestAICompletion(requestMessages, onContent, signal) {
    const response = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getAIKey()}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Noodle'
        },
        body: JSON.stringify({
            model: getAIModel(),
            messages: requestMessages,
            tools: AI_TOOLS,
            tool_choice: 'auto',
            parallel_tool_calls: true,
            stream: true
        }),
        signal
    });

    if (!response.ok) {
        let detail = '';
        try {
            const payload = await response.json();
            detail = payload?.error?.message || '';
        } catch {}
        if (response.status === 401) detail = detail || 'Invalid API key';
        throw new Error(`OpenRouter ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const message = { role: 'assistant', content: '' };
    const toolCalls = [];
    const reasoningDetails = [];
    let buffer = '';

    const handleLine = (line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        let chunk;
        try { chunk = JSON.parse(data); } catch { return; }
        if (chunk.error) throw new Error(chunk.error.message || 'Stream error');
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;
        if (delta.content) {
            message.content += delta.content;
            onContent(message.content);
        }
        if (Array.isArray(delta.reasoning_details)) mergeAIReasoningDetails(reasoningDetails, delta.reasoning_details);
        (delta.tool_calls || []).forEach((callDelta, position) => {
            const index = Number.isInteger(callDelta.index) ? callDelta.index : position;
            const slot = toolCalls[index] || (toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } });
            if (callDelta.id) slot.id = callDelta.id;
            if (callDelta.function?.name && !slot.function.name) slot.function.name = callDelta.function.name;
            if (callDelta.function?.arguments) slot.function.arguments += callDelta.function.arguments;
        });
    };

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            handleLine(line);
        }
    }
    handleLine(buffer.trim());

    const finalToolCalls = toolCalls.filter(Boolean).map((call, index) => ({
        ...call,
        id: call.id || `call_${Date.now()}_${index}`
    }));
    if (finalToolCalls.length) message.tool_calls = finalToolCalls;
    if (reasoningDetails.length) message.reasoning_details = reasoningDetails.filter(Boolean);
    return message;
}

// ---------------------------------------------------------------------------
// Chat UI

function renderAIMarkdown(text = '') {
    const escaped = escapeHTML(text);
    const blocks = escaped.split(/```/);
    return blocks.map((block, blockIndex) => {
        if (blockIndex % 2 === 1) return `<pre><code>${block.replace(/^[a-z]*\n/i, '')}</code></pre>`;
        const lines = block.split('\n');
        let html = '';
        let listTag = null;
        const closeList = () => {
            if (listTag) html += `</${listTag}>`;
            listTag = null;
        };
        lines.forEach(rawLine => {
            const line = rawLine
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            const bullet = line.match(/^\s*[-*]\s+(.*)$/);
            const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
            const heading = line.match(/^\s*#{1,4}\s+(.*)$/);
            if (bullet || numbered) {
                const tag = bullet ? 'ul' : 'ol';
                if (listTag !== tag) { closeList(); html += `<${tag}>`; listTag = tag; }
                html += `<li>${(bullet || numbered)[1]}</li>`;
                return;
            }
            closeList();
            if (heading) html += `<p><strong>${heading[1]}</strong></p>`;
            else if (line.trim()) html += `<p>${line}</p>`;
        });
        closeList();
        return html;
    }).join('');
}

function getAIElements() {
    return {
        sidebar: document.getElementById('aiSidebar'),
        messages: document.getElementById('aiMessages'),
        input: document.getElementById('aiInput'),
        sendBtn: document.getElementById('aiSendBtn'),
        settings: document.getElementById('aiSettings'),
        keyInput: document.getElementById('aiKeyInput'),
        modelInput: document.getElementById('aiModelInput'),
        keyStatus: document.getElementById('aiKeyStatus'),
        suggestions: document.getElementById('aiSuggestions'),
        toggleBtn: document.getElementById('aiToggleBtn')
    };
}

function scrollAIMessagesToEnd() {
    const { messages } = getAIElements();
    if (messages) messages.scrollTop = messages.scrollHeight;
}

function appendAIBubble(role, html = '') {
    const { messages, suggestions } = getAIElements();
    if (suggestions) suggestions.hidden = true;
    const bubble = document.createElement('div');
    bubble.className = `ai-msg ai-msg-${role}`;
    if (html) bubble.innerHTML = html;
    messages.appendChild(bubble);
    scrollAIMessagesToEnd();
    return bubble;
}

function appendAIToolChip(label, isError) {
    const chip = appendAIBubble('tool');
    chip.classList.toggle('ai-msg-tool-error', Boolean(isError));
    chip.textContent = `${isError ? '⚠' : '✓'} ${label}`;
    return chip;
}

function updateAIComposerState() {
    const { sendBtn, input } = getAIElements();
    if (!sendBtn) return;
    sendBtn.textContent = aiState.busy ? 'Stop' : 'Send';
    sendBtn.classList.toggle('ai-stop', aiState.busy);
    sendBtn.setAttribute('aria-label', aiState.busy ? 'Stop response' : 'Send message');
    if (input) input.placeholder = getAIKey() ? 'Ask or tell your graph what to do…' : 'Add your OpenRouter key first';
}

function refreshAISettingsUI() {
    const { keyInput, modelInput, keyStatus, settings } = getAIElements();
    const key = getAIKey();
    if (keyInput) keyInput.value = '';
    if (keyInput) keyInput.placeholder = key ? `Saved (…${key.slice(-4)})` : 'sk-or-v1-…';
    if (modelInput) modelInput.value = getAIModel();
    if (keyStatus) keyStatus.textContent = key ? 'Key saved in this browser only.' : 'No key saved yet.';
    if (settings && !key) settings.hidden = false;
    updateAIComposerState();
}

function toggleAISidebar(forceOpen) {
    const { sidebar, input, toggleBtn } = getAIElements();
    if (!sidebar) return;
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : sidebar.hidden;
    sidebar.hidden = !shouldOpen;
    document.body.classList.toggle('ai-sidebar-open', shouldOpen);
    if (toggleBtn) toggleBtn.setAttribute('aria-pressed', String(shouldOpen));
    if (shouldOpen) {
        refreshAISettingsUI();
        (getAIKey() ? input : getAIElements().keyInput)?.focus();
    }
}

function toggleAISettings() {
    const { settings } = getAIElements();
    if (!settings) return;
    settings.hidden = !settings.hidden;
    if (!settings.hidden) refreshAISettingsUI();
}

function resetAIChat() {
    if (aiState.busy) aiState.abortController?.abort();
    aiState.messages = [];
    aiState.refMap = {};
    const { messages, suggestions } = getAIElements();
    if (messages) messages.innerHTML = '';
    if (suggestions) suggestions.hidden = false;
}

async function runAIAgentTurn(userText) {
    if (!getAIKey()) {
        toggleAISettings();
        showToast('Add your OpenRouter API key first.', 'warning');
        return;
    }
    if (navigator.onLine === false) {
        showToast('You are offline — the assistant needs a connection.', 'warning');
        return;
    }

    aiState.busy = true;
    aiState.abortController = new AbortController();
    updateAIComposerState();

    appendAIBubble('user', renderAIMarkdown(userText));
    aiState.messages.push({ role: 'user', content: userText });

    const startSnapshot = JSON.stringify(serializeGraphState());
    let changedGraph = false;

    try {
        for (let step = 0; step < AI_MAX_STEPS; step += 1) {
            const bubble = appendAIBubble('assistant');
            bubble.classList.add('ai-pending');
            bubble.innerHTML = '<span class="ai-typing"><i></i><i></i><i></i></span>';

            const requestMessages = [{ role: 'system', content: buildAISystemPrompt() }, ...aiState.messages];
            const message = await requestAICompletion(requestMessages, (content) => {
                bubble.classList.remove('ai-pending');
                bubble.innerHTML = renderAIMarkdown(content);
                scrollAIMessagesToEnd();
            }, aiState.abortController.signal);

            aiState.messages.push(message);
            if (message.content) {
                bubble.classList.remove('ai-pending');
                bubble.innerHTML = renderAIMarkdown(message.content);
            } else {
                bubble.remove();
            }

            if (!message.tool_calls?.length) break;

            message.tool_calls.forEach(toolCall => {
                const result = executeAIToolCall(toolCall);
                if (!result?.error && !AI_READONLY_TOOLS.has(toolCall.function?.name)) changedGraph = true;
                appendAIToolChip(describeAIToolCall(toolCall, result), Boolean(result?.error));
                aiState.messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(result ?? {})
                });
            });

            if (step === AI_MAX_STEPS - 1) appendAIBubble('note', 'Stopped after the maximum number of steps.');
        }
    } catch (err) {
        document.querySelectorAll('#aiMessages .ai-pending').forEach(el => el.remove());
        if (err?.name === 'AbortError') {
            appendAIBubble('note', 'Stopped.');
        } else {
            appendAIBubble('error', escapeHTML(err?.message || 'Request failed'));
        }
        // Drop a trailing assistant tool request without results so the next turn stays valid.
        const last = aiState.messages[aiState.messages.length - 1];
        if (last?.role === 'assistant' && last.tool_calls?.length) aiState.messages.pop();
    } finally {
        aiState.busy = false;
        aiState.abortController = null;
        updateAIComposerState();
    }

    if (changedGraph) {
        const revertRow = appendAIBubble('actions');
        const revertBtn = document.createElement('button');
        revertBtn.type = 'button';
        revertBtn.className = 'ai-revert-btn';
        revertBtn.textContent = 'Revert these changes';
        revertBtn.addEventListener('click', () => {
            restoreGraphState(JSON.parse(startSnapshot));
            saveHistoryState();
            revertBtn.disabled = true;
            revertBtn.textContent = 'Reverted';
            aiState.messages.push({ role: 'user', content: '(I reverted the changes from your previous reply.)' });
            aiState.messages.push({ role: 'assistant', content: 'Understood — those changes were reverted.' });
        });
        revertRow.appendChild(revertBtn);
    }
}

function initAISidebar() {
    const { sidebar, input, settings, keyInput, modelInput } = getAIElements();
    if (!sidebar) return;

    document.getElementById('aiComposer')?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (aiState.busy) {
            aiState.abortController?.abort();
            return;
        }
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        input.style.height = '';
        runAIAgentTurn(text);
    });

    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            document.getElementById('aiComposer').requestSubmit();
        } else if (e.key === 'Escape') {
            toggleAISidebar(false);
        }
    });
    input?.addEventListener('input', () => {
        input.style.height = '';
        input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    });

    settings?.addEventListener('submit', (e) => {
        e.preventDefault();
        const key = keyInput.value.trim();
        if (key) setAIKey(key);
        setAIModel(modelInput.value.trim());
        refreshAISettingsUI();
        if (getAIKey()) {
            settings.hidden = true;
            input?.focus();
            showToast('OpenRouter settings saved', 'success', 1800);
        }
    });

    document.getElementById('aiKeyClearBtn')?.addEventListener('click', () => {
        setAIKey('');
        refreshAISettingsUI();
        showToast('OpenRouter key removed', 'info', 1800);
    });

    document.getElementById('aiSuggestions')?.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-ai-prompt]');
        if (!chip || aiState.busy) return;
        runAIAgentTurn(chip.dataset.aiPrompt);
    });

    refreshAISettingsUI();
}
