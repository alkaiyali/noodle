// Toolbar color sync and branch analytics rendering.

    var analyticsCardCollapsed = false;

    function isCompactAnalyticsMode() {
        return window.matchMedia('(max-width: 680px) and (orientation: portrait)').matches;
    }

    function syncAnalyticsCardLayout() {
        if (!analyticsCard || !analyticsBody || !analyticsToggleBtn) return;
        const isCompact = isCompactAnalyticsMode();
        analyticsCard.classList.toggle('analytics-compact', isCompact);
        analyticsCard.classList.toggle('analytics-collapsed', analyticsCardCollapsed);
        analyticsToggleBtn.setAttribute('aria-expanded', String(!analyticsCardCollapsed));
        analyticsToggleBtn.title = analyticsCardCollapsed ? 'Expand Analytics' : 'Collapse Analytics';
    }

    function toggleAnalyticsCard() {
        analyticsCardCollapsed = !analyticsCardCollapsed;
        syncAnalyticsCardLayout();
    }

    if (analyticsToggleBtn) {
        analyticsToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleAnalyticsCard();
        });
    }

    const analyticsHeaderEl = document.querySelector('.analytics-header');
    if (analyticsHeaderEl) {
        analyticsHeaderEl.addEventListener('click', (e) => {
            if (analyticsCardCollapsed || e.target.closest('.analytics-toggle-btn')) {
                toggleAnalyticsCard();
            }
        });
    }

    function getSharedSelectedNodeColor(property) {
        const nodeIds = Array.from(selectedNodes).filter(id => nodes[id]);
        if (!nodeIds.length) return null;
        const firstValue = nodes[nodeIds[0]][property];
        return nodeIds.every(id => nodes[id][property] === firstValue) ? firstValue : null;
    }

    function getSelectedConnections() {
        return Array.from(selectedConnectionIndexes)
            .sort((a, b) => a - b)
            .map(index => ({ index, connection: connections[index] }))
            .filter(entry => entry.connection);
    }

    function updateToolbarColors() {
        if (selectedNodes.size > 0 || selectedTableIds.size > 0) {
            colorTools.classList.add('visible');
            document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));

            const sharedBgColor = selectedTableIds.size > 0 && selectedNodes.size === 0
                ? getSharedSelectedTableColor('bgColor')
                : getSharedSelectedNodeColor('bgColor');
            const sharedTextColor = selectedTableIds.size > 0 && selectedNodes.size === 0
                ? getSharedSelectedTableColor('textColor')
                : getSharedSelectedNodeColor('textColor');
            const activeBg = sharedBgColor ? document.querySelector(`#fillPalette .swatch[data-color="${sharedBgColor}"]`) : null;
            const activeText = sharedTextColor ? document.querySelector(`#textPalette .swatch[data-color="${sharedTextColor}"]`) : null;

            if (activeBg) activeBg.classList.add('active');
            if (activeText) activeText.classList.add('active');
            syncCustomColorSwatch('bgColor', sharedBgColor);
            syncCustomColorSwatch('textColor', sharedTextColor);

            const hasNodeSelected = selectedNodes.size > 0;
            document.querySelectorAll('.node-size-section').forEach(el => {
                el.style.display = hasNodeSelected ? '' : 'none';
            });
            if (hasNodeSelected) {
                const autoBtn = document.querySelector('.node-auto-size-btn');
                if (autoBtn) {
                    const isAllAuto = Array.from(selectedNodes).every(id => !nodes[id]?.width && !nodes[id]?.height);
                    autoBtn.classList.toggle('active', isAllAuto);
                }
            }
        } else { colorTools.classList.remove('visible'); }

        const selectedConnections = getSelectedConnections();
        if (selectedConnections.length) {
            connectionTools.classList.add('visible');
            const sharedConnectionType = normalizeConnectionType(selectedConnections[0].connection.type);
            const hasSharedConnectionType = selectedConnections.every(entry => normalizeConnectionType(entry.connection.type) === sharedConnectionType);
            document.querySelectorAll('.connection-type-btn').forEach(btn => {
                btn.classList.toggle('active', hasSharedConnectionType && btn.dataset.connectionType === sharedConnectionType);
            });
            const sharedConnectionStyle = selectedConnections[0].connection.style || 'straight';
            const hasSharedConnectionStyle = selectedConnections.every(entry => (entry.connection.style || 'straight') === sharedConnectionStyle);
            document.querySelectorAll('.connection-style-btn').forEach(btn => {
                btn.classList.toggle('active', hasSharedConnectionStyle && btn.dataset.connectionStyle === sharedConnectionStyle);
            });
        } else {
            connectionTools.classList.remove('visible');
            document.querySelectorAll('.connection-type-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.connection-style-btn').forEach(btn => btn.classList.remove('active'));
        }
        updateTableToolsVisibility();
        updateAnalyticsCard();
        updateSelectionCount();
        if (typeof updateQuickAddHandles === 'function') updateQuickAddHandles();
    }

    function syncCustomColorSwatch(target, sharedColor) {
        const input = target === 'bgColor'
            ? document.getElementById('customFillColorInput')
            : document.getElementById('customTextColorInput');
        if (!input) return;
        const swatch = input.closest('.swatch-custom');
        if (sharedColor && /^#[0-9a-f]{6}$/i.test(sharedColor)) {
            input.value = sharedColor;
            swatch?.classList.add('active');
        } else {
            swatch?.classList.remove('active');
        }
    }

    function updateSelectionCount() {
        const countEl = document.getElementById('selectionStatus');
        if (!countEl) return;
        const count = selectedNodes.size + selectedTableIds.size + selectedConnectionIndexes.size;
        if (count >= 2) {
            countEl.hidden = false;
            countEl.textContent = `${count} selected`;
        } else {
            countEl.hidden = true;
        }
    }

    function updateTableToolsVisibility() {
        if (!tableTools) return;
        const activeTableId = editingTableId && tables[editingTableId]
            ? editingTableId
            : (selectedTableIds.size === 1 ? getSelectedTableEntry()?.id || null : null);
        const activeTable = activeTableId ? tables[activeTableId] : null;
        const isVisible = Boolean(activeTableId);

        tableTools.classList.toggle('visible', isVisible);
        tableTools.querySelectorAll('[data-action="apply-table-action"]').forEach(button => {
            button.disabled = !isVisible || !canApplyTableAction(button.dataset.tableAction);
            if (button.dataset.tableAction === 'toggle-filters') {
                button.classList.toggle('active', Boolean(activeTable?.filtersEnabled));
            }
        });
    }

    function applyColor(property, hexCode) {
        selectedNodes.forEach(id => {
            const node = nodes[id];
            node[property] = hexCode;
            applyNodeAppearance(node);
        });
        applySelectedTableColor(property, hexCode);
        updateToolbarColors(); 
        saveHistoryState();
    }

    function sumNumbersInText(text) {
        const matches = text.match(/-?\d+(?:\.\d+)?/g);
        if (!matches) return 0;
        return matches.reduce((sum, value) => sum + parseFloat(value), 0);
    }

    function formatMetricValue(value) {
        if (!Number.isFinite(value)) return '0';
        if (Number.isInteger(value)) return String(value);
        return value.toFixed(2).replace(/\.?0+$/, '');
    }

    function analyzeBranch(rootId) {
        const index = buildChildIndex();
        const descendants = new Set();
        const countedNodes = new Set();
        let deepestBranch = 0;
        let numericSum = 0;

        function walk(nodeId, depth, path) {
            getChildIdsFromIndex(index, nodeId).forEach(childId => {
                if (path.has(childId)) return;
                descendants.add(childId);
                if (!countedNodes.has(childId)) {
                    numericSum += sumNumbersInText(getNodeText(childId));
                    countedNodes.add(childId);
                }
                deepestBranch = Math.max(deepestBranch, depth + 1);
                const nextPath = new Set(path);
                nextPath.add(childId);
                walk(childId, depth + 1, nextPath);
            });
        }

        walk(rootId, 0, new Set([rootId]));
        return {
            totalChildren: descendants.size,
            directChildren: getChildIdsFromIndex(index, rootId).length,
            deepestBranch,
            numericSum
        };
    }

    function renderAnalyticsStat(label, value, accent = false) {
        return `
            <div class="analytics-stat${accent ? ' accent' : ''}">
                <span class="analytics-stat-label">${label}</span>
                <strong class="analytics-stat-value">${value}</strong>
            </div>
        `;
    }

    function getSingleSelectedNode() {
        if (selectedNodes.size !== 1) return null;
        const nodeId = Array.from(selectedNodes)[0];
        return nodes[nodeId] || null;
    }

    function syncMetadataEditor(node = getSingleSelectedNode()) {
        if (!metadataEditor || !nodePriceCurrencyInput || !nodePriceInput || !nodeDateInput || !nodeTimeInput) return;

        if (!node) {
            metadataEditor.hidden = true;
            nodePriceCurrencyInput.value = DEFAULT_NODE_METADATA.currency;
            nodePriceInput.value = '';
            nodeDateInput.value = '';
            nodeTimeInput.value = '';
            return;
        }

        const metadata = getNodeMetadata(node);
        metadataEditor.hidden = false;
        nodePriceCurrencyInput.value = metadata.currency || DEFAULT_NODE_METADATA.currency;
        nodePriceInput.value = metadata.price;
        nodeDateInput.value = metadata.date;
        nodeTimeInput.value = metadata.time;
    }

    function updateSelectedNodeMetadataFromEditor(options = {}) {
        const node = getSingleSelectedNode();
        if (!node || !metadataEditor || metadataEditor.hidden) return false;

        return setNodeMetadata(node, {
            currency: nodePriceCurrencyInput?.value || DEFAULT_NODE_METADATA.currency,
            price: nodePriceInput?.value || '',
            date: nodeDateInput?.value || '',
            time: nodeTimeInput?.value || ''
        }, options);
    }

    function updateAnalyticsCard() {
        if (selectedTableIds.size > 0) {
            analyticsGrid.style.display = 'none';
            analyticsGrid.innerHTML = '';
            analyticsTitle.textContent = selectedTableIds.size > 1 ? 'Multiple tables selected' : 'Table selected';
            analyticsEmpty.textContent = 'Tables are independent from graph analytics. Use the table bar or right-click menu to add or remove rows and columns.';
            analyticsNote.textContent = '';
            syncMetadataEditor(null);
            syncAnalyticsCardLayout();
            return;
        }

        if (selectedNodes.size !== 1) {
            analyticsGrid.style.display = 'none';
            analyticsGrid.innerHTML = '';
            analyticsTitle.textContent = selectedNodes.size > 1 ? 'Multiple nodes selected' : 'No node selected';
            analyticsEmpty.textContent = selectedNodes.size > 1
                ? 'Select one node to inspect a single branch at a time.'
                : 'Select a single node to inspect its children, branch depth, and summed numbers.';
            analyticsNote.textContent = '';
            syncMetadataEditor(null);
            syncAnalyticsCardLayout();
            return;
        }

        const nodeId = Array.from(selectedNodes)[0];
        const node = nodes[nodeId];
        if (!node) return;
        if (node.type === 'floatingText') {
            analyticsGrid.style.display = 'none';
            analyticsGrid.innerHTML = '';
            analyticsTitle.textContent = getNodeText(node).trim() || 'Floating text';
            analyticsEmpty.textContent = 'Floating text is excluded from branch analytics, but its metadata can still be shown on the canvas.';
            analyticsNote.textContent = '';
            syncMetadataEditor(node);
            syncAnalyticsCardLayout();
            return;
        }

        const stats = analyzeBranch(nodeId);
        const label = getNodeText(node).trim() || node.type;

        analyticsTitle.textContent = label;
        analyticsGrid.style.display = 'grid';
        analyticsGrid.innerHTML = [
            renderAnalyticsStat('Total Children', stats.totalChildren),
            renderAnalyticsStat('Direct Children', stats.directChildren),
            renderAnalyticsStat('Branch Depth', stats.deepestBranch),
            renderAnalyticsStat('Child Number Sum', formatMetricValue(stats.numericSum), true)
        ].join('');
        analyticsEmpty.textContent = '';
        analyticsNote.textContent = 'Counts each reachable child once, including collapsed branches.';
        syncMetadataEditor(node);
        syncAnalyticsCardLayout();
    }

    if (metadataEditor) {
        metadataEditor.addEventListener('input', (event) => {
            if (!event.target.matches('input, select')) return;
            updateSelectedNodeMetadataFromEditor({ recordHistory: false });
        });

        metadataEditor.addEventListener('change', (event) => {
            if (!event.target.matches('input, select')) return;
            updateSelectedNodeMetadataFromEditor({ recordHistory: true });
        });
    }

    syncAnalyticsCardLayout();
