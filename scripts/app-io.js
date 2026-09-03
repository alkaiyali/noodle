// Graph import, export, and JSON clipboard helpers.

    async function copyJSONToClipboard() {
        hideSaveMenu();
        hideAlignMenu();
        try {
            await writeTextToClipboard(JSON.stringify(getGraphExportPayload(), null, 2));
        } catch (err) {
            showToast('Unable to copy JSON to clipboard.', 'error');
        }
    }

    async function pasteJSONFromClipboard() {
        hideSaveMenu();
        hideAlignMenu();
        const rawText = await readTextFromClipboard('Paste JSON here:');
        if (!rawText || !rawText.trim()) return;
        importJSONText(rawText);
    }

    function importJSONText(rawText) {
        try {
            const data = JSON.parse(rawText);
            restoreGraphPayload(data);
            return true;
        } catch (err) {
            showToast('Invalid JSON: could not import the pasted data.', 'error');
            return false;
        }
    }

    function exportJSON() {
        hideSaveMenu();
        hideAlignMenu();
        clearSelection();
        const blob = new Blob([JSON.stringify(getGraphExportPayload(), null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "chart-data.json";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        showToast('Exported chart-data.json', 'success', 2500);
    }

    function importJSON(e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            importJSONText(ev.target.result);
            e.target.value = "";
        };
        reader.readAsText(file);
    }

    function exportMermaidText() {
        const lines = ['flowchart TD'];
        const safeNodeId = (id) => String(id).replace(/[^a-zA-Z0-9_]/g, '_');

        Object.values(nodes).forEach(n => {
            if (n.el.style.display === 'none') return;
            const rawLabel = (n.el.querySelector('.label')?.innerText || n.el.querySelector('.label')?.textContent || '').trim();
            const labelText = (rawLabel || DEFAULT_NODE_LABELS[n.type] || n.type).replace(/"/g, "'").replace(/\n/g, '<br/>');
            const sid = safeNodeId(n.id);
            if (n.type === 'start') {
                lines.push(`    ${sid}(["${labelText}"])`);
            } else if (n.type === 'decision') {
                lines.push(`    ${sid}{"${labelText}"}`);
            } else if (n.type === 'floatingText') {
                lines.push(`    ${sid}>"${labelText}"]`);
            } else {
                lines.push(`    ${sid}["${labelText}"]`);
            }
        });

        connections.forEach(conn => {
            if (!nodes[conn.from] || !nodes[conn.to]) return;
            const fromId = safeNodeId(conn.from);
            const toId = safeNodeId(conn.to);
            const isDep = normalizeConnectionType(conn.type) === 'dependency';
            const arrow = isDep ? '-.->' : '-->';
            if (conn.label) {
                const safeLabel = conn.label.replace(/"/g, "'").trim();
                lines.push(`    ${fromId} ${isDep ? '-.' : '--'} "${safeLabel}" ${isDep ? '.->' : '-->'} ${toId}`);
            } else {
                lines.push(`    ${fromId} ${arrow} ${toId}`);
            }
        });

        return lines.join('\n');
    }

    async function copyMermaidToClipboard() {
        hideSaveMenu();
        hideAlignMenu();
        try {
            const mmd = exportMermaidText();
            await writeTextToClipboard(mmd);
            showToast('Copied Mermaid flowchart to clipboard', 'success', 2500);
        } catch (err) {
            showToast('Unable to copy Mermaid to clipboard.', 'error');
        }
    }

    function exportMermaidFile() {
        hideSaveMenu();
        hideAlignMenu();
        clearSelection();
        const mmd = exportMermaidText();
        const blob = new Blob([mmd], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'chart.mmd';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('Exported chart.mmd', 'success', 2500);
    }

    async function pasteMermaidFromClipboard() {
        hideSaveMenu();
        hideAlignMenu();
        const rawText = await readTextFromClipboard('Paste Mermaid flowchart syntax here:');
        if (!rawText || !rawText.trim()) return;
        importMermaidText(rawText);
    }

    function importMermaidText(rawText) {
        if (!rawText || typeof rawText !== 'string') return false;
        try {
            const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const createdNodeMap = {};
            const parsedConns = [];

            Object.keys(nodes).forEach(id => {
                if (nodes[id]?.el?.parentNode) nodes[id].el.parentNode.removeChild(nodes[id].el);
                delete nodes[id];
            });
            connections.length = 0;
            nodeIdCounter = 0;

            let layoutX = 100;
            let layoutY = 100;

            lines.forEach((line) => {
                if (/^(flowchart|graph)\b/i.test(line)) return;
                if (/^subgraph\b/i.test(line) || /^end\b/i.test(line)) return;

                const connMatch = line.match(/^([a-zA-Z0-9_-]+)\s*(?:(--|-.))\s*(?:\|([^|]+)\||"([^"]+)"|'([^']+)')?\s*(?:(-->|\.->|->))\s*([a-zA-Z0-9_-]+)/);
                if (connMatch) {
                    const fromRaw = connMatch[1];
                    const label = connMatch[3] || connMatch[4] || connMatch[5] || '';
                    const isDep = connMatch[2].includes('.') || connMatch[6].includes('.');
                    const toRaw = connMatch[7];

                    [fromRaw, toRaw].forEach(rawId => {
                        if (!createdNodeMap[rawId]) {
                            const newId = createNode('process', null, layoutX, layoutY, rawId, '#ffffff', '#0f172a', false);
                            createdNodeMap[rawId] = newId;
                            layoutX += 160;
                            if (layoutX > 600) { layoutX = 100; layoutY += 120; }
                        }
                    });

                    parsedConns.push({
                        from: createdNodeMap[fromRaw],
                        to: createdNodeMap[toRaw],
                        type: isDep ? 'dependency' : 'sequence',
                        label: label.trim()
                    });
                    return;
                }

                const nodeMatch = line.match(/^([a-zA-Z0-9_-]+)(?:(\(\[|\[|\{|>))(.*)(?:(\]\)|"\}|\}\]|\}|\]|\)))/);
                if (nodeMatch) {
                    const rawId = nodeMatch[1];
                    const opener = nodeMatch[2];
                    let text = nodeMatch[3].trim().replace(/^["']|["']$/g, '');

                    let nodeType = 'process';
                    if (opener === '([') nodeType = 'start';
                    else if (opener === '{') nodeType = 'decision';
                    else if (opener === '>') nodeType = 'floatingText';

                    const noodleId = createNode(nodeType, null, layoutX, layoutY, text, '#ffffff', '#0f172a', false);
                    createdNodeMap[rawId] = noodleId;
                    layoutX += 160;
                    if (layoutX > 600) { layoutX = 100; layoutY += 120; }
                }
            });

            parsedConns.forEach(c => connections.push(normalizeConnection(c)));

            updateVisibility();
            clearSelection();
            if (typeof runTopologicalLayout === 'function') {
                runTopologicalLayout();
            }
            centerViewOnOrigin();
            saveHistoryState();
            showToast(`Imported ${Object.keys(nodes).length} nodes from Mermaid`, 'success', 3000);
            return true;
        } catch (err) {
            showToast('Failed to parse Mermaid text.', 'error');
            return false;
        }
    }
