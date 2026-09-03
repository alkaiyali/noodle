// Declarative UI action binding and boot sequence.

var APP_ACTIONS = {
    'create-node': (actionEl) => createNode(actionEl.dataset.nodeType),
    'create-table': () => createTable(),
    'undo': () => undoHistory(),
    'redo': () => redoHistory(),
    'reset-zoom': () => resetZoom(),
    'toggle-snap-grid': () => toggleSnapGrid(),
    'toggle-help': () => toggleHelpOverlay(),
    'zoom-out': () => zoomView(-0.1),
    'zoom-in': () => zoomView(0.1),
    'center-origin': () => centerViewOnOrigin(),
    'zoom-to-fit': () => zoomToFit(),
    'toggle-connect': () => toggleConnectMode(),
    'toggle-align-menu': () => toggleAlignMenu(),
    'toggle-layout-menu': () => toggleLayoutMenu(),
    'align-selected': (actionEl) => {
        alignSelectedNodes(actionEl.dataset.alignMode);
        hideAlignMenu();
    },
    'run-topological-layout': () => runTopologicalLayout(),
    'run-visual-tidy-layout': () => runVisualTidyLayout(),
    'rotate-layout-clockwise': () => rotateNodeLayoutClockwise(),
    'apply-rich-format': (actionEl) => applyRichTextCommand(actionEl.dataset.richCommand, actionEl.dataset.richValue || ''),
    'insert-rich-checkbox': () => insertRichCheckbox(),
    'insert-rich-link': () => insertRichLink(),
    'insert-rich-image': () => requestRichImageInsert(),
    'apply-color': (actionEl) => applyColor(actionEl.dataset.colorTarget, actionEl.dataset.colorValue),
    'set-connection-type': (actionEl) => setSelectedConnectionType(actionEl.dataset.connectionType),
    'set-connection-style': (actionEl) => setSelectedConnectionStyle(actionEl.dataset.connectionStyle),
    'reset-node-size': () => {
        hideContextMenu();
        const targetIds = selectedNodes.size > 0 ? Array.from(selectedNodes) : (contextMenuNodeId ? [contextMenuNodeId] : []);
        if (!targetIds.length) return;
        targetIds.forEach(id => {
            const node = nodes[id];
            if (!node) return;
            if (node.type === 'group') {
                setNodeSize(node, GROUP_NODE_DEFAULT_SIZE.width, GROUP_NODE_DEFAULT_SIZE.height, { autosave: false });
            } else {
                setNodeSize(node, null, null, { autosave: false });
            }
        });
        saveHistoryState();
        updateToolbarColors();
        showToast(`Reset ${targetIds.length === 1 ? 'node' : targetIds.length + ' nodes'} to auto size`, 'info', 1500);
    },
    'prompt-node-size': async () => {
        hideContextMenu();
        const targetIds = Array.from(selectedNodes);
        if (!targetIds.length) return;
        const firstNode = nodes[targetIds[0]];
        if (!firstNode) return;
        const currentW = firstNode.width || firstNode.el.offsetWidth;
        const currentH = firstNode.height || firstNode.el.offsetHeight;
        const val = await showModalPrompt({
            title: 'Resize Node',
            defaultValue: `${currentW}x${currentH}`,
            placeholder: 'e.g. 240x120 or auto',
            confirmLabel: 'Apply'
        });
        if (!val) return;
        const trimmed = val.trim().toLowerCase();
        if (trimmed === 'auto') {
            targetIds.forEach(id => {
                const node = nodes[id];
                if (node?.type === 'group') setNodeSize(node, GROUP_NODE_DEFAULT_SIZE.width, GROUP_NODE_DEFAULT_SIZE.height, { autosave: false });
                else if (node) setNodeSize(node, null, null, { autosave: false });
            });
            saveHistoryState();
            updateToolbarColors();
            showToast('Reset node size to auto', 'info', 1500);
            return;
        }
        const match = trimmed.match(/^(\d+)\s*(?:x|X|,|\s)\s*(\d+)$/);
        if (!match) {
            showToast('Invalid format. Enter e.g. 240x120 or auto', 'error', 2500);
            return;
        }
        const parsedW = parseInt(match[1], 10);
        const parsedH = parseInt(match[2], 10);
        targetIds.forEach(id => {
            setNodeSize(id, parsedW, parsedH, { autosave: false });
        });
        saveHistoryState();
        updateToolbarColors();
        showToast(`Resized ${targetIds.length === 1 ? 'node' : targetIds.length + ' nodes'} to ${parsedW}×${parsedH}`, 'success', 1500);
    },
    'toggle-theme': () => toggleTheme(),
    'open-diagrams-modal': () => {
        hideSaveMenu();
        if (typeof openDiagramsModal === 'function') openDiagramsModal();
    },
    'toggle-save-menu': () => toggleSaveMenu(),
    'copy-share-link': () => copyShareLinkToClipboard(),
    'copy-json': () => copyJSONToClipboard(),
    'paste-json': () => pasteJSONFromClipboard(),
    'copy-mermaid': () => copyMermaidToClipboard(),
    'paste-mermaid': () => pasteMermaidFromClipboard(),
    'export-mermaid': () => exportMermaidFile(),
    'open-json-file-picker': () => openJSONFilePicker(),
    'export-json': () => exportJSON(),
    'export-svg': () => exportSVG(),
    'export-png': () => exportPNG(),
    'apply-table-action': (actionEl) => {
        hideContextMenu();
        applyTableAction(actionEl.dataset.tableAction, actionEl.dataset.tableId || null, actionEl);
    },
    'trigger-selection-action': (actionEl) => triggerAction(actionEl.dataset.selectionAction),
    'trigger-collapse-action': (actionEl) => triggerContextNodeCollapse(actionEl.dataset.collapseDirection, actionEl.dataset.collapseType),
    'toggle-fullscreen': () => toggleFullscreen(),
    'print-chart': () => window.print()
};

function bindAppActions() {
    document.addEventListener('click', (event) => {
        const actionEl = event.target.closest('[data-action]');
        if (!actionEl) return;
        if (actionEl.classList.contains('disabled')) return;

        const action = actionEl.dataset.action;
        if ((action === 'create-node' || action === 'create-table') && actionEl.dataset.toolbarDraggable === 'true' && suppressNextToolbarCreateAction) {
            suppressNextToolbarCreateAction = false;
            return;
        }

        const handler = APP_ACTIONS[action];
        if (!handler) {
            console.warn(`Unhandled data-action: ${action}`);
            return;
        }
        handler(actionEl);
        if (actionEl.closest('#layoutMenuPanel')) hideLayoutMenu();
    });

    document.querySelectorAll('[data-toolbar-draggable="true"]').forEach(buttonEl => {
        buttonEl.addEventListener('pointerdown', startToolbarItemDrag);
        buttonEl.addEventListener('pointerup', (e) => {
            finishToolbarItemDrag(e);
        });
        buttonEl.addEventListener('pointercancel', (e) => {
            finishToolbarItemDrag(e, { cancelled: true });
        });
    });

    fileInput.addEventListener('change', importJSON);
}

function bindCustomColorInputs() {
    const fillInput = document.getElementById('customFillColorInput');
    const textInput = document.getElementById('customTextColorInput');
    if (fillInput) {
        fillInput.addEventListener('change', () => applyColor('bgColor', fillInput.value));
    }
    if (textInput) {
        textInput.addEventListener('change', () => applyColor('textColor', textInput.value));
    }
}

window.addEventListener('resize', () => {
    drawConnections();
    Object.values(tables).forEach(table => queueTableStructureHandleLayout(table));
    if (activeTableSummaryMenu?.tableId) positionTableSummaryMenu(activeTableSummaryMenu.tableId);
    positionSaveMenu();
    positionAlignMenu();
    positionLayoutMenu();
    syncAnalyticsCardLayout();
});

window.addEventListener('beforeunload', persistAutosaveNow);

function createDefaultStarterGraph() {
    createNode('start', null, null, null, null, '#ffffff', '#0f172a', false);
    setTimeout(() => {
        createNode('process', null, null, null, null, '#ffffff', '#0f172a', false);
        connections.push(normalizeConnection({ from: 'node_0', to: 'node_1' }));
        updateVisibility();
        clearSelection();
        resetSessionHistory();
        saveHistoryState();
    }, 50);
}

bindAppActions();
initializeToolbarButtons();
bindCustomColorInputs();
setSnapToGridEnabled(isSnapToGridEnabled());
if (typeof getSavedTheme === 'function' && typeof applyTheme === 'function') {
    applyTheme(getSavedTheme());
}
if (typeof initDocumentStorage === 'function') {
    initDocumentStorage().catch(() => {});
}

async function bootInitialGraphContent() {
    // Shared links win over local content; with no share token in the URL the
    // default localStorage autosave loads as before.
    try {
        if (typeof getShareEncodedFromUrl === 'function' && getShareEncodedFromUrl()
            && typeof loadSharedGraphFromUrl === 'function') {
            if (await loadSharedGraphFromUrl()) return true;
        }
    } catch (err) {}
    const restoredFromAutosave = loadAutosavedGraph();
    if (restoredFromAutosave) {
        showToast('Restored your last session from autosave.', 'success', 5000);
        return true;
    }
    createDefaultStarterGraph();
    try {
        if (!window.localStorage?.getItem('graph-seen-intro')) {
            window.localStorage?.setItem('graph-seen-intro', '1');
            window.setTimeout(() => {
                showToast('Tip: drag shapes from the toolbar onto the canvas — press ? for shortcuts.', 'info', 7000);
            }, 500);
        }
    } catch (err) {}
    return false;
}

bootInitialGraphContent();

function toggleFullscreen() {
    var isFullscreen = Boolean(document.fullscreenElement);
    var fullscreenBtn = document.getElementById('fullscreenBtn');
    if (!isFullscreen) {
        document.documentElement.requestFullscreen().catch(function () {});
    } else {
        document.exitFullscreen().catch(function () {});
    }
}

function updateFullscreenUI() {
    var isFullscreen = Boolean(document.fullscreenElement);
    document.body.classList.toggle('app-fullscreen', isFullscreen);
    var fullscreenBtn = document.getElementById('fullscreenBtn');
    if (fullscreenBtn) {
        fullscreenBtn.setAttribute('aria-pressed', String(isFullscreen));
        fullscreenBtn.title = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
        var icon = fullscreenBtn.querySelector('#fullscreenIcon');
        if (icon) {
            icon.innerHTML = isFullscreen
                ? '<path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path><path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>'
                : '<path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>';
        }
    }
}

document.addEventListener('fullscreenchange', updateFullscreenUI);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
}
