// Canvas, selection, clipboard, and connection interactions.

    var pendingRichTextImageNodeId = null;
    var activeToolbarDrag = null;
    var activeNodeResize = null;
    var suppressNextToolbarCreateAction = false;
    var gestureState = null;
    var longPressState = null;
    var dragStartNodePosition = null;
    var LONG_PRESS_DURATION_MS = 520;
    var LONG_PRESS_MOVE_THRESHOLD_PX = 12;
    var nudgeHistoryPending = false;
    var nudgeHistoryClearTimer = null;

    function getDroppedOnNodeId(draggedNodeId) {
        const dragged = nodes[draggedNodeId];
        if (!dragged) return null;
        const cx = dragged.x + dragged.el.offsetWidth / 2;
        const cy = dragged.y + dragged.el.offsetHeight / 2;
        for (const [id, node] of Object.entries(nodes)) {
            if (id === draggedNodeId) continue;
            if (node.el.style.display === 'none') continue;
            const nx = node.x, ny = node.y;
            const nw = node.el.offsetWidth, nh = node.el.offsetHeight;
            if (cx >= nx && cx <= nx + nw && cy >= ny && cy <= ny + nh) return id;
        }
        return null;
    }

    function swapNodePositionsAndConnections(nodeIdA, nodeIdB, originalPosA) {
        const nodeA = nodes[nodeIdA];
        const nodeB = nodes[nodeIdB];
        if (!nodeA || !nodeB) return;
        const posA = originalPosA || { x: nodeA.x, y: nodeA.y };
        setNodePosition(nodeA, nodeB.x, nodeB.y);
        setNodePosition(nodeB, posA.x, posA.y);
        connections.forEach(conn => {
            let changed = false;
            if (conn.from === nodeIdA) { conn.from = nodeIdB; changed = true; }
            else if (conn.from === nodeIdB) { conn.from = nodeIdA; changed = true; }
            if (conn.to === nodeIdA) { conn.to = nodeIdB; changed = true; }
            else if (conn.to === nodeIdB) { conn.to = nodeIdA; changed = true; }
            if (changed) normalizeConnection(conn);
        });
    }

    function zoomView(delta) {
        const newZoom = Math.min(Math.max(zoom + delta, 0.2), 3);
        const centerX = window.innerWidth / 2; const centerY = window.innerHeight / 2;
        panX = centerX - (centerX - panX) * (newZoom / zoom);
        panY = centerY - (centerY - panY) * (newZoom / zoom);
        zoom = newZoom; updateTransform();
    }

    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const newZoom = Math.min(Math.max(zoom - e.deltaY * 0.001, 0.2), 3);
        panX = e.clientX - (e.clientX - panX) * (newZoom / zoom);
        panY = e.clientY - (e.clientY - panY) * (newZoom / zoom);
        zoom = newZoom; updateTransform();
    }, { passive: false });

    function clearNodeSelection() {
        selectedNodes.forEach(id => { if (nodes[id]) nodes[id].el.classList.remove('selected'); });
        selectedNodes.clear();
    }

    function getSelectedConnectionEntries() {
        return Array.from(selectedConnectionIndexes)
            .sort((a, b) => a - b)
            .map(index => ({ index, connection: connections[index] }))
            .filter(entry => entry.connection);
    }

    function getSingleSelectedConnectionIndex() {
        const selectedEntries = getSelectedConnectionEntries();
        return selectedEntries.length === 1 ? selectedEntries[0].index : null;
    }

    function clearConnectionSelection({ preserveEditor = false } = {}) {
        if (!preserveEditor) finishConnectionLabelEditing(true, true);
        selectedConnectionIndexes.clear();
    }

    function clearSelection() {
        clearNodeSelection();
        clearTableSelection();
        clearConnectionSelection();
        updateToolbarColors();
        drawConnections();
    }

    function selectAllCanvasItems() {
        clearSelection();
        Object.keys(nodes).forEach(id => {
            if (!nodes[id]) return;
            selectedNodes.add(id);
            nodes[id].el.classList.add('selected');
        });
        Object.keys(tables).forEach(id => {
            if (!tables[id]) return;
            selectedTableIds.add(id);
            tables[id].el.classList.add('selected');
        });
        activeTableContext = getDefaultActiveTableContext();
        activeTableAdditionalCellContexts = [];
        syncActiveTableSelectionUI();
        updateToolbarColors();
        drawConnections();
    }

    function clampZoomValue(nextZoom) {
        return Math.min(Math.max(nextZoom, 0.2), 3);
    }

    function trackActivePointer(e) {
        activePointers.set(e.pointerId, {
            clientX: e.clientX,
            clientY: e.clientY,
            pointerType: e.pointerType || 'mouse'
        });
    }

    function updateTrackedPointer(e) {
        if (!activePointers.has(e.pointerId)) return;
        trackActivePointer(e);
    }

    function getTouchPointers() {
        return Array.from(activePointers.entries())
            .map(([pointerId, pointer]) => ({ pointerId, ...pointer }))
            .filter(pointer => pointer.pointerType === 'touch');
    }

    function getPointerCentroid(pointers) {
        if (!pointers.length) return { x: 0, y: 0 };
        const sum = pointers.reduce((acc, pointer) => ({
            x: acc.x + pointer.clientX,
            y: acc.y + pointer.clientY
        }), { x: 0, y: 0 });
        return {
            x: sum.x / pointers.length,
            y: sum.y / pointers.length
        };
    }

    function getPointerDistance(pointers) {
        if (pointers.length < 2) return 0;
        const [firstPointer, secondPointer] = pointers;
        return Math.hypot(secondPointer.clientX - firstPointer.clientX, secondPointer.clientY - firstPointer.clientY);
    }

    function cancelLongPress(pointerId = null) {
        if (!longPressState) return;
        if (pointerId !== null && longPressState.pointerId !== pointerId) return;
        window.clearTimeout(longPressState.timerId);
        longPressState = null;
    }

    function queueLongPressContextMenu(e) {
        cancelLongPress();
        if (e.pointerType !== 'touch' || e.button !== 0) return;
        longPressState = {
            pointerId: e.pointerId,
            target: e.target,
            startX: e.clientX,
            startY: e.clientY,
            clientX: e.clientX,
            clientY: e.clientY,
            timerId: window.setTimeout(() => {
                if (!longPressState || longPressState.pointerId !== e.pointerId) return;
                hasPanned = false;
                pendingNodeEditId = null;
                isDragging = false;
                selectionBoxUI.style.display = 'none';
                currentMode = 'IDLE';
                clearConnectPreview();
                setCanvasSelectionSuppressed(false);
                openContextMenuAtTarget(longPressState.target, longPressState.clientX, longPressState.clientY);
                cancelLongPress();
            }, LONG_PRESS_DURATION_MS)
        };
    }

    function updateLongPressFromMove(e) {
        if (!longPressState || longPressState.pointerId !== e.pointerId) return;
        longPressState.clientX = e.clientX;
        longPressState.clientY = e.clientY;
        if (Math.hypot(e.clientX - longPressState.startX, e.clientY - longPressState.startY) > LONG_PRESS_MOVE_THRESHOLD_PX) {
            cancelLongPress(e.pointerId);
        }
    }

    function beginTouchGesture() {
        const touchPointers = getTouchPointers();
        if (touchPointers.length < 2) return false;
        cancelLongPress();
        clearDeleteDropZoneState();
        clearConnectPreview();
        clearTextSelection();
        selectionBoxUI.style.display = 'none';
        pendingNodeEditId = null;
        isDragging = false;
        hasPanned = false;
        currentMode = 'GESTURE';
        gestureState = {
            lastCentroid: getPointerCentroid(touchPointers),
            lastDistance: Math.max(getPointerDistance(touchPointers), 1)
        };
        setCanvasSelectionSuppressed(true);
        return true;
    }

    function updateTouchGesture() {
        if (currentMode !== 'GESTURE' || !gestureState) return false;
        const touchPointers = getTouchPointers();
        if (touchPointers.length < 2) return false;

        const centroid = getPointerCentroid(touchPointers);
        const distance = Math.max(getPointerDistance(touchPointers), 1);
        panX += centroid.x - gestureState.lastCentroid.x;
        panY += centroid.y - gestureState.lastCentroid.y;

        const nextZoom = clampZoomValue(zoom * (distance / Math.max(gestureState.lastDistance, 1)));
        if (nextZoom !== zoom) {
            const scale = nextZoom / zoom;
            panX = centroid.x - (centroid.x - panX) * scale;
            panY = centroid.y - (centroid.y - panY) * scale;
            zoom = nextZoom;
        }

        gestureState.lastCentroid = centroid;
        gestureState.lastDistance = distance;
        hasPanned = true;
        updateTransform();
        return true;
    }

    function endTouchGesture() {
        gestureState = null;
        if (currentMode === 'GESTURE') currentMode = 'IDLE';
        if (activePointers.size === 0) setCanvasSelectionSuppressed(false);
    }

    function isPointInsideRect(clientX, clientY, rect) {
        return Boolean(rect) && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    function isPointOverElement(element, clientX, clientY) {
        return element ? isPointInsideRect(clientX, clientY, element.getBoundingClientRect()) : false;
    }

    function getConnectionIndexAtClientPosition(clientX, clientY, ignoredElement = null) {
        const previousPointerEvents = ignoredElement ? ignoredElement.style.pointerEvents : '';
        if (ignoredElement) ignoredElement.style.pointerEvents = 'none';
        const hitElement = document.elementFromPoint(clientX, clientY);
        if (ignoredElement) ignoredElement.style.pointerEvents = previousPointerEvents;

        const connectionEl = hitElement?.closest?.('.connection-group');
        if (!connectionEl) return null;

        const connectionIndex = Number(connectionEl.dataset.connectionIndex);
        return Number.isInteger(connectionIndex) && connections[connectionIndex] ? connectionIndex : null;
    }

    function isPointOverDeleteBar(clientX, clientY) {
        return isPointOverElement(toolbar, clientX, clientY);
    }

    function isPointOverToolbarControl(clientX, clientY) {
        const targetEl = document.elementFromPoint(clientX, clientY);
        return Boolean(targetEl?.closest('#toolbarStack') || targetEl?.closest('#saveMenuPanel') || targetEl?.closest('#alignMenuPanel') || targetEl?.closest('#context-menu'));
    }

    function updateDeleteDropZoneState(isActive, isHover = false) {
        if (!toolbarStack) return;
        toolbarStack.classList.toggle('delete-drop-ready', isActive);
        toolbarStack.classList.toggle('delete-drop-hover', isActive && isHover);
    }

    function clearDeleteDropZoneState() {
        updateDeleteDropZoneState(false, false);
    }

    function createToolbarDragPreview(sourceButton) {
        const previewEl = document.createElement('div');
        previewEl.className = 'toolbar-drag-preview';
        previewEl.innerHTML = sourceButton.innerHTML;
        document.body.appendChild(previewEl);
        return previewEl;
    }

    function removeToolbarDragPreview() {
        if (!activeToolbarDrag?.previewEl) return;
        activeToolbarDrag.previewEl.remove();
        activeToolbarDrag.previewEl = null;
    }

    function positionToolbarDragPreview(clientX, clientY) {
        if (!activeToolbarDrag?.previewEl) return;
        activeToolbarDrag.previewEl.style.left = `${clientX}px`;
        activeToolbarDrag.previewEl.style.top = `${clientY}px`;
    }

    function getCanvasPointFromClient(clientX, clientY) {
        return {
            x: (clientX - panX) / zoom,
            y: (clientY - panY) / zoom
        };
    }

    function createToolbarItemAtClientPosition(dragState, clientX, clientY) {
        const canvasPoint = getCanvasPointFromClient(clientX, clientY);
        if (dragState.action === 'create-table') {
            const tableId = createTable(null, canvasPoint.x, canvasPoint.y, '', '#ffffff', '#0f172a', false);
            const table = tables[tableId];
            if (!table) return false;
            setTablePosition(table, canvasPoint.x, canvasPoint.y);
            saveHistoryState();
            return true;
        }

        const nodeId = createNode(dragState.nodeType, null, canvasPoint.x, canvasPoint.y, null, null, null, false);
        const node = nodes[nodeId];
        if (!node) return false;
        setNodePosition(node, canvasPoint.x, canvasPoint.y);
        if (isGroupNode(nodeId)) syncAllNodeGroupMembership({ autosave: false });
        else syncNodeGroupMembership(nodeId, { autosave: false });
        drawConnections();
        saveHistoryState();
        return true;
    }

    function getToolbarDragClientPoint(e, dragState) {
        const fallbackX = dragState?.lastX ?? dragState?.startX ?? 0;
        const fallbackY = dragState?.lastY ?? dragState?.startY ?? 0;
        return {
            x: Number.isFinite(e?.clientX) ? e.clientX : fallbackX,
            y: Number.isFinite(e?.clientY) ? e.clientY : fallbackY
        };
    }

    function isValidToolbarDropTarget(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        if (clientX < 0 || clientY < 0 || clientX > window.innerWidth || clientY > window.innerHeight) return false;

        const hitElement = document.elementFromPoint(clientX, clientY);
        if (!hitElement) return isPointOverElement(viewport, clientX, clientY);
        if (hitElement.closest('#toolbarStack') || hitElement.closest('#saveMenuPanel') || hitElement.closest('#alignMenuPanel') || hitElement.closest('#context-menu')) {
            return false;
        }
        return Boolean(hitElement.closest('#canvas-viewport') || isPointOverElement(viewport, clientX, clientY));
    }

    function finishToolbarItemDrag(e, { cancelled = false } = {}) {
        if (!activeToolbarDrag || activeToolbarDrag.pointerId !== e.pointerId) return false;
        const dragState = activeToolbarDrag;
        const dropPoint = getToolbarDragClientPoint(e, dragState);
        if (dragState.buttonEl?.hasPointerCapture?.(dragState.pointerId)) {
            dragState.buttonEl.releasePointerCapture(dragState.pointerId);
        }

        if (!cancelled && dragState.hasDragged && isValidToolbarDropTarget(dropPoint.x, dropPoint.y)) {
            createToolbarItemAtClientPosition(dragState, dropPoint.x, dropPoint.y);
        }

        removeToolbarDragPreview();
        activeToolbarDrag = null;
        setCanvasSelectionSuppressed(false);
        clearDeleteDropZoneState();
        if (dragState.hasDragged) {
            suppressNextToolbarCreateAction = true;
            clearTextSelection();
        }
        return true;
    }

    function startToolbarItemDrag(e) {
        if (e.button !== 0) return;
        const buttonEl = e.currentTarget;
        if (!(buttonEl instanceof HTMLElement)) return;
        hideContextMenu();
        hideSaveMenu();
        hideAlignMenu();
        commitActiveInlineEditors(buttonEl);
        suppressNextToolbarCreateAction = false;
        activeToolbarDrag = {
            pointerId: e.pointerId,
            buttonEl,
            action: buttonEl.dataset.action || '',
            nodeType: buttonEl.dataset.nodeType || '',
            startX: e.clientX,
            startY: e.clientY,
            lastX: e.clientX,
            lastY: e.clientY,
            hasDragged: false,
            previewEl: null
        };
        if (buttonEl.setPointerCapture) {
            buttonEl.setPointerCapture(e.pointerId);
        }
    }

    function getDraggedNodeIds() {
        const draggedNodeIds = new Set();
        const pendingNodeIds = Array.from(selectedNodes);

        while (pendingNodeIds.length) {
            const nodeId = pendingNodeIds.pop();
            if (!nodes[nodeId] || draggedNodeIds.has(nodeId)) continue;

            draggedNodeIds.add(nodeId);
            getGroupDescendantIds(nodeId).forEach(descendantId => {
                if (!draggedNodeIds.has(descendantId)) pendingNodeIds.push(descendantId);
            });
            getCollapsedDescendantIds(nodeId).forEach(descendantId => {
                if (!draggedNodeIds.has(descendantId)) pendingNodeIds.push(descendantId);
            });
        }

        return Array.from(draggedNodeIds);
    }

    function getOwnedSelectedNodeIds() {
        const ownedNodeIds = new Set(selectedNodes);
        selectedNodes.forEach(nodeId => {
            if (!isGroupNode(nodeId)) return;
            getGroupDescendantIds(nodeId).forEach(descendantId => ownedNodeIds.add(descendantId));
        });
        return Array.from(ownedNodeIds);
    }

    function handleNodeResizePointerDown(e) {
        e.stopPropagation();
        if (e.button === 2) return;

        const handleEl = e.currentTarget;
        const nodeEl = handleEl instanceof HTMLElement ? handleEl.closest('.node') : null;
        const nodeId = nodeEl?.id || '';
        const node = nodes[nodeId];
        if (!node || !isResizableNodeType(node.type)) return;

        hideContextMenu();
        hideSaveMenu();
        hideAlignMenu();
        commitActiveInlineEditors(handleEl);
        e.preventDefault();
        clearTextSelection();
        setCanvasSelectionSuppressed(true);

        if (!selectedNodes.has(nodeId) || selectedNodes.size !== 1 || selectedTableIds.size !== 0) {
            clearSelection();
            addToSelection(nodeId);
        }

        if (e.pointerType === 'touch') {
            trackActivePointer(e);
        }

        activeNodeResize = {
            pointerId: e.pointerId,
            nodeId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startWidth: node.width || node.el.offsetWidth,
            startHeight: node.height || node.el.offsetHeight,
            didResize: false
        };
        currentMode = 'RESIZE_NODE';
        isDragging = false;
        pendingNodeEditId = null;
        handleEl.setPointerCapture?.(e.pointerId);
    }

    function isTemporaryConnectShortcut(e) {
        return !isConnectMode && e.altKey;
    }

    function setConnectPreview(fromId, clientX, clientY) {
        connectPreview = { fromId, clientX, clientY };
        drawConnections();
    }

    function clearConnectPreview() {
        if (!connectPreview) return;
        connectPreview = null;
        drawConnections();
    }

    function getConnectionEndpoint(endpointId) {
        if (nodes[endpointId]) return nodes[endpointId];
        if (tables[endpointId]) return tables[endpointId];
        return null;
    }

    function isConnectableEndpoint(endpointId) {
        if (nodes[endpointId]) return nodes[endpointId].type !== 'floatingText';
        return Boolean(tables[endpointId]);
    }

    function getSelectedConnection() {
        const selectedIndex = getSingleSelectedConnectionIndex();
        return Number.isInteger(selectedIndex) ? connections[selectedIndex] || null : null;
    }

    function updateConnectionLabel(index, label, recordHistory = false) {
        const connection = connections[index];
        const normalizedLabel = normalizeConnectionLabel(label);
        if (!connection || connection.label === normalizedLabel) return false;
        connection.label = normalizedLabel;
        drawConnections();
        if (recordHistory) saveHistoryState();
        else scheduleAutosave();
        return true;
    }

    function getConnectionRenderMetrics(connectionOrIndex) {
        const connection = typeof connectionOrIndex === 'number' ? connections[connectionOrIndex] : connectionOrIndex;
        if (!connection) return null;
        const nFrom = getConnectionEndpoint(connection.from);
        const nTo = getConnectionEndpoint(connection.to);
        if (!nFrom || !nTo) return null;
        if (nFrom.el.style.display === 'none' || nTo.el.style.display === 'none') return null;

        const sCX = nFrom.x + nFrom.el.offsetWidth / 2;
        const sCY = nFrom.y + nFrom.el.offsetHeight / 2;
        const eCX = nTo.x + nTo.el.offsetWidth / 2;
        const eCY = nTo.y + nTo.el.offsetHeight / 2;
        const start = getEdgePoint(nFrom, eCX, eCY);
        const end = getEdgePoint(nTo, sCX, sCY);

        return {
            start,
            end,
            labelX: (start.x + end.x) / 2,
            labelY: ((start.y + end.y) / 2) - 12
        };
    }

    function sizeConnectionLabelEditor() {
        if (!connectionLabelEditor) return;
        const charWidth = 7.2;
        const nextWidth = Math.max(88, Math.min(320, (connectionLabelEditor.value.length * charWidth) + 32));
        connectionLabelEditor.style.width = `${nextWidth}px`;
    }

    function syncConnectionLabelEditorPosition() {
        if (!connectionLabelEditor || editingConnectionIndex === null) return;
        if (getSingleSelectedConnectionIndex() !== editingConnectionIndex) {
            finishConnectionLabelEditing(true, true);
            return;
        }
        const metrics = getConnectionRenderMetrics(editingConnectionIndex);
        if (!metrics) {
            finishConnectionLabelEditing(true, true);
            return;
        }
        connectionLabelEditor.style.left = `${metrics.labelX}px`;
        connectionLabelEditor.style.top = `${metrics.labelY}px`;
        sizeConnectionLabelEditor();
    }

    function beginConnectionLabelEditing(index) {
        if (!connectionLabelEditor || !connections[index]) return;
        const metrics = getConnectionRenderMetrics(index);
        if (!metrics) return;

        stopEditingLabel(getActiveEditingLabel());
        finishTableEditing(true, true);
        if (editingConnectionIndex !== null && editingConnectionIndex !== index) {
            finishConnectionLabelEditing(true, true);
        }
        if (getSingleSelectedConnectionIndex() !== index) {
            clearSelection();
            addConnectionToSelection(index);
            updateToolbarColors();
            drawConnections();
        }

        editingConnectionIndex = index;
        connectionLabelEditor.value = connections[index].label || '';
        connectionLabelEditor.classList.add('visible');
        syncConnectionLabelEditorPosition();
        connectionLabelEditor.focus();
        connectionLabelEditor.select();
    }

    function updateRichTextToolbarVisibility() {
        if (!formatTools) return;
        const activeLabel = getActiveEditingLabel();
        const activeNodeType = getNodeType(activeLabel);
        formatTools.classList.toggle('visible', Boolean(activeLabel) && !doesNodeTypeAllowTables(activeNodeType));
    }

    function placeCaretAtEnd(label) {
        if (!label) return;
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(label);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function getEditingSelectionRange(label = getActiveEditingLabel()) {
        const selection = window.getSelection();
        if (!label || !selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        if (!label.contains(range.commonAncestorContainer)) return null;
        return range;
    }

    function ensureEditingSelection(label = getActiveEditingLabel()) {
        if (!label) return false;
        label.focus();
        if (!getEditingSelectionRange(label)) placeCaretAtEnd(label);
        return true;
    }

    function syncRichTextEditorLayout() {
        updateRichTextToolbarVisibility();
        updateAnalyticsCard();
        drawConnections();
    }

    function insertRichTextHTML(html) {
        const label = getActiveEditingLabel();
        if (!label || !ensureEditingSelection(label)) return false;
        const didInsert = document.execCommand ? document.execCommand('insertHTML', false, html) : false;
        if (!didInsert) {
            const range = getEditingSelectionRange(label);
            if (!range) return false;
            const template = document.createElement('template');
            template.innerHTML = html;
            const fragment = template.content.cloneNode(true);
            range.deleteContents();
            range.insertNode(fragment);
            placeCaretAtEnd(label);
        }
        label.innerHTML = sanitizeRichTextHTML(label.innerHTML, { allowTables: doesNodeTypeAllowTables(getNodeType(label)) });
        syncRichTextEditorLayout();
        return true;
    }

    function applyRichTextCommand(command, value = '') {
        const label = getActiveEditingLabel();
        if (!label || !ensureEditingSelection(label)) return false;
        const didApply = document.execCommand ? document.execCommand(command, false, value) : false;
        if (!didApply && command === 'formatBlock') {
            return insertRichTextHTML(`<${String(value || 'p').toLowerCase()}>${escapeHTML(getSelectedEditingText() || getLabelPlainText(label) || '')}</${String(value || 'p').toLowerCase()}>`);
        }
        label.innerHTML = sanitizeRichTextHTML(label.innerHTML, { allowTables: doesNodeTypeAllowTables(getNodeType(label)) });
        syncRichTextEditorLayout();
        return true;
    }

    function insertRichCheckbox() {
        insertRichTextHTML('<p><label><input type="checkbox"> Todo</label></p>');
    }

    async function insertRichLink() {
        const label = getActiveEditingLabel();
        if (!label) return;
        const preservedRange = getClonedSelectionRangeWithin(label);
        const preservedText = preservedRange && !preservedRange.collapsed ? preservedRange.toString() : '';
        // Keep the label's editing state (and its DOM selection) intact while the
        // modal is open — window.prompt previously never blurred the label.
        suspendNodeLabelBlurCommit = true;
        let urlInput;
        try {
            urlInput = await showModalPrompt({ title: 'Insert link', defaultValue: 'https://', confirmLabel: 'Insert' });
        } finally {
            suspendNodeLabelBlurCommit = false;
        }
        const href = sanitizeRichTextHref(urlInput || '');
        if (!href) return;
        if (!ensureEditingSelection(label)) return;
        restoreSelectionRangeWithin(label, preservedRange);
        const range = getEditingSelectionRange(label);
        if (range && !range.collapsed) {
            const didApply = document.execCommand ? document.execCommand('createLink', false, href) : false;
            if (!didApply) {
                const linkText = range.toString() || preservedText || href;
                const template = document.createElement('template');
                template.innerHTML = `<a href="${escapeHTML(href)}" target="_blank" rel="noreferrer noopener">${escapeHTML(linkText)}</a>`;
                range.deleteContents();
                range.insertNode(template.content.cloneNode(true));
                placeCaretAtEnd(label);
            }
            label.innerHTML = sanitizeRichTextHTML(label.innerHTML, { allowTables: doesNodeTypeAllowTables(getNodeType(label)) });
            syncRichTextEditorLayout();
            return;
        }
        insertRichTextHTML(`<a href="${escapeHTML(href)}" target="_blank" rel="noreferrer noopener">${escapeHTML(href)}</a>`);
    }

    function requestRichImageInsert() {
        const activeLabel = getActiveEditingLabel();
        const activeNode = activeLabel?.closest('.node');
        if (!richImageInput || !activeNode) return;
        pendingRichTextImageNodeId = activeNode.id;
        richImageInput.value = '';
        richImageInput.click();
    }

    function finishConnectionLabelEditing(commitChanges = true, recordHistory = true) {
        if (!connectionLabelEditor || editingConnectionIndex === null) return false;
        const index = editingConnectionIndex;
        const nextValue = connectionLabelEditor.value;
        editingConnectionIndex = null;
        connectionLabelEditor.classList.remove('visible');
        const changed = commitChanges ? updateConnectionLabel(index, nextValue, recordHistory) : false;
        if (!changed) drawConnections();
        return changed;
    }

    function beginNodeLabelEditing(nodeId) {
        const node = nodes[nodeId];
        const label = getNodeLabelElement(nodeId);
        if (!node || !label) return false;

        finishTableEditing(true, true);
        stopEditingLabel(getActiveEditingLabel());
        node.el.classList.add('editing');
        label.contentEditable = "true";
        label.focus();

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(label);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        updateRichTextToolbarVisibility();
        return true;
    }

    function commitActiveInlineEditors(target = null) {
        const activeEditingLabel = getActiveEditingLabel();
        if (activeEditingLabel && (!target || !activeEditingLabel.contains(target))) {
            stopEditingLabel(activeEditingLabel);
        }
        const activeEditingTable = getActiveEditingTableElement();
        if (activeEditingTable && (!target || !activeEditingTable.contains(target))) {
            finishTableEditing(true, true);
        }
        if (editingConnectionIndex !== null && target !== connectionLabelEditor) {
            finishConnectionLabelEditing(true, true);
        }
    }

    function getContextMenuTargetNodeId() {
        if (contextMenuNodeId && nodes[contextMenuNodeId]) return contextMenuNodeId;
        if (selectedNodes.size === 1) {
            const selectedNodeId = Array.from(selectedNodes)[0];
            if (nodes[selectedNodeId]) return selectedNodeId;
        }
        return null;
    }

    function updateContextMenuState(nodeId = null, tableId = null) {
        const hasNodeContext = Boolean(nodeId && nodes[nodeId]);
        const hasTableContext = Boolean(tableId && tables[tableId]);
        contextMenu.querySelectorAll('.node-context-item, .node-context-separator').forEach(item => {
            item.classList.toggle('hidden', !hasNodeContext);
        });
        contextMenu.querySelectorAll('.table-context-item, .table-context-separator').forEach(item => {
            item.classList.toggle('hidden', !hasTableContext);
        });

        contextMenu.querySelectorAll('.node-context-item').forEach(item => {
            if (!hasNodeContext) {
                item.classList.remove('disabled');
                return;
            }
            const shouldCollapse = item.dataset.collapseDirection === 'collapse';
            const collapseType = item.dataset.collapseType;
            item.classList.toggle('disabled', !canSetNodeCollapse(nodeId, collapseType, shouldCollapse));
        });

        contextMenu.querySelectorAll('.table-context-item').forEach(item => {
            if (!hasTableContext) {
                item.classList.remove('disabled');
                return;
            }
            item.classList.toggle('disabled', !canApplyTableAction(item.dataset.tableAction));
        });
    }

    function triggerContextNodeCollapse(collapseDirection, collapseType) {
        const nodeId = getContextMenuTargetNodeId();
        hideContextMenu();
        if (!nodeId) return;
        setNodeCollapse(nodeId, collapseType, collapseDirection === 'collapse');
    }

    function addConnectionToSelection(index) {
        if (!connections[index]) return false;
        selectedConnectionIndexes.add(index);
        clearNodeSelection();
        clearTableSelection();
        updateToolbarColors();
        drawConnections();
        return true;
    }

    function removeConnectionFromSelection(index) {
        if (!selectedConnectionIndexes.has(index)) return false;
        if (editingConnectionIndex === index) finishConnectionLabelEditing(true, true);
        selectedConnectionIndexes.delete(index);
        updateToolbarColors();
        drawConnections();
        return true;
    }

    function selectConnection(index, additive = false) {
        if (!connections[index]) return;
        if (selectedNodes.size > 0) clearNodeSelection();
        if (selectedTableIds.size > 0) clearTableSelection();
        if (!additive) {
            const keepEditor = selectedConnectionIndexes.size === 1 && selectedConnectionIndexes.has(index);
            clearConnectionSelection({ preserveEditor: keepEditor });
        }
        selectedConnectionIndexes.add(index);
        updateToolbarColors();
        drawConnections();
    }

    function handleConnectionPointerDown(e, index) {
        e.stopPropagation();
        hideContextMenu();
        if (isConnectMode || !connections[index]) return;
        commitActiveInlineEditors(e.target);
        if (e.pointerType === 'touch') {
            trackActivePointer(e);
            queueLongPressContextMenu(e);
            if (beginTouchGesture()) return;
        }

        const isModifierSelect = e.shiftKey || e.ctrlKey || e.metaKey;
        if (isModifierSelect) {
            if (selectedConnectionIndexes.has(index) && (e.ctrlKey || e.metaKey)) removeConnectionFromSelection(index);
            else selectConnection(index, true);
            return;
        }

        if (!selectedConnectionIndexes.has(index)) selectConnection(index);
    }

    function handleConnectionDoubleClick(e, index) {
        e.stopPropagation();
        if (isConnectMode || !connections[index]) return;
        selectConnection(index);
        beginConnectionLabelEditing(index);
    }

    function setSelectedConnectionType(type) {
        const normalizedType = normalizeConnectionType(type);
        const selectedEntries = getSelectedConnectionEntries();
        if (!selectedEntries.length) return;
        let changed = false;
        selectedEntries.forEach(({ connection }) => {
            if (connection.type !== normalizedType) {
                connection.type = normalizedType;
                changed = true;
            }
        });
        if (!changed) return;
        updateToolbarColors();
        drawConnections();
        saveHistoryState();
    }

    function tryCreateConnection(fromId, toId, recordHistory = true, extra = {}) {
        if (!fromId || !toId || fromId === toId) return false;
        if (!isConnectableEndpoint(fromId) || !isConnectableEndpoint(toId)) return false;
        if (connections.find(c => c.from === fromId && c.to === toId)) return false;
        connections.push(normalizeConnection({ from: fromId, to: toId, ...extra }));
        updateVisibility();
        if (recordHistory) saveHistoryState();
        return true;
    }

    function addToSelection(nodeId) {
        if (selectedConnectionIndexes.size) clearConnectionSelection();
        if (selectedTableIds.size) clearTableSelection();
        selectedNodes.add(nodeId);
        nodes[nodeId].el.classList.add('selected');
        updateToolbarColors();
    }

    function removeFromSelection(nodeId) {
        if (!selectedNodes.has(nodeId) || !nodes[nodeId]) return;
        selectedNodes.delete(nodeId);
        nodes[nodeId].el.classList.remove('selected');
        updateToolbarColors();
        drawConnections();
    }

    function isRectIntersectingSelectionBox(boxRect, elementRect) {
        return !(boxRect.right < elementRect.left || boxRect.left > elementRect.right || boxRect.bottom < elementRect.top || boxRect.top > elementRect.bottom);
    }

    function syncMarqueeSelection(boxRect) {
        const nextNodeIds = new Set();
        const nextTableIds = new Set();

        Object.values(nodes).forEach(node => {
            if (node.el.style.display === 'none') return;
            if (isRectIntersectingSelectionBox(boxRect, node.el.getBoundingClientRect())) nextNodeIds.add(node.id);
        });

        Object.values(tables).forEach(table => {
            if (table.el.style.display === 'none') return;
            if (isRectIntersectingSelectionBox(boxRect, table.el.getBoundingClientRect())) nextTableIds.add(table.id);
        });

        Array.from(selectedNodes).forEach(nodeId => {
            if (nextNodeIds.has(nodeId) || !nodes[nodeId]) return;
            selectedNodes.delete(nodeId);
            nodes[nodeId].el.classList.remove('selected');
        });

        nextNodeIds.forEach(nodeId => {
            if (selectedNodes.has(nodeId) || !nodes[nodeId]) return;
            selectedNodes.add(nodeId);
            nodes[nodeId].el.classList.add('selected');
        });

        Array.from(selectedTableIds).forEach(tableId => {
            if (nextTableIds.has(tableId) || !tables[tableId]) return;
            selectedTableIds.delete(tableId);
            tables[tableId].el.classList.remove('selected');
        });

        nextTableIds.forEach(tableId => {
            if (selectedTableIds.has(tableId) || !tables[tableId]) return;
            selectedTableIds.add(tableId);
            tables[tableId].el.classList.add('selected');
        });

        if (activeTableContext.tableId && !selectedTableIds.has(activeTableContext.tableId)) {
            activeTableContext = getDefaultActiveTableContext();
            activeTableAdditionalCellContexts = [];
        }
        syncActiveTableSelectionUI();
        updateToolbarColors();
    }

    // ===== Smart alignment guides + grid snap =====

    var SNAP_GUIDE_THRESHOLD_PX = 6;
    var snapGuideOverlayEl = null;

    function getSelectionSnapBounds() {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let found = false;
        getDraggedNodeIds().forEach(id => {
            const node = nodes[id];
            if (!node) return;
            const w = node.el.offsetWidth || 0, h = node.el.offsetHeight || 0;
            minX = Math.min(minX, node.x); minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + w); maxY = Math.max(maxY, node.y + h);
            found = true;
        });
        getDraggedTableIds().forEach(id => {
            const table = tables[id];
            if (!table) return;
            const w = table.el.offsetWidth || 0, h = table.el.offsetHeight || 0;
            minX = Math.min(minX, table.x); minY = Math.min(minY, table.y);
            maxX = Math.max(maxX, table.x + w); maxY = Math.max(maxY, table.y + h);
            found = true;
        });
        if (!found) return null;
        return { left: minX, top: minY, right: maxX, bottom: maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    }

    function getSnapCandidateRects() {
        const draggedIds = new Set([...getDraggedNodeIds(), ...getDraggedTableIds()]);
        const rects = [];
        Object.values(nodes).forEach(node => {
            if (draggedIds.has(node.id) || node.el.style.display === 'none') return;
            const w = node.el.offsetWidth || 0, h = node.el.offsetHeight || 0;
            rects.push({ left: node.x, top: node.y, right: node.x + w, bottom: node.y + h, cx: node.x + w / 2, cy: node.y + h / 2 });
        });
        Object.values(tables).forEach(table => {
            if (draggedIds.has(table.id) || table.el.style.display === 'none') return;
            const w = table.el.offsetWidth || 0, h = table.el.offsetHeight || 0;
            rects.push({ left: table.x, top: table.y, right: table.x + w, bottom: table.y + h, cx: table.x + w / 2, cy: table.y + h / 2 });
        });
        return rects;
    }

    function getSnapGuideOverlay() {
        if (snapGuideOverlayEl && snapGuideOverlayEl.isConnected) return snapGuideOverlayEl;
        snapGuideOverlayEl = document.createElement('div');
        snapGuideOverlayEl.className = 'snap-guide-overlay';
        viewport.appendChild(snapGuideOverlayEl);
        return snapGuideOverlayEl;
    }

    function renderSnapGuides(guides) {
        clearSnapGuides();
        if (!guides || !guides.length) return;
        const overlay = getSnapGuideOverlay();
        const viewportRect = viewport.getBoundingClientRect();
        guides.forEach(guide => {
            const line = document.createElement('div');
            if (guide.x !== undefined) {
                line.className = 'snap-guide snap-guide-v';
                line.style.left = `${guide.x - viewportRect.left}px`;
            } else {
                line.className = 'snap-guide snap-guide-h';
                line.style.top = `${guide.y - viewportRect.top}px`;
            }
            overlay.appendChild(line);
        });
    }

    function clearSnapGuides() {
        if (snapGuideOverlayEl && snapGuideOverlayEl.isConnected) snapGuideOverlayEl.replaceChildren();
    }

    function computeSnapGuides(rawDx, rawDy) {
        const bounds = getSelectionSnapBounds();
        if (!bounds) return { dx: rawDx, dy: rawDy, guides: [] };
        const candidates = getSnapCandidateRects();
        const threshold = SNAP_GUIDE_THRESHOLD_PX / zoom;
        const gridEnabled = isSnapToGridEnabled();

        let dx = rawDx, dy = rawDy;
        let bestXDx = null, bestYDy = null;
        let bestXGuide = null, bestYGuide = null;

        candidates.forEach(candidate => {
            ['left', 'cx', 'right'].forEach(selEdge => {
                ['left', 'cx', 'right'].forEach(candidateEdge => {
                    const delta = candidate[candidateEdge] - (bounds[selEdge] + rawDx);
                    if (Math.abs(delta) <= threshold && (bestXDx === null || Math.abs(delta) < Math.abs(bestXDx))) {
                        bestXDx = delta;
                        bestXGuide = { screenX: candidate[candidateEdge] * zoom + panX };
                    }
                });
            });
            ['top', 'cy', 'bottom'].forEach(selEdge => {
                ['top', 'cy', 'bottom'].forEach(candidateEdge => {
                    const delta = candidate[candidateEdge] - (bounds[selEdge] + rawDy);
                    if (Math.abs(delta) <= threshold && (bestYDy === null || Math.abs(delta) < Math.abs(bestYDy))) {
                        bestYDy = delta;
                        bestYGuide = { screenY: candidate[candidateEdge] * zoom + panY };
                    }
                });
            });
        });

        const guides = [];
        if (bestXDx !== null) {
            dx = rawDx + bestXDx;
            guides.push({ x: bestXGuide.screenX });
        } else if (gridEnabled) {
            const nextLeft = bounds.left + dx;
            dx += Math.round(nextLeft / SNAP_GRID_SIZE) * SNAP_GRID_SIZE - nextLeft;
        }
        if (bestYDy !== null) {
            dy = rawDy + bestYDy;
            guides.push({ y: bestYGuide.screenY });
        } else if (gridEnabled) {
            const nextTop = bounds.top + dy;
            dy += Math.round(nextTop / SNAP_GRID_SIZE) * SNAP_GRID_SIZE - nextTop;
        }

        return { dx, dy, guides };
    }

    function moveDraggedSelection(dx, dy) {
        let movedNode = false;

        getDraggedNodeIds().forEach(id => {
            const node = nodes[id];
            if (!node) return;
            setNodePosition(node, node.x + dx, node.y + dy);
            movedNode = true;
        });

        getDraggedTableIds().forEach(id => {
            const table = tables[id];
            if (!table) return;
            setTablePosition(table, table.x + dx, table.y + dy);
        });

        if (movedNode) drawConnections();
    }

    viewport.addEventListener('pointerdown', (e) => {
        hideContextMenu();
        hideSaveMenu();
        hideAlignMenu();
        if (e.target.closest('.node') || e.target.closest('.canvas-table') || e.target.closest('.connection-group') || e.target.closest('#toolbarStack') || e.target === connectionLabelEditor) return;
        commitActiveInlineEditors(e.target);
        e.preventDefault();
        pendingNodeEditId = null;
        pendingTableEditContext = null;
        clearTextSelection();
        setCanvasSelectionSuppressed(true);
        trackActivePointer(e);
        viewport.setPointerCapture(e.pointerId);
        queueLongPressContextMenu(e);
        if (beginTouchGesture()) {
            return;
        }
        if (e.button === 2 || activePointers.size >= 2) {
            currentMode = 'PAN'; lastPoint = { x: e.clientX, y: e.clientY }; hasPanned = false;
            if (isConnectMode) toggleConnectMode();
            selectionBoxUI.style.display = 'none';
        } else if (e.button === 0 && !isConnectMode) {
            currentMode = 'SELECT'; clearSelection(); startPoint = { x: e.clientX, y: e.clientY };
            selectionBoxUI.style.left = `${startPoint.x}px`; selectionBoxUI.style.top = `${startPoint.y}px`;
            selectionBoxUI.style.width = `0px`; selectionBoxUI.style.height = `0px`; selectionBoxUI.style.display = 'block';
        }
    });

    function handleNodePointerDown(e) {
        if (e.target.closest('.label') && e.target.closest('.label').isContentEditable) return;
        if (e.button === 2) return;
        if (!e.currentTarget.classList.contains('editing') && (e.target.closest('input[type="checkbox"]') || e.target.closest('a'))) {
            setCanvasSelectionSuppressed(false);
            return;
        }
        const nodeId = e.currentTarget.id;
        const node = nodes[nodeId];
        if (!node) return;
        const isShortcutConnectMode = isTemporaryConnectShortcut(e);
        const isConnectionDrag = isConnectMode || isShortcutConnectMode;
        const clickedGroupChrome = e.target.closest('.node-resize-handle') || e.target.closest('.collapse-btn') || e.target.closest('.label');
        if (!isConnectionDrag && isGroupNode(node) && !clickedGroupChrome) {
            const connectionIndex = getConnectionIndexAtClientPosition(e.clientX, e.clientY, e.currentTarget);
            if (Number.isInteger(connectionIndex)) {
                setCanvasSelectionSuppressed(false);
                handleConnectionPointerDown(e, connectionIndex);
                return;
            }
        }
        commitActiveInlineEditors(e.target);
        e.preventDefault();
        clearTextSelection();
        setCanvasSelectionSuppressed(true);
        if (e.pointerType === 'touch') {
            trackActivePointer(e);
            e.currentTarget.setPointerCapture(e.pointerId);
            queueLongPressContextMenu(e);
            if (beginTouchGesture()) return;
        }
        const isNodeSelected = selectedNodes.has(nodeId);
        const wasOnlySelectedNode = selectedNodes.size === 1 && selectedNodes.has(nodeId) && selectedTableIds.size === 0;
        isDragging = false;
        pendingNodeEditId = null;
        pendingTableEditContext = null;
        const isModifierSelect = e.shiftKey || e.ctrlKey || e.metaKey;
        if (isConnectionDrag && node.type === 'floatingText') {
            if (!wasOnlySelectedNode) {
                clearSelection();
                addToSelection(nodeId);
            }
            setCanvasSelectionSuppressed(false);
            currentMode = 'IDLE';
            return;
        }
        if (isConnectionDrag) {
            clearSelection();
            addToSelection(nodeId);
            currentMode = 'CONNECT_DRAG';
            setConnectPreview(nodeId, e.clientX, e.clientY);
            e.currentTarget.setPointerCapture(e.pointerId);
        } else {
            if (isModifierSelect) {
                if (isNodeSelected && (e.ctrlKey || e.metaKey)) removeFromSelection(nodeId);
                else addToSelection(nodeId);
                setCanvasSelectionSuppressed(false);
                currentMode = 'IDLE';
                return;
            }
            if (!isNodeSelected) {
                clearSelection();
                addToSelection(nodeId);
            } else if (wasOnlySelectedNode) {
                pendingNodeEditId = nodeId;
            }
            currentMode = 'DRAG_NODE';
            dragStartNodePosition = (selectedNodes.size === 1 && selectedTableIds.size === 0)
                ? { x: nodes[Array.from(selectedNodes)[0]]?.x, y: nodes[Array.from(selectedNodes)[0]]?.y }
                : null;
            lastPoint = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
        }
    }

    window.addEventListener('pointermove', (e) => {
        updateTrackedPointer(e);
        updateLongPressFromMove(e);
        if (currentMode === 'GESTURE') {
            updateTouchGesture();
            return;
        }
        if (activeToolbarDrag && activeToolbarDrag.pointerId === e.pointerId) {
            activeToolbarDrag.lastX = e.clientX;
            activeToolbarDrag.lastY = e.clientY;
            const didExceedThreshold = Math.hypot(e.clientX - activeToolbarDrag.startX, e.clientY - activeToolbarDrag.startY) > 8;
            if (didExceedThreshold && !activeToolbarDrag.hasDragged) {
                activeToolbarDrag.hasDragged = true;
                suppressNextToolbarCreateAction = true;
                clearTextSelection();
                setCanvasSelectionSuppressed(true);
                activeToolbarDrag.previewEl = createToolbarDragPreview(activeToolbarDrag.buttonEl);
            }
            if (activeToolbarDrag.hasDragged) {
                positionToolbarDragPreview(e.clientX, e.clientY);
            }
        } else if (currentMode === 'PAN' && activePointers.has(e.pointerId)) {
            clearDeleteDropZoneState();
            clearTextSelection();
            const dx = e.clientX - lastPoint.x; const dy = e.clientY - lastPoint.y;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasPanned = true;
            panX += dx; panY += dy; updateTransform(); lastPoint = { x: e.clientX, y: e.clientY };
        } else if (currentMode === 'SELECT') {
            clearDeleteDropZoneState();
            clearTextSelection();
            selectionBoxUI.style.left = `${Math.min(startPoint.x, e.clientX)}px`;
            selectionBoxUI.style.top = `${Math.min(startPoint.y, e.clientY)}px`;
            selectionBoxUI.style.width = `${Math.abs(e.clientX - startPoint.x)}px`;
            selectionBoxUI.style.height = `${Math.abs(e.clientY - startPoint.y)}px`;
            syncMarqueeSelection(selectionBoxUI.getBoundingClientRect());
        } else if (currentMode === 'DRAG_NODE') {
            if (Math.abs(e.clientX - lastPoint.x) > 2 || Math.abs(e.clientY - lastPoint.y) > 2) {
                isDragging = true;
                clearTextSelection();
            }
            const rawDx = (e.clientX - lastPoint.x) / zoom; const rawDy = (e.clientY - lastPoint.y) / zoom;
            if (isDragging && !isPointOverDeleteBar(e.clientX, e.clientY)) {
                const snapResult = computeSnapGuides(rawDx, rawDy);
                moveDraggedSelection(snapResult.dx, snapResult.dy);
                renderSnapGuides(snapResult.guides);
            } else {
                clearSnapGuides();
                moveDraggedSelection(rawDx, rawDy);
            }
            if (isDragging) updateDeleteDropZoneState(true, isPointOverDeleteBar(e.clientX, e.clientY));
            lastPoint = { x: e.clientX, y: e.clientY };
        } else if (currentMode === 'RESIZE_NODE' && activeNodeResize?.pointerId === e.pointerId) {
            clearDeleteDropZoneState();
            const nextWidth = activeNodeResize.startWidth + ((e.clientX - activeNodeResize.startClientX) / zoom);
            const nextHeight = activeNodeResize.startHeight + ((e.clientY - activeNodeResize.startClientY) / zoom);
            const didResize = setNodeSize(activeNodeResize.nodeId, nextWidth, nextHeight, { autosave: false });
            if (didResize) {
                activeNodeResize.didResize = true;
                isDragging = true;
                clearTextSelection();
            }
        } else if (currentMode === 'DRAG_TABLE') {
            if (Math.abs(e.clientX - lastPoint.x) > 2 || Math.abs(e.clientY - lastPoint.y) > 2) {
                isDragging = true;
                clearTextSelection();
            }
            const rawDx = (e.clientX - lastPoint.x) / zoom;
            const rawDy = (e.clientY - lastPoint.y) / zoom;
            if (isDragging && !isPointOverDeleteBar(e.clientX, e.clientY)) {
                const snapResult = computeSnapGuides(rawDx, rawDy);
                moveDraggedSelection(snapResult.dx, snapResult.dy);
                renderSnapGuides(snapResult.guides);
            } else {
                clearSnapGuides();
                moveDraggedSelection(rawDx, rawDy);
            }
            if (isDragging) updateDeleteDropZoneState(true, isPointOverDeleteBar(e.clientX, e.clientY));
            lastPoint = { x: e.clientX, y: e.clientY };
        } else if (currentMode === 'DRAG_TABLE_STRUCTURE') {
            clearDeleteDropZoneState();
            if (Math.abs(e.clientX - lastPoint.x) > 2 || Math.abs(e.clientY - lastPoint.y) > 2) {
                isDragging = true;
                clearTextSelection();
            }
            updateTableStructureDrag(e.clientX, e.clientY);
        } else if (currentMode === 'CONNECT_DRAG' && connectPreview) {
            clearDeleteDropZoneState();
            connectPreview.clientX = e.clientX;
            connectPreview.clientY = e.clientY;
            drawConnections();
        } else {
            clearDeleteDropZoneState();
        }
    });

    window.addEventListener('pointerup', (e) => {
        if (finishToolbarItemDrag(e)) return;
        cancelLongPress(e.pointerId);
        const completedGesture = currentMode === 'GESTURE';
        activePointers.delete(e.pointerId);
        if (completedGesture) {
            endTouchGesture();
            clearTextSelection();
            return;
        }
        const completedMode = currentMode;
        let enteredEditing = false;
        const didDropOnDeleteBar = isDragging && (completedMode === 'DRAG_NODE' || completedMode === 'DRAG_TABLE') && isPointOverDeleteBar(e.clientX, e.clientY);
        clearDeleteDropZoneState();
        clearSnapGuides();
        if (completedMode === 'SELECT') selectionBoxUI.style.display = 'none';
        if (completedMode === 'DRAG_NODE' && !isDragging && pendingNodeEditId && selectedNodes.size === 1 && selectedNodes.has(pendingNodeEditId) && selectedTableIds.size === 0) {
            setCanvasSelectionSuppressed(false);
            enteredEditing = beginNodeLabelEditing(pendingNodeEditId);
        }
        if (completedMode === 'DRAG_NODE' && isDragging) {
            if (didDropOnDeleteBar) {
                deleteSelection();
            } else {
                const draggedNodeId = selectedNodes.size === 1 && selectedTableIds.size === 0 ? Array.from(selectedNodes)[0] : null;
                const droppedOnNodeId = draggedNodeId ? getDroppedOnNodeId(draggedNodeId) : null;
                if (droppedOnNodeId && !isGroupNode(droppedOnNodeId)) {
                    swapNodePositionsAndConnections(draggedNodeId, droppedOnNodeId, dragStartNodePosition);
                    drawConnections();
                }
                syncAllNodeGroupMembership({ autosave: false });
                const didSplitConnection = draggedNodeId && !droppedOnNodeId ? splitConnectionAtDroppedNode(draggedNodeId) : false;
                if (!didSplitConnection || droppedOnNodeId) saveHistoryState();
            }
        }
        if (completedMode === 'RESIZE_NODE' && activeNodeResize?.pointerId === e.pointerId) {
            if (activeNodeResize.didResize) {
                syncAllNodeGroupMembership({ autosave: false });
                saveHistoryState();
            }
            activeNodeResize = null;
            isDragging = false;
        }
        if (completedMode === 'DRAG_TABLE' && !isDragging && pendingTableEditContext && selectedNodes.size === 0 && selectedConnectionIndexes.size === 0 && selectedTableIds.size === 1 && selectedTableIds.has(pendingTableEditContext.tableId)) {
            const focusCell = getTableCellByContext(pendingTableEditContext.tableId, pendingTableEditContext);
            if (focusCell) {
                setCanvasSelectionSuppressed(false);
                enteredEditing = beginTableEditing(pendingTableEditContext.tableId, focusCell);
            }
        }
        if (completedMode === 'DRAG_TABLE' && isDragging) {
            if (didDropOnDeleteBar) deleteSelection();
            else saveHistoryState();
        }
        if (completedMode === 'DRAG_TABLE_STRUCTURE') {
            const didReorder = finishTableStructureDrag(e.clientX, e.clientY);
            if (didReorder) saveHistoryState();
        }
        pendingNodeEditId = null;
        pendingTableEditContext = null;
        if (completedMode === 'CONNECT_DRAG' && connectPreview) {
            const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.node, .canvas-table');
            const fromId = connectPreview.fromId;
            const createdConnectionIndex = connections.length;
            clearConnectPreview();
            if (targetEl && tryCreateConnection(fromId, targetEl.id)) {
                selectConnection(createdConnectionIndex);
            }
        }
        if (activePointers.size === 0) {
            currentMode = 'IDLE';
            setCanvasSelectionSuppressed(false);
            if (!enteredEditing && completedMode !== 'IDLE') clearTextSelection();
        }
    });

    window.addEventListener('pointercancel', (e) => {
        cancelLongPress(e.pointerId);
        activePointers.delete(e.pointerId);
        if (currentMode === 'GESTURE') endTouchGesture();
        if (activeNodeResize?.pointerId === e.pointerId) {
            activeNodeResize = null;
            currentMode = 'IDLE';
            isDragging = false;
            setCanvasSelectionSuppressed(false);
        }
        pendingTableEditContext = null;
        finishToolbarItemDrag(e, { cancelled: true });
        clearDeleteDropZoneState();
        clearSnapGuides();
    });

    function openContextMenuAtTarget(target, clientX, clientY) {
        const targetEl = target instanceof Element ? target : document.body;
        if (targetEl === connectionLabelEditor) return false;
        commitActiveInlineEditors(targetEl);
        if (hasPanned) return false;
        hideSaveMenu();
        hideAlignMenu();
        if (targetEl.closest('#toolbarStack')) return false;
        const editingLabel = targetEl.closest('.label');
        pendingContextTextCopy = editingLabel && editingLabel.isContentEditable ? getSelectedEditingText() : '';
        const connectionEl = targetEl.closest('.connection-group');
        if (connectionEl && !editingLabel) {
            const connectionIndex = Number(connectionEl.dataset.connectionIndex);
            if (!selectedConnectionIndexes.has(connectionIndex)) selectConnection(connectionIndex);
        }
        const nodeDiv = targetEl.closest('.node');
        const tableDiv = targetEl.closest('.canvas-table');
        const tableCell = targetEl.closest('.canvas-table th, .canvas-table td');
        const tableStructureHandle = targetEl.closest('.canvas-table .table-structure-handle');
        if (nodeDiv && !selectedNodes.has(nodeDiv.id) && !(editingLabel && editingLabel.isContentEditable)) {
            clearSelection(); addToSelection(nodeDiv.id);
        }
        if (tableDiv && !selectedTableIds.has(tableDiv.id)) {
            clearSelection(); addTableToSelection(tableDiv.id);
        }
        contextMenuNodeId = nodeDiv && !(editingLabel && editingLabel.isContentEditable) ? nodeDiv.id : null;
        contextMenuTableId = tableDiv ? tableDiv.id : null;
        if (tableDiv) {
            const tableScope = tableStructureHandle
                ? getTableStructureScope(tableStructureHandle)
                : tableCell
                    ? 'cell'
                    : 'table';
            const contextCell = tableStructureHandle
                ? getTableStructureSelectionCell(tableDiv.id, tableStructureHandle)
                : tableCell;
            setActiveTableContext(tableDiv.id, contextCell, { scope: tableScope });
        }
        updateContextMenuState(contextMenuNodeId, contextMenuTableId);
        contextMenu.style.display = 'flex'; let x = clientX, y = clientY;
        const menuWidth = contextMenu.offsetWidth;
        const menuHeight = contextMenu.offsetHeight;
        x = Math.max(12, Math.min(x, window.innerWidth - menuWidth - 12));
        y = Math.max(12, Math.min(y, window.innerHeight - menuHeight - 12));
        contextMenu.style.left = `${x}px`; contextMenu.style.top = `${y}px`;
        return true;
    }

    window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openContextMenuAtTarget(e.target, e.clientX, e.clientY);
    });

    function hideContextMenu() {
        contextMenuNodeId = null;
        contextMenuTableId = null;
        updateContextMenuState(null, null);
        contextMenu.style.display = 'none';
    }

    window.addEventListener('pointerdown', (e) => {
        const isSaveMenuTarget = e.target.closest('#saveMenuPanel') || e.target.closest('#saveMenuBtn');
        const isAlignMenuTarget = e.target.closest('#alignMenuPanel') || e.target.closest('#alignMenuBtn');
        if (!isSaveMenuTarget) hideSaveMenu();
        if (!isAlignMenuTarget) hideAlignMenu();
    });

    function clearTextSelection() {
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
    }

    function setCanvasSelectionSuppressed(isSuppressed) {
        document.body.classList.toggle('canvas-interacting', isSuppressed);
    }

    function getActiveEditingLabel() {
        return document.querySelector('.node.editing .label[contenteditable="true"]');
    }

    function getSelectedEditingText() {
        const activeEditingLabel = getActiveEditingLabel();
        const selection = window.getSelection();
        if (!activeEditingLabel || !selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
        const range = selection.getRangeAt(0);
        if (!activeEditingLabel.contains(range.commonAncestorContainer)) return '';
        return selection.toString();
    }

    function stopEditingLabel(labelEl) {
        if (!labelEl || !labelEl.classList.contains('label') || !labelEl.isContentEditable) return;
        labelEl.blur();
    }

    if (connectionLabelEditor) {
        connectionLabelEditor.addEventListener('input', () => {
            sizeConnectionLabelEditor();
        });
        connectionLabelEditor.addEventListener('blur', () => {
            finishConnectionLabelEditing(true, true);
        });
        connectionLabelEditor.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                finishConnectionLabelEditing(true, true);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                finishConnectionLabelEditing(false, false);
            }
        });
    }

    function preventToolbarButtonFocusLoss(toolbarEl) {
        if (!toolbarEl) return;
        const handleToolbarPointerLikeDown = (e) => {
            if (e.target.closest('button')) e.preventDefault();
        };
        toolbarEl.addEventListener('pointerdown', handleToolbarPointerLikeDown);
        toolbarEl.addEventListener('mousedown', handleToolbarPointerLikeDown);
    }

    preventToolbarButtonFocusLoss(formatTools);
    preventToolbarButtonFocusLoss(tableTools);

    if (richImageInput) {
        richImageInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            const nodeId = pendingRichTextImageNodeId;
            pendingRichTextImageNodeId = null;
            if (!file || !nodeId || !nodes[nodeId]) {
                e.target.value = '';
                updateRichTextToolbarVisibility();
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                if (!nodes[nodeId]) {
                    e.target.value = '';
                    updateRichTextToolbarVisibility();
                    return;
                }
                beginNodeLabelEditing(nodeId);
                insertRichTextHTML(`<img src="${escapeHTML(String(reader.result || ''))}" alt="${escapeHTML(file.name)}">`);
                e.target.value = '';
            };
            reader.readAsDataURL(file);
        });
    }

    window.addEventListener('keydown', (e) => {
        const isCmd = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        const keyTarget = e.target instanceof HTMLElement ? e.target : null;
        const isEditingLabel = keyTarget?.classList.contains('label') && keyTarget.isContentEditable;
        const isEditingTableCell = Boolean(keyTarget?.closest('.canvas-table.editing') && keyTarget.isContentEditable);
        const isEditingConnectionLabel = keyTarget === connectionLabelEditor;
        const isDuplicateShortcut = isCmd && key === 'd';

        if (isEditingConnectionLabel) {
            if (e.key === 'Escape') {
                e.preventDefault();
                finishConnectionLabelEditing(false, false);
            }
            return;
        }
        if (keyTarget?.matches('input, textarea, select')) {
            return;
        }
        if (isEditingTableCell) {
            if (e.key === 'Escape') {
                e.preventDefault();
                finishTableEditing(true, true);
            }
            return;
        }
        if (isEditingLabel && isDuplicateShortcut) {
            e.preventDefault();
            triggerAction('duplicate');
            return;
        }
        if (isEditingLabel && e.key !== 'Escape') return;
        if (isEditingLabel) {
            e.preventDefault();
            stopEditingLabel(keyTarget);
            return;
        }

        if (e.key === 'Escape') {
            hideContextMenu();
            hideSaveMenu();
            hideAlignMenu();
            return;
        }

        const canStartTableKeyboardEditing = !isCmd
            && !e.altKey
            && editingTableId === null
            && selectedNodes.size === 0
            && selectedConnectionIndexes.size === 0
            && selectedTableIds.size === 1
            && Boolean(activeTableContext.tableId)
            && (!keyTarget || !keyTarget.matches('input, textarea, select, button'));
        if (canStartTableKeyboardEditing) {
            const tableScopeContext = getActiveTableScopeSelectionContext();
            if (e.key === 'Enter' || e.key === 'F2') {
                e.preventDefault();
                beginTableKeyboardEditing();
                return;
            }
            if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                if (
                    tableScopeContext
                    && getResolvedTableScopeCells(tableScopeContext.tableId, tableScopeContext).length > 1
                ) {
                    clearTableScopeContents(tableScopeContext.tableId, tableScopeContext, { recordHistory: true });
                    return;
                }
                beginTableKeyboardEditing('', { replaceContents: true });
                return;
            }
            if (e.key.length === 1) {
                e.preventDefault();
                beginTableKeyboardEditing(e.key, { replaceContents: true });
                return;
            }
        }

        const isRedoShortcut = (isCmd && key === 'y') || (isCmd && e.shiftKey && key === 'z');
        if (e.key === 'Enter' && selectedNodes.size === 0 && getSingleSelectedConnectionIndex() !== null) {
            e.preventDefault();
            beginConnectionLabelEditing(getSingleSelectedConnectionIndex());
            return;
        }
        if (isCmd && !e.shiftKey && key === 'z') { e.preventDefault(); undoHistory(); return; }
        if (isRedoShortcut) { e.preventDefault(); redoHistory(); return; }
        if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey) {
            e.preventDefault();
            deleteSelectedNodeConnections();
        } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
        if (isCmd && key === 'c') { e.preventDefault(); triggerAction('copy'); }
        if (isCmd && key === 'x') { e.preventDefault(); triggerAction('cut'); }
        if (isCmd && key === 'v') {
            if (getActiveTableScopeSelectionContext()) return;
            e.preventDefault();
            triggerAction('paste');
        }
        if (isDuplicateShortcut) { e.preventDefault(); triggerAction('duplicate'); }
        if (isCmd && key === 'a') { e.preventDefault(); selectAllCanvasItems(); }
        if (isCmd && key === 's') { e.preventDefault(); exportJSON(); return; }
        if (e.key === 'Escape') {
            hideContextMenu();
            hideSaveMenu();
            hideAlignMenu();
            clearSelection();
            return;
        }
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
            const hasSelection = selectedNodes.size > 0 || selectedTableIds.size > 0;
            if (hasSelection) {
                e.preventDefault();
                var step = e.shiftKey ? 10 : 1;
                var dx = 0, dy = 0;
                if (key === 'arrowleft') dx = -step;
                if (key === 'arrowright') dx = step;
                if (key === 'arrowup') dy = -step;
                if (key === 'arrowdown') dy = step;

                if (!nudgeHistoryPending) {
                    saveHistoryState();
                    nudgeHistoryPending = true;
                }
                if (nudgeHistoryClearTimer) {
                    clearTimeout(nudgeHistoryClearTimer);
                }
                nudgeHistoryClearTimer = setTimeout(function () {
                    nudgeHistoryPending = false;
                    nudgeHistoryClearTimer = null;
                }, 500);

                var snapEnabled = isSnapToGridEnabled ? isSnapToGridEnabled() : false;

                selectedNodes.forEach(function (id) {
                    var node = nodes[id];
                    if (!node) return;
                    var newX = node.x + dx;
                    var newY = node.y + dy;
                    if (snapEnabled) {
                        newX = Math.round(newX / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
                        newY = Math.round(newY / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
                    }
                    setNodePosition(node, newX, newY);
                });
                selectedTableIds.forEach(function (id) {
                    var table = tables[id];
                    if (!table) return;
                    var newX = table.x + dx;
                    var newY = table.y + dy;
                    if (snapEnabled) {
                        newX = Math.round(newX / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
                        newY = Math.round(newY / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
                    }
                    setTablePosition(table, newX, newY);
                });
                drawConnections();
                scheduleAutosave();
            }
        }
    });

    window.addEventListener('keyup', function (e) {
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
            if (nudgeHistoryClearTimer) {
                clearTimeout(nudgeHistoryClearTimer);
                nudgeHistoryClearTimer = null;
            }
            nudgeHistoryPending = false;
        }
    });

    window.addEventListener('paste', (e) => {
        if (editingTableId !== null) return;
        const keyTarget = e.target instanceof HTMLElement ? e.target : null;
        if (keyTarget?.matches('input, textarea, select') || keyTarget?.isContentEditable) return;
        const context = getActiveTablePasteContext();
        if (!context) return;
        const clipboardText = e.clipboardData?.getData('text/plain') || '';
        if (!clipboardText) return;
        e.preventDefault();
        applyDetectedTableClipboardText(context.tableId, context, clipboardText, { recordHistory: true });
    });

    function triggerAction(action) {
        hideContextMenu();
        const activeEditingLabel = getActiveEditingLabel();
        if (action === 'copy' && (activeEditingLabel || pendingContextTextCopy)) {
            const selectedText = getSelectedEditingText() || pendingContextTextCopy;
            pendingContextTextCopy = '';
            if (selectedText) {
                writeTextToClipboard(selectedText).catch(() => document.execCommand('copy'));
            }
            return;
        }
        pendingContextTextCopy = '';
        if (activeEditingLabel) {
            if (action === 'copy') {
                return;
            }
            if (action === 'paste') return;
        }
        if (action === 'copy' && getActiveTableScopeSelectionContext()) {
            copyActiveTableScopeSelection();
            return;
        }
        if (action === 'cut' && getActiveTableScopeSelectionContext()) {
            cutActiveTableScopeSelection();
            return;
        }
        const tablePasteContext = getActiveTablePasteContext();
        if (action === 'paste' && tablePasteContext) {
            pasteActiveTableScopeSelection(tablePasteContext);
            return;
        }
        if (action === 'copy') copySelection();
        if (action === 'cut') {
            copySelection();
            deleteSelection();
        }
        if (action === 'paste') pasteClipboard();
        if (action === 'duplicate') { copySelection(); pasteClipboard(true); }
        if (action === 'delete') deleteSelection();
    }

    function copySelection() {
        if (selectedNodes.size === 0 && selectedTableIds.size === 0) return;
        const ownedNodeIds = getOwnedSelectedNodeIds();
        clipboard.nodes = ownedNodeIds.map(id => ({
            ...serializeNode(id),
            oldId: id
        }));
        clipboard.tables = Array.from(selectedTableIds).map(id => ({
            ...serializeTable(id),
            oldId: id
        }));
        const ownedEndpointIds = [...ownedNodeIds, ...Array.from(selectedTableIds)];
        clipboard.connections = connections
            .filter(c => ownedEndpointIds.includes(c.from) && ownedEndpointIds.includes(c.to))
            .map(c => normalizeConnection(c));
    }

    function pasteClipboard(connectToOriginal = false) {
        if (!clipboard.nodes.length && !(clipboard.tables || []).length) return;
        clearSelection(); let idMapping = {};
        clipboard.nodes.forEach(n => {
            let newId = createNode(n.type, null, n.x + 40, n.y + 40, n.text, n.bgColor, n.textColor, false, n.html || '', false, n.metadata || null, n.width ?? null, n.height ?? null);
            idMapping[n.oldId] = newId; addToSelection(newId);
        });
        clipboard.nodes.forEach(n => {
            if (!n.parentGroupId || !idMapping[n.oldId] || !idMapping[n.parentGroupId]) return;
            setNodeParentGroup(idMapping[n.oldId], idMapping[n.parentGroupId], { autosave: false });
        });
        (clipboard.tables || []).forEach(table => {
            let newId = createTable(null, table.x + 40, table.y + 40, table.html || '', table.bgColor, table.textColor, false, false, table.filtersEnabled, table.filters || [], table.sortState || null);
            idMapping[table.oldId] = newId; addTableToSelection(newId);
        });
        clipboard.connections.forEach(c => connections.push(normalizeConnection({
            ...c,
            from: idMapping[c.from],
            to: idMapping[c.to]
        })));
        if (connectToOriginal) {
            clipboard.nodes.forEach(n => tryCreateConnection(n.oldId, idMapping[n.oldId], false));
        }
        updateVisibility();
        saveHistoryState();
        const pastedCount = clipboard.nodes.length + (clipboard.tables || []).length;
        showToast(`Pasted ${pastedCount} item${pastedCount === 1 ? '' : 's'}`, 'success', 2500);
    }

    function deleteSelectedNodeConnections() {
        const targetIds = new Set([...getOwnedSelectedNodeIds(), ...selectedTableIds]);
        if (targetIds.size === 0) return;
        const before = connections.length;
        connections = connections.filter(c => !targetIds.has(c.from) && !targetIds.has(c.to));
        if (connections.length < before) {
            drawConnections();
            saveHistoryState();
        }
    }

    function deleteSelection() {
        if (selectedNodes.size > 0 || selectedTableIds.size > 0) {
            if (selectedTableIds.size > 0) finishTableEditing(true, true);
            const nodeIdsToDelete = getOwnedSelectedNodeIds();
            const tableIdsToDelete = Array.from(selectedTableIds);
            const deletedCount = nodeIdsToDelete.length + tableIdsToDelete.length;
            nodeIdsToDelete.forEach(id => {
                connections = connections.filter(c => c.from !== id && c.to !== id);
                collapsedSequenceNodes.delete(id);
                collapsedDependencyNodes.delete(id);
                nodes[id].el.remove(); delete nodes[id];
            });
            tableIdsToDelete.forEach(id => {
                connections = connections.filter(c => c.from !== id && c.to !== id);
                tables[id].el.remove();
                delete tables[id];
            });
            clearSelection(); updateVisibility(); saveHistoryState();
            showToast(`Deleted ${deletedCount} item${deletedCount === 1 ? '' : 's'} — Ctrl+Z to undo`, 'info', 3500);
        } else if (selectedConnectionIndexes.size > 0) {
            finishConnectionLabelEditing(true, true);
            const deletedConnectionCount = selectedConnectionIndexes.size;
            Array.from(selectedConnectionIndexes).sort((a, b) => b - a).forEach(index => {
                if (connections[index]) connections.splice(index, 1);
            });
            clearSelection(); updateVisibility(); saveHistoryState();
            showToast(`Deleted ${deletedConnectionCount} connection${deletedConnectionCount === 1 ? '' : 's'} — Ctrl+Z to undo`, 'info', 3500);
        }
    }

    function getEdgePoint(node, targetX, targetY) {
        const w = node.el.offsetWidth, h = node.el.offsetHeight;
        const cx = node.x + w / 2, cy = node.y + h / 2;
        const dx = targetX - cx, dy = targetY - cy;
        if (dx === 0 && dy === 0) return { x: cx, y: cy };
        let t;
        if (node.type === 'decision') t = 1 / (Math.abs(dx) / (w / 2) + Math.abs(dy) / (h / 2));
        else if (node.type === 'start') t = 1 / Math.sqrt(Math.pow(dx / (w / 2), 2) + Math.pow(dy / (h / 2), 2));
        else { const tx = Math.abs(dx) > 0 ? (w / 2) / Math.abs(dx) : Infinity; const ty = Math.abs(dy) > 0 ? (h / 2) / Math.abs(dy) : Infinity; t = Math.min(tx, ty); }
        return { x: cx + dx * t, y: cy + dy * t };
    }

    function isPointInRect(point, rect) {
        return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    }

    function getPointToSegmentDistance(point, start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
        const t = Math.max(0, Math.min(1, (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / ((dx * dx) + (dy * dy))));
        const closestPoint = { x: start.x + (dx * t), y: start.y + (dy * t) };
        return Math.hypot(point.x - closestPoint.x, point.y - closestPoint.y);
    }

    function getOrientation(a, b, c) {
        const value = ((b.y - a.y) * (c.x - b.x)) - ((b.x - a.x) * (c.y - b.y));
        if (Math.abs(value) < 0.001) return 0;
        return value > 0 ? 1 : 2;
    }

    function isPointOnSegment(point, start, end) {
        return point.x <= Math.max(start.x, end.x) + 0.001 &&
            point.x >= Math.min(start.x, end.x) - 0.001 &&
            point.y <= Math.max(start.y, end.y) + 0.001 &&
            point.y >= Math.min(start.y, end.y) - 0.001;
    }

    function doSegmentsIntersect(startA, endA, startB, endB) {
        const orientation1 = getOrientation(startA, endA, startB);
        const orientation2 = getOrientation(startA, endA, endB);
        const orientation3 = getOrientation(startB, endB, startA);
        const orientation4 = getOrientation(startB, endB, endA);

        if (orientation1 !== orientation2 && orientation3 !== orientation4) return true;
        if (orientation1 === 0 && isPointOnSegment(startB, startA, endA)) return true;
        if (orientation2 === 0 && isPointOnSegment(endB, startA, endA)) return true;
        if (orientation3 === 0 && isPointOnSegment(startA, startB, endB)) return true;
        if (orientation4 === 0 && isPointOnSegment(endA, startB, endB)) return true;
        return false;
    }

    function doesSegmentIntersectRect(start, end, rect) {
        if (isPointInRect(start, rect) || isPointInRect(end, rect)) return true;

        const topLeft = { x: rect.left, y: rect.top };
        const topRight = { x: rect.right, y: rect.top };
        const bottomRight = { x: rect.right, y: rect.bottom };
        const bottomLeft = { x: rect.left, y: rect.bottom };

        return doSegmentsIntersect(start, end, topLeft, topRight) ||
            doSegmentsIntersect(start, end, topRight, bottomRight) ||
            doSegmentsIntersect(start, end, bottomRight, bottomLeft) ||
            doSegmentsIntersect(start, end, bottomLeft, topLeft);
    }

    function getConnectionSplitCandidateIndex(nodeId) {
        const node = nodes[nodeId];
        if (!node) return null;

        const ancestorGroupIds = new Set(getNodeGroupAncestorIds(nodeId));
        const descendantIds = isGroupNode(nodeId) ? new Set(getGroupDescendantIds(nodeId)) : new Set();
        const isContainmentEndpoint = (endpointId) => {
            return ancestorGroupIds.has(endpointId) || descendantIds.has(endpointId);
        };

        const nodeRect = {
            left: node.x,
            top: node.y,
            right: node.x + node.el.offsetWidth,
            bottom: node.y + node.el.offsetHeight
        };
        const nodeCenter = {
            x: node.x + (node.el.offsetWidth / 2),
            y: node.y + (node.el.offsetHeight / 2)
        };
        const maxSplitDistance = Math.max(18, Math.min(node.el.offsetWidth, node.el.offsetHeight) * 0.5);

        let bestMatch = null;
        connections.forEach((connection, index) => {
            if (!connection || connection.from === nodeId || connection.to === nodeId) return;
            if (isContainmentEndpoint(connection.from) || isContainmentEndpoint(connection.to)) return;
            const metrics = getConnectionRenderMetrics(index);
            if (!metrics || !doesSegmentIntersectRect(metrics.start, metrics.end, nodeRect)) return;

            const distance = getPointToSegmentDistance(nodeCenter, metrics.start, metrics.end);
            if (distance > maxSplitDistance) return;
            if (!bestMatch || distance < bestMatch.distance) {
                bestMatch = { index, distance };
            }
        });

        return bestMatch ? bestMatch.index : null;
    }

    function splitConnectionAtDroppedNode(nodeId) {
        const connectionIndex = getConnectionSplitCandidateIndex(nodeId);
        if (!Number.isInteger(connectionIndex)) return false;

        const connection = connections[connectionIndex];
        if (!connection || !nodes[nodeId]) return false;

        const firstHalf = normalizeConnection({
            from: connection.from,
            to: nodeId,
            type: connection.type,
            label: connection.label
        });
        const secondHalf = normalizeConnection({
            from: nodeId,
            to: connection.to,
            type: connection.type
        });

        const hasDuplicateHalf = connections.some((candidate, index) => {
            if (!candidate || index === connectionIndex) return false;
            return (candidate.from === firstHalf.from && candidate.to === firstHalf.to) ||
                (candidate.from === secondHalf.from && candidate.to === secondHalf.to);
        });
        if (hasDuplicateHalf) return false;

        connections.splice(connectionIndex, 1, firstHalf, secondHalf);
        updateVisibility();
        saveHistoryState();
        return true;
    }

    function toggleConnectMode() {
        isConnectMode = !isConnectMode;
        connectBtn.classList.toggle('active', isConnectMode);
        connectBtn.setAttribute('aria-pressed', String(isConnectMode));
        connectBtn.title = `Connect Mode ${isConnectMode ? 'On' : 'Off'} (hold Alt to connect once)`;
        document.body.classList.toggle('connect-mode-active', isConnectMode);
        clearConnectPreview();
        clearSelection();
        if (isConnectMode) {
            showToast('Connect mode on — click one node, then another · Esc or the button to exit', 'info', 3500);
        }
    }

    function drawConnections() {
        const defs = svgLayer.querySelector('defs').outerHTML; svgLayer.innerHTML = defs;
        connections.forEach((conn, index) => {
            const metrics = getConnectionRenderMetrics(conn);
            if (!metrics) return;
            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute("class", "connection-group");
            g.dataset.connectionIndex = String(index);
            g.addEventListener('pointerdown', (e) => handleConnectionPointerDown(e, index));
            g.addEventListener('dblclick', (e) => handleConnectionDoubleClick(e, index));
            const isSel = selectedConnectionIndexes.has(index);
            const connectionType = normalizeConnectionType(conn.type);
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", metrics.start.x); line.setAttribute("y1", metrics.start.y); line.setAttribute("x2", metrics.end.x); line.setAttribute("y2", metrics.end.y);
            line.setAttribute("class", `${isSel ? "straight-line selected-line" : "straight-line"}${connectionType === 'dependency' ? " dependency-line" : ""}`);
            line.setAttribute("marker-end", isSel ? "url(#arrowhead-danger)" : "url(#arrowhead)");
            const hBox = document.createElementNS("http://www.w3.org/2000/svg", "line");
            hBox.setAttribute("x1", metrics.start.x); hBox.setAttribute("y1", metrics.start.y); hBox.setAttribute("x2", metrics.end.x); hBox.setAttribute("y2", metrics.end.y);
            hBox.setAttribute("stroke", "transparent"); hBox.setAttribute("stroke-width", "30");
            g.appendChild(line); g.appendChild(hBox); svgLayer.appendChild(g);

            if (conn.label && editingConnectionIndex !== index) {
                const labelGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
                labelGroup.setAttribute("class", "connection-label-group");
                labelGroup.addEventListener('pointerdown', (e) => handleConnectionPointerDown(e, index));
                labelGroup.addEventListener('dblclick', (e) => handleConnectionDoubleClick(e, index));

                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("class", "connection-label-text");
                text.setAttribute("x", metrics.labelX.toFixed(2));
                text.setAttribute("y", metrics.labelY.toFixed(2));
                text.setAttribute("text-anchor", "middle");
                text.setAttribute("dominant-baseline", "middle");
                if (isSel) text.classList.add('selected');
                text.textContent = conn.label;
                labelGroup.appendChild(text);
                g.appendChild(labelGroup);

                const bounds = text.getBBox();
                const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                bg.setAttribute("class", "connection-label-bg");
                if (isSel) bg.classList.add('selected');
                bg.setAttribute("x", (bounds.x - 8).toFixed(2));
                bg.setAttribute("y", (bounds.y - 5).toFixed(2));
                bg.setAttribute("width", (bounds.width + 16).toFixed(2));
                bg.setAttribute("height", (bounds.height + 10).toFixed(2));
                bg.setAttribute("rx", "999");
                bg.setAttribute("ry", "999");
                labelGroup.insertBefore(bg, text);
            }
        });

        syncConnectionLabelEditorPosition();

        if (connectPreview) {
            const fromNode = getConnectionEndpoint(connectPreview.fromId);
            if (fromNode && fromNode.el.style.display !== 'none') {
                const targetX = (connectPreview.clientX - panX) / zoom;
                const targetY = (connectPreview.clientY - panY) / zoom;
                const sCX = fromNode.x + fromNode.el.offsetWidth / 2;
                const sCY = fromNode.y + fromNode.el.offsetHeight / 2;
                const start = getEdgePoint(fromNode, targetX, targetY);
                const previewLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
                previewLine.setAttribute("x1", start.x);
                previewLine.setAttribute("y1", start.y);
                previewLine.setAttribute("x2", targetX);
                previewLine.setAttribute("y2", targetY);
                previewLine.setAttribute("stroke", "var(--primary)");
                previewLine.setAttribute("stroke-width", "3");
                previewLine.setAttribute("stroke-dasharray", "10 6");
                previewLine.setAttribute("marker-end", "url(#arrowhead)");
                previewLine.setAttribute("opacity", "0.9");
                svgLayer.appendChild(previewLine);
            }
        }
    }
