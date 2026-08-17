// Boot smoke test: loads the app in jsdom exactly as a browser would
// (script order from index.html), then exercises core flows.
//
// Run with: npm test

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function fail(message) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
}

function ok(message) {
    console.log(`ok   ${message}`);
}

(async () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
    if (scriptSrcs.length === 0) {
        fail('no scripts found in index.html');
        return;
    }

    const dom = new JSDOM(html, {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        url: 'http://localhost/'
    });
    const { window } = dom;

    // jsdom does not implement matchMedia; the app uses it at boot.
    if (typeof window.matchMedia !== 'function') {
        window.matchMedia = (query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
        });
    }

    window.console.error = (...args) => {
        // Surface any console errors as test failures.
        console.log(`[console.error] ${args.join(' ')}`);
    };

    const bootErrors = [];
    for (const src of scriptSrcs) {
        const filePath = path.join(ROOT, src.replace(/^\.\//, ''));
        const source = fs.readFileSync(filePath, 'utf8');
        try {
            window.eval(source);
        } catch (err) {
            bootErrors.push(`${src}: ${err.stack || err.message}`);
        }
    }
    if (bootErrors.length) {
        fail(`boot threw errors:\n${bootErrors.join('\n')}`);
        return;
    }
    ok('all scripts evaluated without throwing');

    // Starter graph (created after a 50ms timeout)
    await new Promise(resolve => setTimeout(resolve, 250));
    const nodeCount = window.nodes ? Object.keys(window.nodes).length : 0;
    const connectionCount = Array.isArray(window.connections) ? window.connections.length : 0;
    if (nodeCount < 2) fail(`expected >= 2 nodes after boot, got ${nodeCount}`);
    else ok(`starter graph created (${nodeCount} nodes)`);
    if (connectionCount < 1) fail(`expected >= 1 connection after boot, got ${connectionCount}`);
    else ok(`starter connection created (${connectionCount})`);

    // Toast system
    if (typeof window.showToast !== 'function') fail('showToast is not defined');
    else {
        window.showToast('hello test', 'info');
        const toast = window.document.querySelector('.toast');
        if (!toast) fail('showToast did not render a .toast element');
        else {
            ok('toast renders');
            const targetToast = window.document.querySelector('.toast');
            targetToast.querySelector('.toast-close').click();
            await new Promise(resolve => setTimeout(resolve, 600));
            if (targetToast.isConnected) fail('toast close button did not dismiss toast');
            else ok('toast dismisses');
        }
    }

    // Modal prompt system
    if (typeof window.showModalPrompt !== 'function') fail('showModalPrompt is not defined');
    else {
        const promise = window.showModalPrompt({ title: 'Test prompt', defaultValue: 'abc' });
        const input = window.document.querySelector('.modal-input');
        if (!input) fail('modal input did not render');
        else {
            input.value = 'https://example.com';
            window.document.querySelector('.modal-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
            const result = await promise;
            await new Promise(resolve => setTimeout(resolve, 350));
            if (result !== 'https://example.com') fail(`modal resolved with ${result}`);
            else if (window.document.querySelector('.modal-overlay')) fail('modal overlay did not close');
            else ok('modal prompt resolves and closes');
        }
    }

    // Invalid JSON import surfaces a toast instead of alert
    const beforeToasts = window.document.querySelectorAll('.toast').length;
    const result = window.importJSONText('{not valid json');
    await new Promise(resolve => setTimeout(resolve, 50));
    if (result !== false) fail('importJSONText should return false for invalid JSON');
    else if (window.document.querySelectorAll('.toast').length <= beforeToasts) fail('invalid JSON did not surface an error toast');
    else ok('invalid JSON shows error toast');

    // Export SVG builder produces a document
    if (typeof window.buildExportSVG !== 'function') fail('buildExportSVG is not defined');
    else {
        const built = window.buildExportSVG();
        if (!built || !built.svg || !(built.width > 0)) fail('buildExportSVG returned an invalid result');
        else {
            const svgString = new window.XMLSerializer().serializeToString(built.svg);
            if (!svgString.includes('<svg')) fail('exported SVG string is malformed');
            else ok(`export SVG builds (${Math.round(built.width)}x${Math.round(built.height)})`);
        }
    }

    // History survives operations
    const undoStack = window.undoStack;
    if (!Array.isArray(undoStack) || undoStack.length < 1) fail('undo stack empty after boot');
    else ok(`history present (${undoStack.length} snapshot(s))`);

    // Node creation through the action registry
    const before = nodeCount;
    window.createNode('process');
    if (window.nodes && Object.keys(window.nodes).length !== before + 1) fail('createNode did not add a node');
    else ok('createNode works');

    // Zoom readout updates
    window.zoom = 1.5;
    window.updateTransform();
    const zoomLabel = window.document.getElementById('zoomLevelBtn');
    if (!zoomLabel || zoomLabel.textContent !== '150%') fail(`zoom readout should show 150%, got ${zoomLabel ? zoomLabel.textContent : 'missing'}`);
    else ok('zoom readout updates');
    if (typeof window.resetZoom !== 'function') fail('resetZoom is not defined');
    else { window.resetZoom(); if (window.zoom !== 1) fail('resetZoom did not set zoom to 1'); else ok('resetZoom works'); }

    // History buttons disabled state
    const undoBtn = window.document.getElementById('undoBtn');
    const redoBtn = window.document.getElementById('redoBtn');
    if (!undoBtn || !redoBtn) fail('undo/redo buttons missing');
    else if (undoBtn.disabled) fail('undo button should be enabled after edits');
    else ok('undo button enabled after edits');

    // Snap-to-grid toggle persists
    window.setSnapToGridEnabled(true);
    if (window.localStorage.getItem('graph-snap-grid') !== '1') fail('snap grid preference not persisted');
    else if (!window.document.getElementById('snapGridBtn').classList.contains('active')) fail('snap button not marked active');
    else ok('snap-to-grid toggle persists');

    // Selection count chip
    window.selectAllCanvasItems();
    const selectionStatus = window.document.getElementById('selectionStatus');
    if (!selectionStatus || selectionStatus.hidden) fail('selection count chip should be visible for multi-selection');
    else ok(`selection count chip shows "${selectionStatus.textContent}"`);
    window.clearSelection();
    if (!selectionStatus.hidden) fail('selection count chip should hide for single/empty selection');
    else ok('selection count chip hides');

    // Delete feedback toast
    const toastCountBeforeDelete = window.document.querySelectorAll('.toast').length;
    window.selectAllCanvasItems();
    window.deleteSelection();
    await new Promise(resolve => setTimeout(resolve, 50));
    if (window.document.querySelectorAll('.toast').length <= toastCountBeforeDelete) fail('delete did not show feedback toast');
    else ok('delete shows undo hint toast');

    // Help overlay toggles
    if (typeof window.toggleHelpOverlay !== 'function') fail('toggleHelpOverlay is not defined');
    else {
        window.toggleHelpOverlay();
        if (!window.document.querySelector('.help-overlay')) fail('help overlay did not open');
        else if (!window.document.querySelector('.help-keys')) fail('help overlay missing shortcut entries');
        else ok('help overlay opens with shortcuts');
        window.toggleHelpOverlay();
        await new Promise(resolve => setTimeout(resolve, 350));
        if (window.document.querySelector('.help-overlay')) fail('help overlay did not close');
        else ok('help overlay closes');
    }

    console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nSMOKE TEST PASSED');
})().catch(err => {
    console.error('FATAL:', err);
    process.exitCode = 1;
});
