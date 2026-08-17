// Node creation, hierarchy, and visibility helpers.

    function formatNodeMetadataPrice(metadata = {}) {
        const sanitizedMetadata = sanitizeNodeMetadata(metadata);
        if (!sanitizedMetadata.price) return '';

        const numericValue = Number(sanitizedMetadata.price);
        if (!Number.isFinite(numericValue)) return sanitizedMetadata.price;

        try {
            return new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: sanitizedMetadata.currency,
                maximumFractionDigits: 2
            }).format(numericValue);
        } catch (error) {
            return `${sanitizedMetadata.currency} ${sanitizedMetadata.price}`;
        }
    }

    function formatNodeMetadataDate(dateValue = '') {
        const sanitizedDate = sanitizeNodeDate(dateValue);
        if (!sanitizedDate) return '';

        const [year, month, day] = sanitizedDate.split('-').map(part => parseInt(part, 10));
        const date = new Date(year, month - 1, day);
        if (Number.isNaN(date.getTime())) return sanitizedDate;

        return new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        }).format(date);
    }

    function formatNodeMetadataTime(timeValue = '') {
        const sanitizedTime = sanitizeNodeTime(timeValue);
        if (!sanitizedTime) return '';

        const [hours, minutes] = sanitizedTime.split(':').map(part => parseInt(part, 10));
        const time = new Date(2000, 0, 1, hours, minutes);
        if (Number.isNaN(time.getTime())) return sanitizedTime;

        return new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit'
        }).format(time);
    }

    function getNodeMetadataEntries(nodeOrId) {
        const metadata = getNodeMetadata(nodeOrId);
        const entries = [];
        const formattedPrice = formatNodeMetadataPrice(metadata);
        const formattedDate = formatNodeMetadataDate(metadata.date);
        const formattedTime = formatNodeMetadataTime(metadata.time);

        if (formattedPrice) entries.push({ kind: 'price', label: 'Price', value: formattedPrice });
        if (formattedDate) entries.push({ kind: 'date', label: 'Date', value: formattedDate });
        if (formattedTime) entries.push({ kind: 'time', label: 'Time', value: formattedTime });
        return entries;
    }

    function updateNodeMetadataDisplay(nodeOrId) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        const metadataEl = node?.metadataEl;
        if (!node || !metadataEl) return;

        const entries = getNodeMetadataEntries(node);
        metadataEl.innerHTML = '';

        entries.forEach(entry => {
            const itemEl = document.createElement('div');
            itemEl.className = `node-metadata-item ${entry.kind}`;

            const labelEl = document.createElement('span');
            labelEl.className = 'node-metadata-key';
            labelEl.textContent = entry.label;

            const valueEl = document.createElement('strong');
            valueEl.className = 'node-metadata-value';
            valueEl.textContent = entry.value;

            itemEl.appendChild(labelEl);
            itemEl.appendChild(valueEl);
            metadataEl.appendChild(itemEl);
        });

        const hasEntries = entries.length > 0;
        metadataEl.hidden = !hasEntries;
        node.el.classList.toggle('has-metadata', hasEntries);
        invalidateCachedElementSizes();
    }

    function isGroupNode(nodeOrId) {
        return getNodeType(nodeOrId) === 'group';
    }

    let cssColorProbeEl = null;

    function getColorChannels(colorValue = '') {
        const sanitizedColor = sanitizeCSSColor(colorValue);
        if (!sanitizedColor) return null;
        if (!cssColorProbeEl) {
            cssColorProbeEl = document.createElement('span');
            cssColorProbeEl.style.position = 'fixed';
            cssColorProbeEl.style.pointerEvents = 'none';
            cssColorProbeEl.style.opacity = '0';
            cssColorProbeEl.style.inset = '-9999px auto auto -9999px';
            document.body.appendChild(cssColorProbeEl);
        }

        cssColorProbeEl.style.color = sanitizedColor;
        const computedColor = window.getComputedStyle(cssColorProbeEl).color;
        const match = computedColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!match) return null;

        return {
            r: Number(match[1]),
            g: Number(match[2]),
            b: Number(match[3])
        };
    }

    function getColorWithAlpha(colorValue = '', alpha = 1, fallbackColor = '#dbeafe') {
        const channels = getColorChannels(colorValue) || getColorChannels(fallbackColor);
        if (!channels) return '';
        const normalizedAlpha = Math.max(0, Math.min(1, Number(alpha)));
        return `rgba(${channels.r}, ${channels.g}, ${channels.b}, ${normalizedAlpha})`;
    }

    function applyNodeAppearance(nodeOrId) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        if (!node?.el) return;

        const isGroup = isGroupNode(node);
        const resolvedBg = sanitizeCSSColor(node.bgColor) || (isGroup ? '#eff6ff' : '#ffffff');
        const resolvedText = sanitizeCSSColor(node.textColor) || '#0f172a';

        node.bgColor = resolvedBg;
        node.textColor = resolvedText;
        node.el.style.color = resolvedText;

        if (isGroup) {
            node.el.style.backgroundColor = 'transparent';
            node.el.style.setProperty('--group-border-color', getColorWithAlpha(resolvedBg, 0.62, '#94a3b8'));
            node.el.style.setProperty('--group-overlay-top', getColorWithAlpha(resolvedBg, 0.32, '#eff6ff'));
            node.el.style.setProperty('--group-overlay-mid', getColorWithAlpha(resolvedBg, 0.12, '#dbeafe'));
            node.el.style.setProperty('--group-overlay-bottom', getColorWithAlpha(resolvedBg, 0.04, '#dbeafe'));
            return;
        }

        node.el.style.backgroundColor = resolvedBg;
        node.el.style.removeProperty('--group-border-color');
        node.el.style.removeProperty('--group-overlay-top');
        node.el.style.removeProperty('--group-overlay-mid');
        node.el.style.removeProperty('--group-overlay-bottom');
    }

    function getNodeRect(nodeOrId) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        if (!node) return null;
        const width = node.el.offsetWidth;
        const height = node.el.offsetHeight;
        return {
            left: node.x,
            top: node.y,
            right: node.x + width,
            bottom: node.y + height,
            width,
            height
        };
    }

    function getGroupChildIds(groupId) {
        return Object.keys(nodes).filter(nodeId => nodes[nodeId] && nodes[nodeId].parentGroupId === groupId);
    }

    function getGroupDescendantIds(groupId) {
        if (!nodes[groupId]) return [];
        const descendantIds = new Set();
        const queue = [...getGroupChildIds(groupId)];

        while (queue.length) {
            const currentId = queue.shift();
            if (!nodes[currentId] || descendantIds.has(currentId)) continue;
            descendantIds.add(currentId);
            if (isGroupNode(currentId)) {
                getGroupChildIds(currentId).forEach(childId => {
                    if (!descendantIds.has(childId)) queue.push(childId);
                });
            }
        }

        return Array.from(descendantIds);
    }

    function getNodeGroupAncestorIds(nodeId) {
        const ancestorIds = [];
        const seenIds = new Set();
        let currentGroupId = nodes[nodeId]?.parentGroupId || null;

        while (currentGroupId && nodes[currentGroupId] && !seenIds.has(currentGroupId)) {
            ancestorIds.push(currentGroupId);
            seenIds.add(currentGroupId);
            currentGroupId = nodes[currentGroupId].parentGroupId || null;
        }

        return ancestorIds;
    }

    function isNodeInsideGroup(nodeId, groupId) {
        const nodeRect = getNodeRect(nodeId);
        const groupRect = getNodeRect(groupId);
        if (!nodeRect || !groupRect || !isGroupNode(groupId) || nodeId === groupId) return false;

        const insetX = Math.min(20, Math.max(8, groupRect.width * 0.05));
        const insetY = Math.min(20, Math.max(8, groupRect.height * 0.05));
        const centerX = nodeRect.left + (nodeRect.width / 2);
        const centerY = nodeRect.top + (nodeRect.height / 2);

        return centerX >= groupRect.left + insetX &&
            centerX <= groupRect.right - insetX &&
            centerY >= groupRect.top + insetY &&
            centerY <= groupRect.bottom - insetY;
    }

    function getBestContainingGroupId(nodeId, excludeGroupIds = new Set()) {
        const node = nodes[nodeId];
        if (!node) return null;

        const excludedIds = new Set(excludeGroupIds || []);
        excludedIds.add(nodeId);
        if (isGroupNode(nodeId)) {
            getGroupDescendantIds(nodeId).forEach(descendantId => {
                if (isGroupNode(descendantId)) excludedIds.add(descendantId);
            });
        }

        const candidateIds = Object.keys(nodes).filter(groupId => {
            if (!nodes[groupId] || excludedIds.has(groupId) || !isGroupNode(groupId)) return false;
            if (nodes[groupId].el.style.display === 'none') return false;
            return isNodeInsideGroup(nodeId, groupId);
        });
        if (!candidateIds.length) return null;

        candidateIds.sort((a, b) => {
            const rectA = getNodeRect(a);
            const rectB = getNodeRect(b);
            const areaDiff = (rectA.width * rectA.height) - (rectB.width * rectB.height);
            if (Math.abs(areaDiff) > 1) return areaDiff;
            return getNodeGroupAncestorIds(a).length - getNodeGroupAncestorIds(b).length;
        });

        return candidateIds[0];
    }

    function applyNodeGroupState(nodeOrId) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        if (!node?.el) return;
        node.el.classList.toggle('group-child', Boolean(node.parentGroupId));
        if (node.parentGroupId) node.el.dataset.parentGroupId = node.parentGroupId;
        else delete node.el.dataset.parentGroupId;
    }

    function setNodeParentGroup(nodeOrId, parentGroupId = null, options = {}) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        if (!node) return false;

        let nextParentGroupId = parentGroupId && nodes[parentGroupId] && isGroupNode(parentGroupId)
            ? parentGroupId
            : null;
        if (nextParentGroupId === node.id) nextParentGroupId = null;
        if (nextParentGroupId && isGroupNode(node) && getGroupDescendantIds(node.id).includes(nextParentGroupId)) {
            nextParentGroupId = null;
        }
        if (node.parentGroupId === nextParentGroupId) return false;

        node.parentGroupId = nextParentGroupId;
        applyNodeGroupState(node);

        if (options.recordHistory) saveHistoryState();
        else if (options.autosave !== false) scheduleAutosave();
        return true;
    }

    function syncNodeGroupMembership(nodeId, options = {}) {
        if (!nodes[nodeId] || nodes[nodeId].el.style.display === 'none') return false;
        return setNodeParentGroup(
            nodeId,
            getBestContainingGroupId(nodeId, new Set(options.excludeGroupIds || [])),
            { autosave: options.autosave, recordHistory: options.recordHistory }
        );
    }

    function syncAllNodeGroupMembership(options = {}) {
        let changed = false;
        Object.keys(nodes).forEach(nodeId => {
            if (!nodes[nodeId]) return;
            if (syncNodeGroupMembership(nodeId, { excludeGroupIds: options.excludeGroupIds, autosave: false })) {
                changed = true;
            }
        });

        if (!changed) return false;
        if (options.recordHistory) saveHistoryState();
        else if (options.autosave !== false) scheduleAutosave();
        return true;
    }

    function createNode(type, presetId = null, presetX = null, presetY = null, presetText = null, presetBg = null, presetColor = null, recordHistory = !presetId, presetHtml = '', autoSelect = !presetId, presetMetadata = null, presetWidth = null, presetHeight = null) {
        const resolvedBg = presetBg ?? (type === 'floatingText' ? 'transparent' : (type === 'group' ? '#eff6ff' : '#ffffff'));
        const resolvedColor = presetColor ?? '#0f172a';
        const resolvedHtml = presetHtml || '';
        const resolvedMetadata = sanitizeNodeMetadata(presetMetadata || DEFAULT_NODE_METADATA);
        const resolvedSize = normalizeNodeSize(type, presetWidth, presetHeight);
        const id = presetId || 'node_' + (nodeIdCounter++);
        const nodeEl = document.createElement('div');
        nodeEl.id = id; 
        nodeEl.className = `node ${type}`;

        const label = document.createElement('div');
        label.className = 'label';
        label.contentEditable = "false";
        setLabelContent(label, presetText ?? getDefaultNodeLabel(type), resolvedHtml, { nodeType: type });

        const metadataEl = document.createElement('div');
        metadataEl.className = 'node-metadata';
        metadataEl.hidden = true;

        const collapseBtn = document.createElement('div');
        collapseBtn.className = 'collapse-btn';
        collapseBtn.textContent = '-';

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'node-resize-handle';
        resizeHandle.setAttribute('aria-hidden', 'true');

        nodeEl.appendChild(label);
        nodeEl.appendChild(metadataEl);
        nodeEl.appendChild(collapseBtn);
        nodeEl.appendChild(resizeHandle);
        
        const x = presetX !== null ? presetX : ((window.innerWidth / 2) - panX) / zoom - 60 + (Math.random() * 40 - 20);
        const y = presetY !== null ? presetY : ((window.innerHeight / 3) - panY) / zoom + (Math.random() * 40 - 20);
        
        nodes[id] = {
            id,
            el: nodeEl,
            metadataEl,
            resizeHandleEl: resizeHandle,
            type,
            x,
            y,
            width: null,
            height: null,
            parentGroupId: null,
            bgColor: resolvedBg,
            textColor: resolvedColor,
            metadata: resolvedMetadata
        };
        applyNodeAppearance(nodes[id]);
        setNodePosition(nodes[id], x, y);
        setNodeSize(nodes[id], resolvedSize.width, resolvedSize.height, { autosave: false });
        applyNodeGroupState(nodes[id]);
        updateNodeMetadataDisplay(nodes[id]);
        
        nodeEl.addEventListener('pointerdown', handleNodePointerDown);
        resizeHandle.addEventListener('pointerdown', handleNodeResizePointerDown);
        
        label.addEventListener('blur', function() {
            if (suspendNodeLabelBlurCommit) return;
            this.innerHTML = sanitizeRichTextHTML(this.innerHTML, { allowTables: doesNodeTypeAllowTables(type) });
            nodeEl.classList.remove('editing');
            this.contentEditable = "false";
            updateRichTextToolbarVisibility();
            updateAnalyticsCard();
            invalidateCachedElementSizes();
            drawConnections();
            saveHistoryState();
        });

        label.addEventListener('pointerdown', (e) => {
            if (!label.isContentEditable && (e.target.closest('input[type="checkbox"]') || e.target.closest('a'))) {
                e.stopPropagation();
            }
        });

        label.addEventListener('change', (e) => {
            if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'checkbox') return;
            if (e.target.checked) e.target.setAttribute('checked', 'checked');
            else e.target.removeAttribute('checked');
            updateAnalyticsCard();
            invalidateCachedElementSizes();
            drawConnections();
            saveHistoryState();
        });

        collapseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); toggleCollapse(id); });

        content.appendChild(nodeEl);
        if (!presetId) {
            if (autoSelect) {
                clearSelection();
                addToSelection(id);
            }
            updateVisibility();
        }
        if (recordHistory) saveHistoryState();
        return id;
    }

    function toggleCollapse(nodeId) {
        setNodeCollapse(nodeId, 'all', !hasCollapsedBranches(nodeId));
    }

    function getCollapseSet(collapseType) {
        return collapseType === 'dependency' ? collapsedDependencyNodes : collapsedSequenceNodes;
    }

    function isCollapseTypeActive(nodeId, collapseType) {
        return getCollapseSet(collapseType).has(nodeId);
    }

    function hasCollapsedBranches(nodeId) {
        return collapsedSequenceNodes.has(nodeId) || collapsedDependencyNodes.has(nodeId);
    }

    function getChildIds(nodeId, connectionType = null) {
        const normalizedType = connectionType && connectionType !== 'all'
            ? normalizeConnectionType(connectionType)
            : null;
        return [...new Set(connections
            .filter(c => c.from === nodeId && nodes[c.to] && (!normalizedType || normalizeConnectionType(c.type) === normalizedType))
            .map(c => c.to))];
    }

function buildChildIndex() {
        const index = new Map();
        connections.forEach(conn => {
            if (!nodes[conn.to]) return;
            let toTypes = index.get(conn.from);
            if (!toTypes) { toTypes = new Map(); index.set(conn.from, toTypes); }
            let types = toTypes.get(conn.to);
            if (!types) { types = new Set(); toTypes.set(conn.to, types); }
            types.add(normalizeConnectionType(conn.type));
        });
        return index;
    }

    function getChildIdsFromIndex(index, nodeId, connectionType = null) {
        const toTypes = index.get(nodeId);
        if (!toTypes) return [];
        const normalizedType = connectionType && connectionType !== 'all'
            ? normalizeConnectionType(connectionType)
            : null;
        const directChildren = [];
        toTypes.forEach((types, toId) => {
            if (!normalizedType || types.has(normalizedType)) directChildren.push(toId);
        });
        return directChildren;
    }

    function collectDescendantsFromIndex(index, startId, connectionType, outSet) {
        const queue = [];
        const enqueued = new Set(outSet);
        getChildIdsFromIndex(index, startId, connectionType).forEach(childId => {
            if (childId !== startId && !enqueued.has(childId)) { enqueued.add(childId); queue.push(childId); }
        });
        for (let i = 0; i < queue.length; i++) {
            const curr = queue[i];
            if (outSet.has(curr)) continue;
            outSet.add(curr);
            getChildIdsFromIndex(index, curr).forEach(childId => {
                if (childId !== startId && !enqueued.has(childId)) { enqueued.add(childId); queue.push(childId); }
            });
        }
    }

    function getDescendants(startId, connectionType = null) {
        const index = buildChildIndex();
        const desc = new Set();
        collectDescendantsFromIndex(index, startId, connectionType, desc);
        return Array.from(desc);
    }

    function getCollapsedDescendantIds(nodeId) {
        if (!nodes[nodeId]) return [];
        const index = buildChildIndex();
        const descendantIds = new Set();
        if (isCollapseTypeActive(nodeId, 'sequence')) {
            collectDescendantsFromIndex(index, nodeId, 'sequence', descendantIds);
        }
        if (isCollapseTypeActive(nodeId, 'dependency')) {
            collectDescendantsFromIndex(index, nodeId, 'dependency', descendantIds);
        }
        return Array.from(descendantIds);
    }

    function canSetNodeCollapse(nodeId, collapseType, shouldCollapse) {
        if (!nodes[nodeId]) return false;
        if (collapseType === 'all') {
            if (shouldCollapse) return getChildIds(nodeId).length > 0 && !(isCollapseTypeActive(nodeId, 'sequence') && isCollapseTypeActive(nodeId, 'dependency'));
            return hasCollapsedBranches(nodeId);
        }
        if (shouldCollapse) return getChildIds(nodeId, collapseType).length > 0 && !isCollapseTypeActive(nodeId, collapseType);
        return isCollapseTypeActive(nodeId, collapseType);
    }

    function setNodeCollapse(nodeId, collapseType, shouldCollapse, recordHistory = true) {
        if (!canSetNodeCollapse(nodeId, collapseType, shouldCollapse)) return false;

        if (collapseType === 'all') {
            if (shouldCollapse) {
                collapsedSequenceNodes.add(nodeId);
                collapsedDependencyNodes.add(nodeId);
            } else {
                collapsedSequenceNodes.delete(nodeId);
                collapsedDependencyNodes.delete(nodeId);
            }
        } else {
            const collapseSet = getCollapseSet(collapseType);
            if (shouldCollapse) collapseSet.add(nodeId);
            else collapseSet.delete(nodeId);
        }

        updateVisibility();
        invalidateCachedElementSizes();
        if (recordHistory) saveHistoryState();
        else scheduleAutosave();
        return true;
    }

function pruneCollapsedNodeState() {
        const validNodeIds = new Set(Object.keys(nodes));
        [collapsedSequenceNodes, collapsedDependencyNodes].forEach(collapseSet => {
            Array.from(collapseSet).forEach(nodeId => {
                if (!validNodeIds.has(nodeId)) {
                    collapseSet.delete(nodeId);
                }
            });
        });
        const index = buildChildIndex();
        validNodeIds.forEach(nodeId => {
            if (!getChildIdsFromIndex(index, nodeId, 'sequence').length) collapsedSequenceNodes.delete(nodeId);
            if (!getChildIdsFromIndex(index, nodeId, 'dependency').length) collapsedDependencyNodes.delete(nodeId);
        });
    }

    function updateVisibility() {
        pruneCollapsedNodeState();
        const index = buildChildIndex();
        let hidden = new Set();
        collapsedSequenceNodes.forEach(cId => { collectDescendantsFromIndex(index, cId, 'sequence', hidden); });
        collapsedDependencyNodes.forEach(cId => { collectDescendantsFromIndex(index, cId, 'dependency', hidden); });
        Array.from(hidden).forEach(nodeId => {
            if (isGroupNode(nodeId)) getGroupDescendantIds(nodeId).forEach(descendantId => hidden.add(descendantId));
        });
        Object.keys(nodes).forEach(id => {
            const node = nodes[id];
            if (hidden.has(id)) { node.el.style.display = 'none'; if (selectedNodes.has(id)) selectedNodes.delete(id); } 
            else { node.el.style.display = 'flex'; }
            const btn = node.el.querySelector('.collapse-btn');
            const hasChildren = getChildIdsFromIndex(index, id).length > 0;
            if (hasChildren && !hidden.has(id)) {
                const isCollapsed = hasCollapsedBranches(id);
                btn.style.display = 'flex'; btn.innerHTML = isCollapsed ? '+' : '-';
                btn.style.color = isCollapsed ? 'white' : '#64748b';
                btn.style.background = isCollapsed ? 'var(--primary)' : 'white';
                btn.style.borderColor = isCollapsed ? 'var(--primary)' : '#94a3b8';
            } else { btn.style.display = 'none'; }
        });
        updateToolbarColors(); drawConnections();
    }
