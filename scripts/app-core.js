// Shared DOM refs, app state, and history helpers.

var viewport = document.getElementById('canvas-viewport');
var content = document.getElementById('canvas-content');
var bgGrid = document.getElementById('bg-grid');
var svgLayer = document.getElementById('svg-layer');
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
    group: 'Group'
};
var DEFAULT_CONNECTION_TYPE = 'sequence';
DEFAULT_NODE_LABELS.floatingText = 'Text';
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
var autosaveTimer = null;

var panX = 0;
var panY = 0;
var zoom = 1;
var activePointers = new Map();
var currentMode = 'IDLE';
var startPoint = { x: 0, y: 0 };
var lastPoint = { x: 0, y: 0 };
var isDragging = false;
var hasPanned = false;
var pendingNodeEditId = null;
var pendingTableEditContext = null;

    function updateTransform() {
        const transformStr = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        content.style.transform = transformStr;
        bgGrid.style.transform = transformStr;
        const zoomLabel = document.getElementById('zoomLevelBtn');
        if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
        scheduleAutosave();
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

    function initializeToolbarButtons() {
        const zoomOutBtn = document.querySelector('[data-action="zoom-out"]');
        const zoomInBtn = document.querySelector('[data-action="zoom-in"]');

        if (zoomOutBtn) {
            zoomOutBtn.setAttribute('aria-label', 'Zoom Out');
            zoomOutBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" x2="16.65" y1="21" y2="16.65"></line><line x1="8" x2="14" y1="11" y2="11"></line></svg>';
        }

        if (zoomInBtn) {
            zoomInBtn.setAttribute('aria-label', 'Zoom In');
            zoomInBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" x2="16.65" y1="21" y2="16.65"></line><line x1="11" x2="11" y1="8" y2="14"></line><line x1="8" x2="14" y1="11" y2="11"></line></svg>';
        }
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

    function isResizableNodeType(type = '') {
        return type === 'group';
    }

    function sanitizeNodeDimension(value, fallback = null) {
        if (value === null || value === undefined || value === '') return fallback;
        const parsedValue = Math.round(Number(value));
        return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
    }

    function getDefaultNodeSize(type = '') {
        return isResizableNodeType(type) ? { ...GROUP_NODE_DEFAULT_SIZE } : { width: null, height: null };
    }

    function normalizeNodeSize(type = '', width = null, height = null) {
        if (!isResizableNodeType(type)) return { width: null, height: null };
        const defaultSize = getDefaultNodeSize(type);
        return {
            width: Math.max(GROUP_NODE_MIN_SIZE.width, sanitizeNodeDimension(width, defaultSize.width)),
            height: Math.max(GROUP_NODE_MIN_SIZE.height, sanitizeNodeDimension(height, defaultSize.height))
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

    function normalizeConnectionLabel(label = '') {
        return String(label ?? '');
    }

    function normalizeConnection(connection = {}) {
        return {
            from: connection.from,
            to: connection.to,
            type: normalizeConnectionType(connection.type),
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
            camera: { panX, panY, zoom }
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
        try {
            window.localStorage?.setItem(AUTO_SAVE_STORAGE_KEY, JSON.stringify(getGraphExportPayload()));
            setAutosaveStatus('Saved');
        } catch (err) {
            const quotaExceeded = err?.name === 'QuotaExceededError'
                || err?.code === 22
                || err?.code === 1014
                || /quota/i.test(String(err?.message || err?.name || ''));
            if (quotaExceeded && !autosaveQuotaWarningShown) {
                autosaveQuotaWarningShown = true;
                showToast('Autosave failed: browser storage is full. Save your work as a JSON file to avoid losing data.', 'warning', 8000);
            }
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

    function restoreGraphPayload(payload, resetHistory = false) {
        const normalizedPayload = normalizePersistedGraphPositions(payload);
        if (normalizedPayload.camera) {
            panX = normalizedPayload.camera.panX || 0;
            panY = normalizedPayload.camera.panY || 0;
            zoom = normalizedPayload.camera.zoom || 1;
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
        bgRect.setAttribute('fill', '#f8fafc');
        svg.appendChild(bgRect);

        const defs = document.createElementNS(ns, 'defs');
        const marker = document.createElementNS(ns, 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '3.5');
        marker.setAttribute('orient', 'auto');
        const poly = document.createElementNS(ns, 'polygon');
        poly.setAttribute('points', '0 0, 10 3.5, 0 7');
        poly.setAttribute('fill', '#64748b');
        marker.appendChild(poly);
        defs.appendChild(marker);
        svg.appendChild(defs);

        connections.forEach(conn => {
            const metrics = getConnectionRenderMetrics(conn);
            if (!metrics) return;
            const g = document.createElementNS(ns, 'g');
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', metrics.start.x);
            line.setAttribute('y1', metrics.start.y);
            line.setAttribute('x2', metrics.end.x);
            line.setAttribute('y2', metrics.end.y);
            line.setAttribute('stroke', normalizeConnectionType(conn.type) === 'dependency' ? '#f43f5e' : '#64748b');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('marker-end', 'url(#arrowhead)');
            g.appendChild(line);

            if (conn.label) {
                const text = document.createElementNS(ns, 'text');
                text.setAttribute('x', metrics.labelX);
                text.setAttribute('y', metrics.labelY);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('font-size', '12');
                text.setAttribute('font-family', 'system-ui, sans-serif');
                text.setAttribute('fill', '#0f172a');
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
                shape.setAttribute('fill', n.bgColor || '#ffffff');
                shape.setAttribute('stroke', '#94a3b8');
                shape.setAttribute('stroke-width', '2');
                g.appendChild(shape);

                const label = n.el.querySelector('.label');
                const textContent = label ? (label.innerText || label.textContent || '').trim() : '';
                if (textContent && n.type !== 'floatingText') {
                    const text = document.createElementNS(ns, 'text');
                    text.setAttribute('x', n.x + item.w / 2);
                    text.setAttribute('y', n.y + item.h / 2);
                    text.setAttribute('text-anchor', 'middle');
                    text.setAttribute('dominant-baseline', 'middle');
                    text.setAttribute('font-size', '14');
                    text.setAttribute('font-weight', '600');
                    text.setAttribute('font-family', 'system-ui, sans-serif');
                    text.setAttribute('fill', n.textColor || '#0f172a');
                    text.textContent = textContent;
                    g.appendChild(text);
                } else if (n.type === 'floatingText' && textContent) {
                    const text = document.createElementNS(ns, 'text');
                    text.setAttribute('x', n.x + 4);
                    text.setAttribute('y', n.y + item.h / 2);
                    text.setAttribute('dominant-baseline', 'middle');
                    text.setAttribute('font-size', '14');
                    text.setAttribute('font-weight', '600');
                    text.setAttribute('font-family', 'system-ui, sans-serif');
                    text.setAttribute('fill', n.textColor || '#0f172a');
                    text.textContent = textContent;
                    g.appendChild(text);
                }
            } else if (item.type === 'table') {
                const t = item.data;
                const rect = document.createElementNS(ns, 'rect');
                rect.setAttribute('x', t.x);
                rect.setAttribute('y', t.y);
                rect.setAttribute('width', item.w);
                rect.setAttribute('height', item.h);
                rect.setAttribute('fill', t.bgColor || '#ffffff');
                rect.setAttribute('stroke', '#94a3b8');
                rect.setAttribute('stroke-width', '2');
                rect.setAttribute('rx', '8');
                g.appendChild(rect);
                appendExportTableCells(svg, t.el, t.x, t.y, zoom);
            }
            svg.appendChild(g);
        });

        return { svg, width, height };
    }

    function exportPNG() {
        hideSaveMenu();
        hideAlignMenu();
        clearSelection();
        const built = buildExportSVG();
        if (!built) return;

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
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob((pngBlob) => {
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
            }, 'image/png');
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            showToast('PNG export failed.', 'error');
        };
        image.src = url;
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
