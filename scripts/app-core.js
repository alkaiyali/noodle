// Shared DOM refs, app state, and history helpers.

var viewport = document.getElementById('canvas-viewport');
var content = document.getElementById('canvas-content');
var bgGrid = document.getElementById('bg-grid');
var svgLayer = document.getElementById('svg-layer');
var connectionLabelLayer = document.getElementById('connection-labels');
var selectionBoxUI = document.getElementById('selection-box');
var toolbarStack = document.getElementById('toolbarStack');
var toolbar = document.getElementById('toolbar');
var contextMenu = document.getElementById('context-menu');
var connectBtn = document.getElementById('connectBtn');
var fileInput = document.getElementById('fileInput');
var saveMenuBtn = document.getElementById('saveMenuBtn');
var saveMenuPanel = document.getElementById('saveMenuPanel');
var alignMenuBtn = document.getElementById('alignMenuBtn');
var alignMenuPanel = document.getElementById('alignMenuPanel');
var layoutMenuBtn = document.getElementById('layoutMenuBtn');
var layoutMenuPanel = document.getElementById('layoutMenuPanel');
var formatTools = document.getElementById('formatTools');
var tableTools = document.getElementById('tableTools');
var richImageInput = document.getElementById('richImageInput');
var connectionTools = document.getElementById('connectionTools');
var connectionLabelEditor = document.getElementById('connectionLabelEditor');
var colorTools = document.getElementById('colorTools');
var analyticsCard = document.getElementById('analytics-card');
var analyticsBody = document.getElementById('analytics-body');
var analyticsToggleBtn = document.getElementById('analytics-toggle-btn');
var analyticsTitle = document.getElementById('analytics-title');
var analyticsGrid = document.getElementById('analytics-grid');
var metadataEditor = document.getElementById('metadata-editor');
var nodePriceCurrencyInput = document.getElementById('nodePriceCurrencyInput');
var nodePriceInput = document.getElementById('nodePriceInput');
var nodeDateInput = document.getElementById('nodeDateInput');
var nodeTimeInput = document.getElementById('nodeTimeInput');
var analyticsEmpty = document.getElementById('analytics-empty');
var analyticsNote = document.getElementById('analytics-note');
var DEFAULT_NODE_LABELS = {
    start: 'Start/End',
    process: 'Process',
    decision: 'Decision',
    group: 'Group',
    floatingText: 'Text',
    database: 'Database',
    note: 'Note',
    document: 'Document'
};
var DEFAULT_CONNECTION_TYPE = 'sequence';
var BASE_RICH_TEXT_ALLOWED_TAGS = new Set(['A', 'B', 'BR', 'DIV', 'EM', 'FONT', 'H1', 'H2', 'H3', 'I', 'IMG', 'INPUT', 'LABEL', 'LI', 'OL', 'P', 'S', 'SPAN', 'STRONG', 'U', 'UL']);
var TABLE_RICH_TEXT_ALLOWED_TAGS = new Set(['TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR']);
var DEFAULT_NODE_METADATA = { price: '', currency: 'USD', date: '', time: '' };
var NODE_PRICE_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'TWD'];
var GROUP_NODE_DEFAULT_SIZE = { width: 280, height: 180 };
var GROUP_NODE_MIN_SIZE = { width: 180, height: 120 };

var nodes = {};
var connections = [];
var nodeIdCounter = 0;
var suspendNodeLabelBlurCommit = false;

var cachedElementSizes = new WeakMap();

function invalidateCachedElementSizes() {
    cachedElementSizes = new WeakMap();
}

function getElementRenderSize(el) {
    if (!el) return { w: 0, h: 0 };
    let cached = cachedElementSizes.get(el);
    if (!cached) {
        cached = { w: el.offsetWidth, h: el.offsetHeight };
        cachedElementSizes.set(el, cached);
    }
    return cached;
}

var selectedNodes = new Set();
var selectedConnectionIndexes = new Set();
var editingConnectionIndex = null;
var isConnectMode = false;
var clipboard = { nodes: [], tables: [], connections: [] };
var collapsedSequenceNodes = new Set();
var collapsedDependencyNodes = new Set();
var connectPreview = null;
var pendingContextTextCopy = '';
var contextMenuNodeId = null;
var contextMenuTableId = null;
var HISTORY_LIMIT = 100;
var undoStack = [];
var redoStack = [];
var isRestoringHistory = false;
var AUTO_SAVE_STORAGE_KEY = 'graph-autosave-v1';
// localStorage is only a fast crash-recovery mirror of IndexedDB. Diagrams
// above this serialized size (e.g. embedded base64 images) skip the mirror so
// they can never exhaust the ~5MB localStorage quota.
var LOCAL_AUTOSAVE_MIRROR_LIMIT = 1.5 * 1024 * 1024;
var CAMERA_STORAGE_KEY_PREFIX = 'noodle-camera-v1:';
var autosaveTimer = null;
var cameraSaveTimer = null;

var panX = 0;
var panY = 0;
var zoom = 1;
var activePointers = new Map();
var currentMode = 'IDLE';
var startPoint = { x: 0, y: 0 };
var lastPoint = { x: 0, y: 0 };
var isDragging = false;
var isSpacePressed = false;
var hasPanned = false;
var pendingNodeEditId = null;
var pendingTableEditContext = null;

    var CAMERA_IDLE_MS = 150;
    var cameraMovingTimer = null;
    var cameraIdleAt = 0;
    var gridFrameId = 0;
    var ZOOM_LABEL_THROTTLE_MS = 120;
    var zoomLabelEl = null;
    var lastZoomLabelText = '';
    var zoomLabelUpdatedAt = 0;
    var zoomLabelTimer = null;
    // Viewport size is cached (refreshed by invalidateGridSize on resize) so a
    // camera frame never forces a layout read.
    var gridState = { width: 0, height: 0, dpr: 0, color: '', tile: null, tileKey: '', pattern: null };

    // Promote the content to its own compositor layer while the camera is
    // moving so the browser scales a bitmap instead of re-rasterizing every
    // node per frame; drop it once idle so text re-renders crisply. A single
    // timer is re-armed lazily instead of cleared/recreated on every event.
    function markCameraMoving() {
        cameraIdleAt = performance.now() + CAMERA_IDLE_MS;
        if (cameraMovingTimer) return;
        content.classList.add('camera-moving');
        const settle = () => {
            const remaining = cameraIdleAt - performance.now();
            if (remaining > 1) {
                cameraMovingTimer = setTimeout(settle, remaining);
                return;
            }
            cameraMovingTimer = null;
            content.classList.remove('camera-moving');
        };
        cameraMovingTimer = setTimeout(settle, CAMERA_IDLE_MS);
    }

    function invalidateGridSize() {
        gridState.width = 0;
        scheduleGridPaint();
    }

    function invalidateGridColor() {
        gridState.color = '';
        gridState.tileKey = '';
        scheduleGridPaint();
    }

    function scheduleGridPaint() {
        if (typeof window.requestAnimationFrame !== 'function') {
            paintGrid();
            return;
        }
        if (gridFrameId) return;
        gridFrameId = window.requestAnimationFrame(() => {
            gridFrameId = 0;
            paintGrid();
        });
    }

    // The dot grid is one pattern fill on a viewport-sized canvas: a single
    // 2x-spacing tile (one coarse dot + three fine dots on the same lattice)
    // is rebuilt only when zoom changes, and panning just shifts the pattern.
    // Every coarse dot coincides with a fine-lattice point. The fine dots fade
    // out as their spacing shrinks from 24px to 12px, where the coarse layer
    // takes over, so doubling the spacing never pops.
    function paintGrid() {
        if (!bgGrid || typeof bgGrid.getContext !== 'function') return;
        const ctx = bgGrid.getContext('2d');
        if (!ctx || typeof ctx.createPattern !== 'function') return;
        const dpr = window.devicePixelRatio || 1;
        if (!gridState.width || gridState.dpr !== dpr) {
            gridState.width = viewport.clientWidth || window.innerWidth;
            gridState.height = viewport.clientHeight || window.innerHeight;
            gridState.dpr = dpr;
            bgGrid.width = Math.max(1, Math.round(gridState.width * dpr));
            bgGrid.height = Math.max(1, Math.round(gridState.height * dpr));
            gridState.pattern = null;
        }
        if (!gridState.color) {
            gridState.color = getComputedStyle(bgGrid).getPropertyValue('--grid-color').trim() || '#cbd5e1';
        }

        let step = 24 * zoom;
        while (step < 12) step *= 2;
        const fineAlpha = Math.min(1, (step - 12) / 12);
        const dot = Math.min(3, Math.max(1, 1.5 * Math.sqrt(zoom)));
        const tileCss = step * 2;
        const tileKey = `${step}|${dot}|${dpr}|${gridState.color}`;
        if (tileKey !== gridState.tileKey) {
            const tile = gridState.tile || (gridState.tile = document.createElement('canvas'));
            const tilePx = Math.max(1, Math.round(tileCss * dpr));
            tile.width = tilePx;
            tile.height = tilePx;
            const tctx = tile.getContext('2d');
            if (!tctx) return;
            const k = tilePx / tileCss;
            tctx.fillStyle = gridState.color;
            tctx.beginPath();
            tctx.arc(step / 2 * k, step / 2 * k, dot * k, 0, Math.PI * 2);
            tctx.fill();
            if (fineAlpha > 0) {
                tctx.globalAlpha = fineAlpha;
                tctx.beginPath();
                for (const fx of [step / 2, step * 1.5]) {
                    for (const fy of [step / 2, step * 1.5]) {
                        if (fx === step / 2 && fy === step / 2) continue;
                        tctx.moveTo((fx + dot) * k, fy * k);
                        tctx.arc(fx * k, fy * k, dot * k, 0, Math.PI * 2);
                    }
                }
                tctx.fill();
            }
            gridState.tileKey = tileKey;
            gridState.pattern = null;
        }
        if (!gridState.pattern) gridState.pattern = ctx.createPattern(gridState.tile, 'repeat');
        const pattern = gridState.pattern;
        if (!pattern) return;
        const ox = ((panX % tileCss) + tileCss) % tileCss;
        const oy = ((panY % tileCss) + tileCss) % tileCss;
        const scale = (tileCss * dpr) / gridState.tile.width;
        if (typeof pattern.setTransform === 'function' && typeof DOMMatrix === 'function') {
            pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, ox * dpr, oy * dpr]));
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, bgGrid.width, bgGrid.height);
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, bgGrid.width, bgGrid.height);
    }

    function syncZoomLabel() {
        if (zoomLabelTimer) {
            clearTimeout(zoomLabelTimer);
            zoomLabelTimer = null;
        }
        zoomLabelUpdatedAt = performance.now();
        if (!zoomLabelEl || !zoomLabelEl.isConnected) {
            zoomLabelEl = document.getElementById('zoomLevelBtn');
            lastZoomLabelText = '';
        }
        const zoomText = `${Math.round(zoom * 100)}%`;
        if (zoomLabelEl && zoomText !== lastZoomLabelText) {
            zoomLabelEl.textContent = zoomText;
            lastZoomLabelText = zoomText;
        }
    }

    // Any DOM repaint during a camera move makes the browser re-layerize the
    // whole canvas, so the zoom readout updates immediately on the first
    // change, then at most every ZOOM_LABEL_THROTTLE_MS, plus once at the end.
    function scheduleZoomLabelUpdate() {
        const wait = zoomLabelUpdatedAt + ZOOM_LABEL_THROTTLE_MS - performance.now();
        if (wait <= 0) {
            syncZoomLabel();
        } else if (!zoomLabelTimer) {
            zoomLabelTimer = setTimeout(syncZoomLabel, wait);
        }
    }

    function updateTransform() {
        content.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        markCameraMoving();
        scheduleGridPaint();
        scheduleZoomLabelUpdate();
        // Panning/zooming only touches the camera: keep it out of the full
        // diagram autosave and persist it under a tiny per-document key.
        scheduleCameraSave();
        if (typeof renderMinimap === 'function') renderMinimap();
    }

    function getCameraStorageKey() {
        const docId = typeof activeDocumentId === 'string' && activeDocumentId ? activeDocumentId : 'default';
        return CAMERA_STORAGE_KEY_PREFIX + docId;
    }

    function getPersistedCamera() {
        try {
            const raw = window.localStorage?.getItem(getCameraStorageKey());
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !Number.isFinite(parsed.panX) || !Number.isFinite(parsed.panY) || !Number.isFinite(parsed.zoom)) return null;
            return {
                panX: parsed.panX,
                panY: parsed.panY,
                zoom: parsed.zoom,
                at: Number.isFinite(parsed.at) ? parsed.at : 0
            };
        } catch (err) {
            return null;
        }
    }

    function persistCameraNow() {
        if (cameraSaveTimer) {
            clearTimeout(cameraSaveTimer);
            cameraSaveTimer = null;
        }
        try {
            window.localStorage?.setItem(getCameraStorageKey(), JSON.stringify({
                panX, panY, zoom, at: Date.now()
            }));
        } catch (err) {}
    }

    function scheduleCameraSave(delay = 250) {
        if (!window.localStorage) return;
        if (cameraSaveTimer) clearTimeout(cameraSaveTimer);
        cameraSaveTimer = window.setTimeout(() => {
            cameraSaveTimer = null;
            persistCameraNow();
        }, delay);
    }

    function resetZoom() {
        const nextZoom = 1;
        panX = (window.innerWidth / 2) - (window.innerWidth / 2 - panX) * (nextZoom / zoom);
        panY = (window.innerHeight / 2) - (window.innerHeight / 2 - panY) * (nextZoom / zoom);
        zoom = nextZoom;
        updateTransform();
    }

    function centerViewOnOrigin() {
        const allItems = [];
        Object.values(nodes).forEach(n => {
            if (n.el.style.display === 'none') return;
            allItems.push({ x: n.x + n.el.offsetWidth / 2, y: n.y + n.el.offsetHeight / 2 });
        });
        Object.values(tables).forEach(t => {
            if (t.el.style.display === 'none') return;
            allItems.push({ x: t.x + t.el.offsetWidth / 2, y: t.y + t.el.offsetHeight / 2 });
        });
        connections.forEach(conn => {
            const metrics = getConnectionRenderMetrics(conn);
            if (!metrics) return;
            allItems.push({ x: metrics.start.x, y: metrics.start.y });
            allItems.push({ x: metrics.end.x, y: metrics.end.y });
        });
        if (!allItems.length) {
            panX = viewport.clientWidth / 2;
            panY = viewport.clientHeight / 2;
        } else {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            allItems.forEach(item => {
                minX = Math.min(minX, item.x);
                minY = Math.min(minY, item.y);
                maxX = Math.max(maxX, item.x);
                maxY = Math.max(maxY, item.y);
            });
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            panX = viewport.clientWidth / 2 - cx * zoom;
            panY = viewport.clientHeight / 2 - cy * zoom;
        }
        updateTransform();
    }

    function zoomToFit() {
        const allItems = [];
        Object.values(nodes).forEach(n => {
            if (n.el.style.display === 'none') return;
            allItems.push({ x: n.x, y: n.y, w: n.el.offsetWidth, h: n.el.offsetHeight });
        });
        Object.values(tables).forEach(t => {
            if (t.el.style.display === 'none') return;
            allItems.push({ x: t.x, y: t.y, w: t.el.offsetWidth, h: t.el.offsetHeight });
        });
        connections.forEach(conn => {
            const metrics = getConnectionRenderMetrics(conn);
            if (!metrics) return;
            allItems.push({ x: metrics.start.x, y: metrics.start.y, w: 0, h: 0 });
            allItems.push({ x: metrics.end.x, y: metrics.end.y, w: 0, h: 0 });
            if (conn.label) {
                allItems.push({ x: metrics.labelX - 40, y: metrics.labelY - 10, w: 80, h: 20 });
            }
        });
        if (!allItems.length) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        allItems.forEach(item => {
            minX = Math.min(minX, item.x);
            minY = Math.min(minY, item.y);
            maxX = Math.max(maxX, item.x + item.w);
            maxY = Math.max(maxY, item.y + item.h);
        });
        const padding = 80;
        const contentW = (maxX - minX) + padding * 2;
        const contentH = (maxY - minY) + padding * 2;
        zoom = clampZoomValue(Math.min(viewport.clientWidth / contentW, viewport.clientHeight / contentH));
        panX = (viewport.clientWidth / 2) - ((minX + maxX) / 2) * zoom;
        panY = (viewport.clientHeight / 2) - ((minY + maxY) / 2) * zoom;
        updateTransform();
    }

    function getDefaultNodeLabel(type) {
        return DEFAULT_NODE_LABELS[type] || 'Node';
    }

    function getDefaultTableHTML() {
        return '<table><thead><tr><th></th><th></th></tr></thead><tbody><tr><td></td><td></td></tr><tr><td></td><td></td></tr></tbody></table>';
    }

    function escapeHTML(text = '') {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function plainTextToRichHTML(text = '') {
        return escapeHTML(normalizeNodeText(text)).replace(/\n/g, '<br>');
    }

    function sanitizeRichTextHref(href = '') {
        const value = String(href || '').trim();
        if (!value) return '';
        if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
        return '';
    }

    function sanitizeRichTextImageSrc(src = '') {
        const value = String(src || '').trim();
        if (!value) return '';
        if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return value;
        if (/^https?:\/\//i.test(value)) return value;
        return '';
    }

    function sanitizeCSSColor(value = '') {
        const normalizedValue = String(value || '').trim();
        if (!normalizedValue) return '';
        return window.CSS?.supports?.('color', normalizedValue) ? normalizedValue : '';
    }

    function sanitizeNodePrice(value = '') {
        const normalizedValue = String(value ?? '').trim().replace(/,/g, '');
        if (!normalizedValue) return '';
        const parsedValue = Number(normalizedValue);
        return Number.isFinite(parsedValue) ? normalizedValue : '';
    }

    function sanitizeNodeCurrency(value = '') {
        const normalizedValue = String(value || '').trim().toUpperCase();
        return NODE_PRICE_CURRENCIES.includes(normalizedValue) ? normalizedValue : DEFAULT_NODE_METADATA.currency;
    }

    function sanitizeNodeDate(value = '') {
        const normalizedValue = String(value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) return '';
        const [year, month, day] = normalizedValue.split('-').map(part => parseInt(part, 10));
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
        return normalizedValue;
    }

    function sanitizeNodeTime(value = '') {
        const normalizedValue = String(value || '').trim();
        const timeMatch = normalizedValue.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
        if (!timeMatch) return '';
        return `${timeMatch[1]}:${timeMatch[2]}`;
    }

    function sanitizeNodeMetadata(metadata = {}) {
        return {
            price: sanitizeNodePrice(metadata.price),
            currency: sanitizeNodeCurrency(metadata.currency),
            date: sanitizeNodeDate(metadata.date),
            time: sanitizeNodeTime(metadata.time)
        };
    }

    var NODE_MIN_SIZES = {
        start: { width: 80, height: 36 },
        process: { width: 80, height: 36 },
        decision: { width: 70, height: 70 },
        group: { width: 180, height: 120 },
        floatingText: { width: 40, height: 24 },
        database: { width: 80, height: 48 },
        note: { width: 80, height: 50 },
        document: { width: 80, height: 44 }
    };

    function isResizableNodeType(type = '') {
        return Boolean(type && (type in NODE_MIN_SIZES || type === 'group'));
    }

    function getNodeMinSize(type = '') {
        return NODE_MIN_SIZES[type] || GROUP_NODE_MIN_SIZE;
    }

    function sanitizeNodeDimension(value, fallback = null) {
        if (value === null || value === undefined || value === '') return fallback;
        const parsedValue = Math.round(Number(value));
        return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
    }

    function getDefaultNodeSize(type = '') {
        return type === 'group' ? { ...GROUP_NODE_DEFAULT_SIZE } : { width: null, height: null };
    }

    function normalizeNodeSize(type = '', width = null, height = null) {
        if (!isResizableNodeType(type)) return { width: null, height: null };
        const minSize = getNodeMinSize(type);
        const defaultSize = getDefaultNodeSize(type);
        const resolvedWidth = (width !== null && width !== undefined && width !== '')
            ? Math.max(minSize.width, sanitizeNodeDimension(width, minSize.width))
            : defaultSize.width;
        const resolvedHeight = (height !== null && height !== undefined && height !== '')
            ? Math.max(minSize.height, sanitizeNodeDimension(height, minSize.height))
            : defaultSize.height;
        return {
            width: resolvedWidth,
            height: resolvedHeight
        };
    }

    function getNodeMetadata(nodeOrId) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        return sanitizeNodeMetadata(node?.metadata || DEFAULT_NODE_METADATA);
    }

    function hasVisibleNodeMetadata(metadata = {}) {
        const sanitizedMetadata = sanitizeNodeMetadata(metadata);
        return Boolean(sanitizedMetadata.price || sanitizedMetadata.date || sanitizedMetadata.time);
    }

    function setNodeMetadata(nodeOrId, nextMetadata = {}, options = {}) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        if (!node) return false;

        const previousMetadata = getNodeMetadata(node);
        const resolvedMetadata = sanitizeNodeMetadata({ ...previousMetadata, ...nextMetadata });
        if (JSON.stringify(previousMetadata) === JSON.stringify(resolvedMetadata)) return false;

        node.metadata = resolvedMetadata;
        if (typeof updateNodeMetadataDisplay === 'function') updateNodeMetadataDisplay(node);
        if (typeof drawConnections === 'function') drawConnections();

        if (options.recordHistory) saveHistoryState();
        else scheduleAutosave();
        return true;
    }

    function doesNodeTypeAllowTables(type = '') {
        return false;
    }

    function getClonedSelectionRangeWithin(container) {
        const selection = window.getSelection();
        if (!container || !selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) return null;
        return range.cloneRange();
    }

    function restoreSelectionRangeWithin(container, range) {
        const selection = window.getSelection();
        if (!container || !range || !selection) return false;
        try {
            if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return false;
            selection.removeAllRanges();
            selection.addRange(range);
            return true;
        } catch (error) {
            return false;
        }
    }

    function getNodeType(nodeOrId) {
        if (!nodeOrId) return '';
        if (typeof nodeOrId === 'string') return nodes[nodeOrId]?.type || '';
        if (nodeOrId.type) return nodeOrId.type;
        if (nodeOrId instanceof HTMLElement) {
            if (nodeOrId.classList?.contains('node')) {
                return Array.from(nodeOrId.classList).find(className => className !== 'node' && className !== 'selected' && className !== 'editing') || '';
            }
            return getNodeType(nodeOrId.closest('.node'));
        }
        return '';
    }

    function getAllowedRichTextTags(options = {}) {
        const allowedTags = new Set(BASE_RICH_TEXT_ALLOWED_TAGS);
        if (options.allowTables) {
            TABLE_RICH_TEXT_ALLOWED_TAGS.forEach(tag => allowedTags.add(tag));
        }
        return allowedTags;
    }

    function sanitizeRichTextNode(node, options = {}) {
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
        if (node.nodeType !== Node.ELEMENT_NODE) return null;

        const tagName = node.tagName.toUpperCase();
        if (!getAllowedRichTextTags(options).has(tagName)) {
            const fragment = document.createDocumentFragment();
            Array.from(node.childNodes).forEach(childNode => {
                const sanitizedChild = sanitizeRichTextNode(childNode, options);
                if (sanitizedChild) fragment.appendChild(sanitizedChild);
            });
            return fragment;
        }

        if (tagName === 'BR') return document.createElement('br');

        if (tagName === 'IMG') {
            const src = sanitizeRichTextImageSrc(node.getAttribute('src'));
            if (!src) return null;
            const imageEl = document.createElement('img');
            imageEl.setAttribute('src', src);
            const alt = String(node.getAttribute('alt') || '').trim();
            if (alt) imageEl.setAttribute('alt', alt.slice(0, 200));
            return imageEl;
        }

        if (tagName === 'INPUT') {
            if (String(node.getAttribute('type') || '').toLowerCase() !== 'checkbox') return null;
            const inputEl = document.createElement('input');
            inputEl.setAttribute('type', 'checkbox');
            if (node.checked || node.hasAttribute('checked')) inputEl.setAttribute('checked', 'checked');
            return inputEl;
        }

        const normalizedTagName = tagName === 'B'
            ? 'strong'
            : tagName === 'I'
                ? 'em'
                : tagName === 'FONT'
                    ? 'span'
                    : tagName.toLowerCase();
        const element = document.createElement(normalizedTagName);
        if (tagName === 'A') {
            const href = sanitizeRichTextHref(node.getAttribute('href'));
            if (!href) {
                const fragment = document.createDocumentFragment();
                Array.from(node.childNodes).forEach(childNode => {
                    const sanitizedChild = sanitizeRichTextNode(childNode, options);
                    if (sanitizedChild) fragment.appendChild(sanitizedChild);
                });
                return fragment;
            }
            element.setAttribute('href', href);
            element.setAttribute('target', '_blank');
            element.setAttribute('rel', 'noreferrer noopener');
        }

        if (tagName === 'SPAN' || tagName === 'FONT') {
            const styleTokens = [];
            const inlineFontWeight = String(node.style.fontWeight || '').trim();
            const inlineFontStyle = String(node.style.fontStyle || '').trim();
            const inlineTextDecoration = String(node.style.textDecoration || '').trim();
            if (inlineFontWeight && /^(bold|bolder|[5-9]00)$/i.test(inlineFontWeight)) styleTokens.push('font-weight:bold');
            if (inlineFontStyle && /^italic$/i.test(inlineFontStyle)) styleTokens.push('font-style:italic');
            if (inlineTextDecoration && /underline/i.test(inlineTextDecoration)) styleTokens.push('text-decoration:underline');
            if (inlineTextDecoration && /line-through/i.test(inlineTextDecoration)) styleTokens.push('text-decoration:line-through');
            if (styleTokens.length) element.setAttribute('style', styleTokens.join(';'));
        }

        if (tagName === 'TD' || tagName === 'TH') {
            const colspan = Math.max(1, Math.min(8, parseInt(node.getAttribute('colspan') || '1', 10) || 1));
            const rowspan = Math.max(1, Math.min(8, parseInt(node.getAttribute('rowspan') || '1', 10) || 1));
            if (colspan > 1) element.setAttribute('colspan', String(colspan));
            if (rowspan > 1) element.setAttribute('rowspan', String(rowspan));
            const bgColor = sanitizeCSSColor(node.getAttribute('data-cell-bg-color') || node.style.backgroundColor || '');
            const textColor = sanitizeCSSColor(node.getAttribute('data-cell-text-color') || node.style.color || '');
            if (bgColor) element.setAttribute('data-cell-bg-color', bgColor);
            if (textColor) element.setAttribute('data-cell-text-color', textColor);
        }

        Array.from(node.childNodes).forEach(childNode => {
            const sanitizedChild = sanitizeRichTextNode(childNode, options);
            if (sanitizedChild) element.appendChild(sanitizedChild);
        });
        return element;
    }

    function sanitizeRichTextHTML(html = '', options = {}) {
        const template = document.createElement('template');
        template.innerHTML = String(html || '');
        const container = document.createElement('div');
        Array.from(template.content.childNodes).forEach(childNode => {
            const sanitizedChild = sanitizeRichTextNode(childNode, options);
            if (sanitizedChild) container.appendChild(sanitizedChild);
        });
        return container.innerHTML.trim();
    }

    function setLabelContent(labelEl, text = '', html = '', options = {}) {
        if (!labelEl) return;
        const nodeType = options.nodeType || getNodeType(labelEl);
        const sanitizedHtml = sanitizeRichTextHTML(html, { allowTables: doesNodeTypeAllowTables(nodeType) });
        labelEl.innerHTML = sanitizedHtml || plainTextToRichHTML(text);
        invalidateCachedElementSizes();
    }

    function getNodeLabelElement(nodeOrId) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        return node?.el?.querySelector('.label') || null;
    }

    function normalizeNodeText(text = '') {
        return String(text).replace(/\r\n?/g, '\n');
    }

    function getLabelPlainText(labelEl) {
        if (!labelEl) return '';
        return normalizeNodeText(labelEl.innerText || labelEl.textContent || '');
    }

    function getLabelHTML(labelEl) {
        if (!labelEl) return '';
        const nodeType = getNodeType(labelEl);
        return sanitizeRichTextHTML(labelEl.innerHTML || '', { allowTables: doesNodeTypeAllowTables(nodeType) });
    }

    function getNodeText(nodeOrId) {
        return getLabelPlainText(getNodeLabelElement(nodeOrId));
    }

    function getNodeHTML(nodeOrId) {
        return getLabelHTML(getNodeLabelElement(nodeOrId));
    }

    function normalizeConnectionType(type) {
        return type === 'dependency' ? 'dependency' : DEFAULT_CONNECTION_TYPE;
    }

    function normalizeConnectionStyle(style) {
        return ['curved', 'orthogonal'].includes(style) ? style : 'straight';
    }

    function normalizeConnectionLabel(label = '') {
        return String(label ?? '');
    }

    function normalizeConnection(connection = {}) {
        return {
            from: connection.from,
            to: connection.to,
            type: normalizeConnectionType(connection.type),
            style: normalizeConnectionStyle(connection.style),
            label: normalizeConnectionLabel(connection.label)
        };
    }

    function setNodePosition(nodeOrId, x, y) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        if (!node) return;
        node.x = x;
        node.y = y;
        node.el.style.left = `${x}px`;
        node.el.style.top = `${y}px`;
        if (selectedNodes.size === 1 && selectedNodes.has(node.id) && typeof updateQuickAddHandles === 'function') {
            updateQuickAddHandles();
        }
    }

    function setNodeSize(nodeOrId, width = null, height = null, options = {}) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        if (!node) return false;

        const normalizedSize = normalizeNodeSize(node.type, width, height);
        const previousWidth = node.width ?? null;
        const previousHeight = node.height ?? null;
        if (previousWidth === normalizedSize.width && previousHeight === normalizedSize.height) return false;

        node.width = normalizedSize.width;
        node.height = normalizedSize.height;
        node.el.style.width = normalizedSize.width ? `${normalizedSize.width}px` : '';
        node.el.style.height = normalizedSize.height ? `${normalizedSize.height}px` : '';
        invalidateCachedElementSizes();
        if (selectedNodes.size === 1 && selectedNodes.has(node.id) && typeof updateQuickAddHandles === 'function') {
            updateQuickAddHandles();
        }

        if (typeof drawConnections === 'function') drawConnections();
        if (typeof updateAnalyticsCard === 'function') updateAnalyticsCard();
        if (options.recordHistory) saveHistoryState();
        else if (options.autosave !== false) scheduleAutosave();
        return true;
    }

    function serializeNode(nodeOrId, extra = {}) {
        const node = typeof nodeOrId === 'string' ? nodes[nodeOrId] : nodeOrId;
        if (!node) return null;
        const metadata = getNodeMetadata(node);
        const nodeHtml = getNodeHTML(node);
        return {
            id: node.id,
            type: node.type,
            x: roundPersistedPositionValue(node.x),
            y: roundPersistedPositionValue(node.y),
            ...(nodeHtml ? { html: nodeHtml } : { text: getNodeText(node) }),
            bgColor: node.bgColor,
            textColor: node.textColor,
            ...(hasVisibleNodeMetadata(metadata) ? { metadata } : {}),
            ...(node.width ? { width: node.width } : {}),
            ...(node.height ? { height: node.height } : {}),
            ...(node.parentGroupId ? { parentGroupId: node.parentGroupId } : {}),
            ...extra
        };
    }

    function serializeNodes(nodeIds = Object.keys(nodes)) {
        return nodeIds.map(id => serializeNode(id)).filter(Boolean);
    }

    function getPersistedGraphData() {
        const fullyCollapsedNodes = Array.from(collapsedSequenceNodes).filter(id => collapsedDependencyNodes.has(id));
        return {
            nodes: serializeNodes(),
            tables: serializeTables(),
            connections: connections.map(c => normalizeConnection(c)),
            collapsedNodes: fullyCollapsedNodes,
            collapsedSequenceNodes: Array.from(collapsedSequenceNodes),
            collapsedDependencyNodes: Array.from(collapsedDependencyNodes)
        };
    }

    function getGraphExportPayload() {
        return {
            ...getPersistedGraphData(),
            camera: { panX, panY, zoom, at: Date.now() }
        };
    }

    function writeTextToClipboard(text) {
        if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
        return new Promise((resolve, reject) => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', 'true');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
                if (document.execCommand('copy')) resolve();
                else reject(new Error('Copy command failed.'));
            } catch (err) {
                reject(err);
            } finally {
                document.body.removeChild(textarea);
            }
        });
    }

    async function readTextFromClipboard(promptMessage = 'Paste text here:') {
        if (navigator.clipboard?.readText) {
            try { return await navigator.clipboard.readText(); }
            catch (err) {}
        }
        const manualText = await showModalPrompt({ title: promptMessage, confirmLabel: 'Paste' });
        return manualText === null ? '' : manualText;
    }

    var autosaveQuotaWarningShown = false;

    function setAutosaveStatus(statusText) {
        const statusEl = document.getElementById('autosaveStatus');
        if (statusEl) statusEl.textContent = statusText;
    }

    function persistAutosaveNow() {
        if (autosaveTimer) {
            clearTimeout(autosaveTimer);
            autosaveTimer = null;
        }
        const payload = getGraphExportPayload();
        let serialized = '';
        try {
            serialized = JSON.stringify(payload);
        } catch (err) {}
        try {
            if (window.localStorage && serialized && serialized.length <= LOCAL_AUTOSAVE_MIRROR_LIMIT) {
                window.localStorage.setItem(AUTO_SAVE_STORAGE_KEY, serialized);
            } else if (window.localStorage) {
                // Too large for the localStorage mirror; IndexedDB keeps it.
                window.localStorage.removeItem(AUTO_SAVE_STORAGE_KEY);
            }
            setAutosaveStatus('Saved');
            persistCameraNow();
        } catch (err) {
            // Quota or private-mode failure: drop the mirror, IndexedDB still has it.
            try { window.localStorage?.removeItem(AUTO_SAVE_STORAGE_KEY); } catch (removeErr) {}
            setAutosaveStatus('Saved');
            if (!autosaveQuotaWarningShown) {
                autosaveQuotaWarningShown = true;
                showToast('Local storage is full — autosave continues in IndexedDB.', 'info', 5000);
            }
        }
        if (typeof saveActiveDiagramState === 'function') {
            saveActiveDiagramState(payload);
        }
    }

    function scheduleAutosave(delay = 180) {
        if (!window.localStorage) return;
        if (autosaveTimer) clearTimeout(autosaveTimer);
        setAutosaveStatus('Saving…');
        autosaveTimer = window.setTimeout(() => {
            autosaveTimer = null;
            persistAutosaveNow();
        }, delay);
    }

    var SNAP_GRID_STORAGE_KEY = 'graph-snap-grid';
    var SNAP_GRID_SIZE = 24;

    function isSnapToGridEnabled() {
        try { return window.localStorage?.getItem(SNAP_GRID_STORAGE_KEY) === '1'; }
        catch (err) { return false; }
    }

    function setSnapToGridEnabled(enabled) {
        try { window.localStorage?.setItem(SNAP_GRID_STORAGE_KEY, enabled ? '1' : '0'); }
        catch (err) {}
        const snapBtn = document.getElementById('snapGridBtn');
        if (snapBtn) {
            snapBtn.classList.toggle('active', enabled);
            snapBtn.setAttribute('aria-pressed', String(enabled));
        }
    }

    function toggleSnapGrid() {
        const enabled = !isSnapToGridEnabled();
        setSnapToGridEnabled(enabled);
        showToast(enabled ? 'Snap to grid on' : 'Snap to grid off', 'info', 1800);
    }

    function roundPersistedPositionValue(value) {
        return Number.isFinite(value) ? Math.round(value) : value;
    }

    function normalizePersistedPositionEntries(entries = []) {
        let changed = false;
        const normalizedEntries = entries.map(entry => {
            if (!entry || typeof entry !== 'object') return entry;
            const nextX = roundPersistedPositionValue(entry.x);
            const nextY = roundPersistedPositionValue(entry.y);
            if (nextX === entry.x && nextY === entry.y) return entry;
            changed = true;
            return {
                ...entry,
                x: nextX,
                y: nextY
            };
        });
        return { entries: normalizedEntries, changed };
    }

    function normalizePersistedGraphPositions(payload = {}) {
        const normalizedPayload = { ...payload };

        if (Array.isArray(payload.nodes)) {
            normalizedPayload.nodes = normalizePersistedPositionEntries(payload.nodes).entries;
        }

        if (Array.isArray(payload.tables)) {
            normalizedPayload.tables = normalizePersistedPositionEntries(payload.tables).entries;
        }

        return normalizedPayload;
    }

    function resetSessionHistory() {
        undoStack = [];
        redoStack = [];
        updateHistoryButtons();
    }

    function restoreGraphPayload(payload, resetHistory = false, options = {}) {
        const normalizedPayload = normalizePersistedGraphPositions(payload);
        const storedCamera = options.applyStoredCamera === false ? null : getPersistedCamera();
        const payloadCamera = normalizedPayload.camera;
        // Per-document camera beats a stale payload camera unless the payload
        // is newer (e.g. a diagram saved from another tab or device).
        if (storedCamera && (!payloadCamera || !Number.isFinite(Number(payloadCamera.at)) || storedCamera.at >= Number(payloadCamera.at))) {
            panX = storedCamera.panX;
            panY = storedCamera.panY;
            zoom = clampZoomValue(storedCamera.zoom);
            updateTransform();
        } else if (payloadCamera) {
            panX = payloadCamera.panX || 0;
            panY = payloadCamera.panY || 0;
            zoom = payloadCamera.zoom || 1;
            updateTransform();
        }

        restoreGraphState({
            nodes: normalizedPayload.nodes || [],
            tables: normalizedPayload.tables || [],
            connections: normalizedPayload.connections || [],
            collapsedNodes: normalizedPayload.collapsedNodes || [],
            collapsedSequenceNodes: normalizedPayload.collapsedSequenceNodes || [],
            collapsedDependencyNodes: normalizedPayload.collapsedDependencyNodes || [],
            nodeIdCounter: getNextNodeIdCounter(normalizedPayload.nodes || []),
            tableIdCounter: getNextTableIdCounter([...(normalizedPayload.tables || []), ...((normalizedPayload.nodes || []).filter(node => node.type === 'table'))]),
            selectedNodes: [],
            selectedTableIds: [],
            selectedConnectionIndexes: []
        });

        if (resetHistory) resetSessionHistory();
        saveHistoryState();
        scheduleAutosave();
    }

    function loadAutosavedGraph() {
        try {
            const rawAutosave = window.localStorage?.getItem(AUTO_SAVE_STORAGE_KEY);
            if (!rawAutosave) return false;

            const payload = JSON.parse(rawAutosave);
            if (!payload || !Array.isArray(payload.nodes) || !Array.isArray(payload.connections)) return false;

            restoreGraphPayload(payload, true);
            return true;
        } catch (err) {
            return false;
        }
    }

    function positionSaveMenu() {
        if (!saveMenuPanel.classList.contains('visible')) return;
        const rect = saveMenuBtn.getBoundingClientRect();
        const menuWidth = saveMenuPanel.offsetWidth;
        const menuHeight = saveMenuPanel.offsetHeight;
        const left = Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12));
        const top = Math.max(12, rect.top - menuHeight - 12);
        saveMenuPanel.style.left = `${left}px`;
        saveMenuPanel.style.top = `${top}px`;
    }

    function hideSaveMenu() {
        saveMenuPanel.classList.remove('visible');
        saveMenuBtn.classList.remove('active');
        saveMenuBtn.setAttribute('aria-expanded', 'false');
    }

    function toggleSaveMenu() {
        if (saveMenuPanel.classList.contains('visible')) {
            hideSaveMenu();
            return;
        }
        hideContextMenu();
        hideAlignMenu();
        hideLayoutMenu();
        saveMenuPanel.classList.add('visible');
        saveMenuBtn.classList.add('active');
        saveMenuBtn.setAttribute('aria-expanded', 'true');
        positionSaveMenu();
    }

    function positionAlignMenu() {
        if (!alignMenuPanel || !alignMenuBtn || !alignMenuPanel.classList.contains('visible')) return;
        const rect = alignMenuBtn.getBoundingClientRect();
        const menuWidth = alignMenuPanel.offsetWidth;
        const menuHeight = alignMenuPanel.offsetHeight;
        const left = Math.max(12, Math.min(rect.left + (rect.width / 2) - (menuWidth / 2), window.innerWidth - menuWidth - 12));
        const top = Math.max(12, Math.min(rect.bottom + 12, window.innerHeight - menuHeight - 12));
        alignMenuPanel.style.left = `${left}px`;
        alignMenuPanel.style.top = `${top}px`;
    }

    function hideAlignMenu() {
        if (!alignMenuPanel || !alignMenuBtn) return;
        alignMenuPanel.classList.remove('visible');
        alignMenuBtn.classList.remove('active');
        alignMenuBtn.setAttribute('aria-expanded', 'false');
    }

    function toggleAlignMenu() {
        if (!alignMenuPanel || !alignMenuBtn) return;
        if (alignMenuPanel.classList.contains('visible')) {
            hideAlignMenu();
            return;
        }
        hideContextMenu();
        hideSaveMenu();
        hideLayoutMenu();
        alignMenuPanel.classList.add('visible');
        alignMenuBtn.classList.add('active');
        alignMenuBtn.setAttribute('aria-expanded', 'true');
        positionAlignMenu();
    }

    function positionLayoutMenu() {
        if (!layoutMenuPanel || !layoutMenuBtn || !layoutMenuPanel.classList.contains('visible')) return;
        const rect = layoutMenuBtn.getBoundingClientRect();
        const menuWidth = layoutMenuPanel.offsetWidth;
        const menuHeight = layoutMenuPanel.offsetHeight;
        const left = Math.max(12, Math.min(rect.left + (rect.width / 2) - (menuWidth / 2), window.innerWidth - menuWidth - 12));
        const top = Math.max(12, Math.min(rect.bottom + 12, window.innerHeight - menuHeight - 12));
        layoutMenuPanel.style.left = `${left}px`;
        layoutMenuPanel.style.top = `${top}px`;
    }

    function hideLayoutMenu() {
        if (!layoutMenuPanel || !layoutMenuBtn) return;
        layoutMenuPanel.classList.remove('visible');
        layoutMenuBtn.classList.remove('active');
        layoutMenuBtn.setAttribute('aria-expanded', 'false');
    }

    function toggleLayoutMenu() {
        if (!layoutMenuPanel || !layoutMenuBtn) return;
        if (layoutMenuPanel.classList.contains('visible')) {
            hideLayoutMenu();
            return;
        }
        hideContextMenu();
        hideSaveMenu();
        hideAlignMenu();
        layoutMenuPanel.classList.add('visible');
        layoutMenuBtn.classList.add('active');
        layoutMenuBtn.setAttribute('aria-expanded', 'true');
        positionLayoutMenu();
    }

    function openJSONFilePicker() {
        hideSaveMenu();
        fileInput.click();
    }

    function getNextNodeIdCounter(nodeData = []) {
        return nodeData.reduce((maxId, node) => {
            const num = parseInt(String(node.id || '').split('_')[1], 10);
            return Number.isNaN(num) ? maxId : Math.max(maxId, num + 1);
        }, 0);
    }

    function serializeGraphState() {
        return {
            ...getPersistedGraphData(),
            nodeIdCounter,
            tableIdCounter,
            selectedNodes: Array.from(selectedNodes),
            selectedTableIds: Array.from(selectedTableIds),
            selectedConnectionIndexes: Array.from(selectedConnectionIndexes)
        };
    }

    var HISTORY_MAX_APPROX_BYTES = 12 * 1024 * 1024;

    function updateHistoryButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.disabled = undoStack.length <= 1;
        if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    }

    function saveHistoryState() {
        if (isRestoringHistory) return;
        const snapshot = JSON.stringify(serializeGraphState());
        if (undoStack.length && undoStack[undoStack.length - 1] === snapshot) return;
        undoStack.push(snapshot);
        let totalApproxBytes = undoStack.reduce((sum, entry) => sum + entry.length * 2, 0);
        while (undoStack.length > 1 && totalApproxBytes > HISTORY_MAX_APPROX_BYTES) {
            totalApproxBytes -= undoStack[0].length * 2;
            undoStack.shift();
        }
        redoStack = [];
        scheduleAutosave();
        updateHistoryButtons();
    }

    function restoreGraphState(snapshot) {
        isRestoringHistory = true;
        pendingContextTextCopy = '';
        clearConnectPreview();
        hideContextMenu();
        selectionBoxUI.style.display = 'none';
        activePointers.clear();
        currentMode = 'IDLE';
        isDragging = false;
        pendingNodeEditId = null;
        pendingTableEditContext = null;
        editingConnectionIndex = null;
        finishTableEditing(false, false);
        if (connectionLabelEditor) {
            connectionLabelEditor.classList.remove('visible');
            connectionLabelEditor.value = '';
        }

        Object.values(nodes).forEach(n => n.el.remove());
        Object.values(tables).forEach(table => table.el.remove());
        nodes = {};
        tables = {};
        connections = (snapshot.connections || []).map(c => normalizeConnection(c));
        collapsedSequenceNodes = new Set(snapshot.collapsedSequenceNodes || []);
        collapsedDependencyNodes = new Set(snapshot.collapsedDependencyNodes || []);
        (snapshot.collapsedNodes || []).forEach(id => {
            collapsedSequenceNodes.add(id);
            collapsedDependencyNodes.add(id);
        });
        nodeIdCounter = snapshot.nodeIdCounter ?? getNextNodeIdCounter(snapshot.nodes || []);
        tableIdCounter = snapshot.tableIdCounter ?? getNextTableIdCounter([...(snapshot.tables || []), ...((snapshot.nodes || []).filter(node => node.type === 'table'))]);
        selectedNodes = new Set();
        selectedTableIds = new Set();
        selectedConnectionIndexes = new Set();
        contextMenuNodeId = null;
        contextMenuTableId = null;
        setActiveTableContext(null);

        (snapshot.nodes || []).forEach(n => {
            if (n.type === 'table') {
                createTable(n.id, n.x, n.y, n.html || '', n.bgColor, n.textColor, false, false, n.filtersEnabled, n.filters || [], n.sortState || null);
                return;
            }
            createNode(n.type, n.id, n.x, n.y, n.text, n.bgColor, n.textColor, false, n.html || '', false, n.metadata || null, n.width ?? null, n.height ?? null);
        });
        (snapshot.nodes || []).forEach(n => {
            if (!n.parentGroupId || !nodes[n.id] || !nodes[n.parentGroupId]) return;
            setNodeParentGroup(n.id, n.parentGroupId, { autosave: false });
        });
        (snapshot.tables || []).forEach(table => {
            createTable(table.id, table.x, table.y, table.html || '', table.bgColor, table.textColor, false, false, table.filtersEnabled, table.filters || [], table.sortState || null);
        });

        updateVisibility();
        clearSelection();

        (snapshot.selectedNodes || []).forEach(id => {
            if (nodes[id] && nodes[id].el.style.display !== 'none') addToSelection(id);
            if (tables[id]) addTableToSelection(id);
        });
        (snapshot.selectedTableIds || []).forEach(id => {
            if (tables[id]) addTableToSelection(id);
        });

        const connectionIndexes = Array.isArray(snapshot.selectedConnectionIndexes)
            ? snapshot.selectedConnectionIndexes
            : (Number.isInteger(snapshot.selectedConnectionIndex) ? [snapshot.selectedConnectionIndex] : []);
        connectionIndexes.forEach(index => {
            if (connections[index]) selectedConnectionIndexes.add(index);
        });

        updateToolbarColors();
        drawConnections();
        isRestoringHistory = false;
    }

    function undoHistory() {
        if (undoStack.length <= 1) return;
        const currentSnapshot = undoStack.pop();
        redoStack.push(currentSnapshot);
        restoreGraphState(JSON.parse(undoStack[undoStack.length - 1]));
        updateHistoryButtons();
    }

    function redoHistory() {
        if (!redoStack.length) return;
        const snapshot = redoStack.pop();
        undoStack.push(snapshot);
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
        restoreGraphState(JSON.parse(snapshot));
        updateHistoryButtons();
    }

    function exportSVG() {
        hideSaveMenu();
        hideAlignMenu();
        clearSelection();
        const built = buildExportSVG();
        if (!built) return;
        const svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(built.svg);
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'chart.svg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('Exported chart.svg', 'success', 2500);
    }

    function buildExportSVG() {
        const ns = 'http://www.w3.org/2000/svg';
        const allItems = [];
        Object.values(nodes).forEach(n => {
            if (n.el.style.display === 'none') return;
            allItems.push({ type: 'node', x: n.x, y: n.y, w: n.el.offsetWidth, h: n.el.offsetHeight, data: n });
        });
        Object.values(tables).forEach(t => {
            if (t.el.style.display === 'none') return;
            allItems.push({ type: 'table', x: t.x, y: t.y, w: t.el.offsetWidth, h: t.el.offsetHeight, data: t });
        });

        allItems.sort((a, b) => {
            const aIsGroup = a.type === 'node' && a.data?.type === 'group' ? 0 : 1;
            const bIsGroup = b.type === 'node' && b.data?.type === 'group' ? 0 : 1;
            return aIsGroup - bIsGroup;
        });

        if (!allItems.length && !connections.length) {
            showToast('Nothing to export.', 'warning');
            return null;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        allItems.forEach(item => {
            minX = Math.min(minX, item.x);
            minY = Math.min(minY, item.y);
            maxX = Math.max(maxX, item.x + item.w);
            maxY = Math.max(maxY, item.y + item.h);
        });
        connections.forEach(conn => {
            const metrics = getConnectionRenderMetrics(conn);
            if (!metrics) return;
            minX = Math.min(minX, metrics.start.x, metrics.end.x, metrics.labelX - 40);
            minY = Math.min(minY, metrics.start.y, metrics.end.y, metrics.labelY - 10);
            maxX = Math.max(maxX, metrics.start.x, metrics.end.x, metrics.labelX + 40);
            maxY = Math.max(maxY, metrics.start.y, metrics.end.y, metrics.labelY + 10);
        });

        const padding = 40;
        minX = Number.isFinite(minX) ? minX - padding : 0;
        minY = Number.isFinite(minY) ? minY - padding : 0;
        maxX = Number.isFinite(maxX) ? maxX + padding : 500;
        maxY = Number.isFinite(maxY) ? maxY + padding : 500;
        const width = maxX - minX;
        const height = maxY - minY;

        const isDarkTheme = document.body.classList.contains('theme-dark');

        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('xmlns', ns);
        svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);

        const bgRect = document.createElementNS(ns, 'rect');
        bgRect.setAttribute('x', minX);
        bgRect.setAttribute('y', minY);
        bgRect.setAttribute('width', width);
        bgRect.setAttribute('height', height);
        bgRect.setAttribute('fill', isDarkTheme ? '#090d16' : '#f8fafc');
        svg.appendChild(bgRect);

        const defs = document.createElementNS(ns, 'defs');
        const marker = document.createElementNS(ns, 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('viewBox', '0 0 12 12');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('refX', '11');
        marker.setAttribute('refY', '6');
        marker.setAttribute('orient', 'auto');
        const poly = document.createElementNS(ns, 'path');
        poly.setAttribute('d', 'M2 2.5 L11 6 L2 9.5 L4.2 6 Z');
        poly.setAttribute('stroke-width', '1');
        poly.setAttribute('stroke-linejoin', 'round');
        poly.setAttribute('fill', isDarkTheme ? '#94a3b8' : '#64748b');
        poly.setAttribute('stroke', isDarkTheme ? '#94a3b8' : '#64748b');
        marker.appendChild(poly);
        defs.appendChild(marker);

        const markerDanger = document.createElementNS(ns, 'marker');
        markerDanger.setAttribute('id', 'arrowhead-danger');
        markerDanger.setAttribute('viewBox', '0 0 12 12');
        markerDanger.setAttribute('markerWidth', '6');
        markerDanger.setAttribute('markerHeight', '6');
        markerDanger.setAttribute('refX', '11');
        markerDanger.setAttribute('refY', '6');
        markerDanger.setAttribute('orient', 'auto');
        const polyDanger = document.createElementNS(ns, 'path');
        polyDanger.setAttribute('d', 'M2 2.5 L11 6 L2 9.5 L4.2 6 Z');
        polyDanger.setAttribute('stroke-width', '1');
        polyDanger.setAttribute('stroke-linejoin', 'round');
        polyDanger.setAttribute('fill', '#f43f5e');
        polyDanger.setAttribute('stroke', '#f43f5e');
        markerDanger.appendChild(polyDanger);
        defs.appendChild(markerDanger);
        svg.appendChild(defs);

        connections.forEach(conn => {
            const metrics = getConnectionRenderMetrics(conn);
            if (!metrics) return;
            const isDep = normalizeConnectionType(conn.type) === 'dependency';
            const g = document.createElementNS(ns, 'g');
            const path = document.createElementNS(ns, 'path');
            const pathD = metrics.pathData || `M ${metrics.start.x} ${metrics.start.y} L ${metrics.end.x} ${metrics.end.y}`;
            path.setAttribute('d', pathD);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', isDep ? '#f43f5e' : (isDarkTheme ? '#94a3b8' : '#64748b'));
            path.setAttribute('stroke-width', '2');
            if (isDep) path.setAttribute('stroke-dasharray', '10 7');
            path.setAttribute('marker-end', isDep ? 'url(#arrowhead-danger)' : 'url(#arrowhead)');
            g.appendChild(path);

            if (conn.label) {
                const text = document.createElementNS(ns, 'text');
                text.setAttribute('x', metrics.labelX);
                text.setAttribute('y', metrics.labelY);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('font-size', '12');
                text.setAttribute('font-weight', '700');
                text.setAttribute('font-family', 'system-ui, sans-serif');
                text.setAttribute('fill', isDarkTheme ? '#f1f5f9' : '#334155');
                text.textContent = conn.label;
                g.appendChild(text);
            }
            svg.appendChild(g);
        });

        allItems.forEach(item => {
            const g = document.createElementNS(ns, 'g');
            if (item.type === 'node') {
                const n = item.data;
                let shape;
                if (n.type === 'decision') {
                    const cx = n.x + item.w / 2;
                    const cy = n.y + item.h / 2;
                    shape = document.createElementNS(ns, 'polygon');
                    shape.setAttribute('points', `${cx},${n.y} ${n.x + item.w},${cy} ${cx},${n.y + item.h} ${n.x},${cy}`);
                } else if (n.type === 'database') {
                    const ry = Math.min(12, item.h * 0.18);
                    const rx = item.w / 2;
                    shape = document.createElementNS(ns, 'path');
                    const pathStr = `M ${n.x} ${n.y + ry} ` +
                        `A ${rx} ${ry} 0 0 1 ${n.x + item.w} ${n.y + ry} ` +
                        `L ${n.x + item.w} ${n.y + item.h - ry} ` +
                        `A ${rx} ${ry} 0 0 1 ${n.x} ${n.y + item.h - ry} Z`;
                    shape.setAttribute('d', pathStr);
                } else if (n.type === 'document') {
                    const waveH = Math.min(8, item.h * 0.12);
                    const bottomY = n.y + item.h - waveH;
                    const halfW = item.w / 2;
                    shape = document.createElementNS(ns, 'path');
                    const pathStr = `M ${n.x} ${n.y} ` +
                        `L ${n.x + item.w} ${n.y} ` +
                        `L ${n.x + item.w} ${bottomY} ` +
                        `Q ${n.x + item.w * 0.75} ${bottomY + waveH * 1.5} ${n.x + halfW} ${bottomY} ` +
                        `Q ${n.x + item.w * 0.25} ${bottomY - waveH * 1.5} ${n.x} ${bottomY} Z`;
                    shape.setAttribute('d', pathStr);
                } else if (n.type === 'note') {
                    const fold = 12;
                    shape = document.createElementNS(ns, 'polygon');
                    shape.setAttribute('points', `${n.x},${n.y} ${n.x + item.w - fold},${n.y} ${n.x + item.w},${n.y + fold} ${n.x + item.w},${n.y + item.h} ${n.x},${n.y + item.h}`);
                } else {
                    shape = document.createElementNS(ns, 'rect');
                    shape.setAttribute('x', n.x);
                    shape.setAttribute('y', n.y);
                    shape.setAttribute('width', item.w);
                    shape.setAttribute('height', item.h);
                    if (n.type === 'start') {
                        shape.setAttribute('rx', item.h / 2);
                        shape.setAttribute('ry', item.h / 2);
                    } else if (n.type === 'process' || n.type === 'group') {
                        shape.setAttribute('rx', '8');
                        shape.setAttribute('ry', '8');
                    }
                }

                if (n.type === 'group') {
                    shape.setAttribute('fill', isDarkTheme ? 'rgba(30, 41, 59, 0.4)' : 'rgba(239, 246, 255, 0.4)');
                    shape.setAttribute('stroke', isDarkTheme ? '#475569' : '#94a3b8');
                    shape.setAttribute('stroke-dasharray', '6 4');
                } else if (n.type === 'note') {
                    const noteDefaultFill = isDarkTheme ? '#422006' : '#fef9c3';
                    const noteDefaultStroke = isDarkTheme ? '#713f12' : '#fde047';
                    shape.setAttribute('fill', n.bgColor || noteDefaultFill);
                    shape.setAttribute('stroke', isDarkTheme ? '#713f12' : noteDefaultStroke);
                } else {
                    const defaultFill = isDarkTheme ? '#1e293b' : '#ffffff';
                    shape.setAttribute('fill', n.bgColor || defaultFill);
                    shape.setAttribute('stroke', isDarkTheme ? '#334155' : '#94a3b8');
                }
                shape.setAttribute('stroke-width', '2');
                g.appendChild(shape);

                if (n.type === 'database') {
                    const ry = Math.min(12, item.h * 0.18);
                    const rx = item.w / 2;
                    const topRim = document.createElementNS(ns, 'ellipse');
                    topRim.setAttribute('cx', n.x + rx);
                    topRim.setAttribute('cy', n.y + ry);
                    topRim.setAttribute('rx', rx);
                    topRim.setAttribute('ry', ry);
                    topRim.setAttribute('fill', n.bgColor || (isDarkTheme ? '#1e293b' : '#ffffff'));
                    topRim.setAttribute('stroke', isDarkTheme ? '#334155' : '#94a3b8');
                    topRim.setAttribute('stroke-width', '2');
                    g.appendChild(topRim);
                } else if (n.type === 'note') {
                    const fold = 12;
                    const flap = document.createElementNS(ns, 'polygon');
                    flap.setAttribute('points', `${n.x + item.w - fold},${n.y} ${n.x + item.w - fold},${n.y + fold} ${n.x + item.w},${n.y + fold}`);
                    flap.setAttribute('fill', isDarkTheme ? '#ca8a04' : '#fef08a');
                    flap.setAttribute('stroke', isDarkTheme ? '#713f12' : '#fde047');
                    flap.setAttribute('stroke-width', '1.5');
                    g.appendChild(flap);
                }

                const label = n.el.querySelector('.label');
                const textContent = label ? (label.innerText || label.textContent || '').trim() : '';
                if (textContent) {
                    const text = document.createElementNS(ns, 'text');
                    const isFloating = n.type === 'floatingText';
                    const defaultTextFill = isDarkTheme ? '#f8fafc' : '#0f172a';
                    text.setAttribute('fill', n.textColor || defaultTextFill);
                    text.setAttribute('font-size', '14');
                    text.setAttribute('font-weight', '600');
                    text.setAttribute('font-family', 'system-ui, sans-serif');

                    const lines = textContent.split(/\r?\n/).filter((l, idx, arr) => l.length > 0 || arr.length > 1);
                    const lineHeight = 18;
                    const totalTextH = lines.length * lineHeight;
                    const startY = (n.y + item.h / 2) - (totalTextH / 2) + 13;

                    if (lines.length <= 1) {
                        text.setAttribute('x', isFloating ? n.x + 4 : n.x + item.w / 2);
                        text.setAttribute('y', n.y + item.h / 2);
                        text.setAttribute('dominant-baseline', 'middle');
                        if (!isFloating) text.setAttribute('text-anchor', 'middle');
                        text.textContent = textContent;
                    } else {
                        lines.forEach((lineStr, lineIdx) => {
                            const tspan = document.createElementNS(ns, 'tspan');
                            tspan.setAttribute('x', isFloating ? n.x + 4 : n.x + item.w / 2);
                            tspan.setAttribute('y', startY + lineIdx * lineHeight);
                            if (!isFloating) tspan.setAttribute('text-anchor', 'middle');
                            tspan.textContent = lineStr;
                            text.appendChild(tspan);
                        });
                    }
                    g.appendChild(text);
                }

                if (typeof getNodeMetadataEntries === 'function') {
                    const metaEntries = getNodeMetadataEntries(n);
                    if (metaEntries.length > 0) {
                        const metaText = metaEntries.map(e => `${e.label}: ${e.value}`).join(' • ');
                        const metaSvg = document.createElementNS(ns, 'text');
                        metaSvg.setAttribute('x', n.x + item.w / 2);
                        metaSvg.setAttribute('y', n.y + item.h - 8);
                        metaSvg.setAttribute('text-anchor', 'middle');
                        metaSvg.setAttribute('font-size', '10');
                        metaSvg.setAttribute('font-weight', '600');
                        metaSvg.setAttribute('font-family', 'system-ui, sans-serif');
                        metaSvg.setAttribute('fill', isDarkTheme ? '#94a3b8' : '#64748b');
                        metaSvg.textContent = metaText;
                        g.appendChild(metaSvg);
                    }
                }
            } else if (item.type === 'table') {
                const t = item.data;
                const rect = document.createElementNS(ns, 'rect');
                rect.setAttribute('x', t.x);
                rect.setAttribute('y', t.y);
                rect.setAttribute('width', item.w);
                rect.setAttribute('height', item.h);
                rect.setAttribute('fill', t.bgColor || (isDarkTheme ? '#1e293b' : '#ffffff'));
                rect.setAttribute('stroke', isDarkTheme ? '#334155' : '#94a3b8');
                rect.setAttribute('stroke-width', '2');
                rect.setAttribute('rx', '8');
                g.appendChild(rect);
                appendExportTableCells(svg, t.el, t.x, t.y, zoom);
            }
            svg.appendChild(g);
        });

        return { svg, width, height };
    }

    function renderGraphToPNGBlob(callback) {
        const built = buildExportSVG();
        if (!built) {
            if (typeof callback === 'function') callback(null);
            return;
        }

        const isDarkTheme = document.body.classList.contains('theme-dark');
        const svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(built.svg);
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
            const scale = 2;
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(built.width * scale));
            canvas.height = Math.max(1, Math.round(built.height * scale));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = isDarkTheme ? '#090d16' : '#f8fafc';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob((pngBlob) => {
                if (typeof callback === 'function') callback(pngBlob);
            }, 'image/png');
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            if (typeof callback === 'function') callback(null);
        };
        image.src = url;
    }

    function exportPNG() {
        hideSaveMenu();
        hideAlignMenu();
        clearSelection();
        renderGraphToPNGBlob((pngBlob) => {
            if (!pngBlob) {
                showToast('PNG export failed.', 'error');
                return;
            }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(pngBlob);
            a.download = 'chart.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showToast('Exported chart.png', 'success', 2500);
        });
    }

    function appendExportTableCells(svg, tableEl, tableX, tableY, currentZoom) {
        const ns = 'http://www.w3.org/2000/svg';
        if (!tableEl || !tableEl.isConnected) return;
        const safeZoom = Number.isFinite(currentZoom) && currentZoom > 0 ? currentZoom : 1;
        const tableRect = tableEl.getBoundingClientRect();
        tableEl.querySelectorAll('table tr').forEach((rowEl) => {
            Array.from(rowEl.children).filter(cell => cell.matches('th, td')).forEach((cellEl) => {
                const cellRect = cellEl.getBoundingClientRect();
                const x = tableX + (cellRect.left - tableRect.left) / safeZoom;
                const y = tableY + (cellRect.top - tableRect.top) / safeZoom;
                const width = cellRect.width / safeZoom;
                const height = cellRect.height / safeZoom;
                if (!width || !height) return;

                const bgColor = sanitizeCSSColor(cellEl.getAttribute('data-cell-bg-color') || '');
                const textColor = sanitizeCSSColor(cellEl.getAttribute('data-cell-text-color') || '');
                const resolvedBg = bgColor || (cellEl.matches('th') ? '#f1f5f9' : '');
                const resolvedText = textColor || '#0f172a';

                if (resolvedBg) {
                    const cellRectEl = document.createElementNS(ns, 'rect');
                    cellRectEl.setAttribute('x', x);
                    cellRectEl.setAttribute('y', y);
                    cellRectEl.setAttribute('width', width);
                    cellRectEl.setAttribute('height', height);
                    cellRectEl.setAttribute('fill', resolvedBg);
                    svg.appendChild(cellRectEl);
                }

                const cellText = (cellEl.innerText || cellEl.textContent || '').trim();
                if (!cellText) return;

                const maxChars = Math.max(1, Math.floor((width - 10) / 6.2));
                const displayText = cellText.length > maxChars
                    ? `${cellText.slice(0, Math.max(1, maxChars - 1))}…`
                    : cellText;

                const text = document.createElementNS(ns, 'text');
                text.setAttribute('x', x + 5);
                text.setAttribute('y', y + (height / 2));
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('font-size', '11');
                text.setAttribute('font-family', 'system-ui, sans-serif');
                text.setAttribute('fill', resolvedText);
                text.textContent = displayText;
                svg.appendChild(text);
            });
        });
    }

    var THEME_STORAGE_KEY = 'noodle-theme';
    var currentThemeMode = 'auto';

    function getSavedTheme() {
        try {
            return window.localStorage?.getItem(THEME_STORAGE_KEY) || 'auto';
        } catch (e) {
            return 'auto';
        }
    }

    function applyTheme(mode) {
        currentThemeMode = mode;
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const effectiveDark = mode === 'dark' || (mode === 'auto' && prefersDark);
        document.body.classList.toggle('theme-dark', effectiveDark);
        invalidateGridColor();
        if (typeof invalidateMinimapTheme === 'function') invalidateMinimapTheme();
        updateThemeUI();
        try {
            window.localStorage?.setItem(THEME_STORAGE_KEY, mode);
        } catch (e) {}
    }

    function toggleTheme() {
        const nextMode = currentThemeMode === 'auto' ? 'dark' : currentThemeMode === 'dark' ? 'light' : 'auto';
        applyTheme(nextMode);
        if (typeof showToast === 'function') {
            showToast(`Theme: ${nextMode.charAt(0).toUpperCase() + nextMode.slice(1)}`, 'info', 2000);
        }
    }

    function updateThemeUI() {
        const btn = document.getElementById('themeToggleBtn');
        if (!btn) return;
        const isDark = document.body.classList.contains('theme-dark');
        btn.title = `Theme: ${currentThemeMode} (click to toggle)`;
        btn.setAttribute('aria-label', `Toggle Theme (current: ${currentThemeMode})`);
        const icon = btn.querySelector('svg');
        if (icon) {
            if (isDark) {
                icon.innerHTML = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>';
            } else {
                icon.innerHTML = '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>';
            }
        }
    }

