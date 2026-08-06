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
    'toggle-save-menu': () => toggleSaveMenu(),
    'copy-json': () => copyJSONToClipboard(),
    'paste-json': () => pasteJSONFromClipboard(),
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

const restoredFromAutosave = loadAutosavedGraph();
if (restoredFromAutosave) {
    showToast('Restored your last session from autosave.', 'success', 5000);
} else {
    createDefaultStarterGraph();
    try {
        if (!window.localStorage?.getItem('graph-seen-intro')) {
            window.localStorage?.setItem('graph-seen-intro', '1');
            window.setTimeout(() => {
                showToast('Tip: drag shapes from the toolbar onto the canvas — press ? for shortcuts.', 'info', 7000);
            }, 500);
        }
    } catch (err) {}
}

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
        var icon = fullscreenBtn.querySelector('[data-lucide]');
        if (icon) {
            icon.setAttribute('data-lucide', isFullscreen ? 'minimize' : 'maximize');
        }
    }
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

document.addEventListener('fullscreenchange', updateFullscreenUI);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
}
