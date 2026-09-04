// Share diagrams via URL: the entire diagram payload is encoded into the
// location hash (`#d=...`), so opening the link restores the exact diagram.
// When the URL carries no shared payload, boot falls back to localStorage
// autosave as before. Zero runtime dependencies.

var SHARE_HASH_KEY = 'd';
var SHARE_PLAIN_PREFIX = '1.';
var SHARE_COMPRESSED_PREFIX = '2.';

// UTF-8 helpers with fallbacks: TextEncoder/Decoder exist in all browsers,
// Buffer covers Node-like runtimes, and the encodeURIComponent path works
// anywhere btoa/atob exist (found while testing: jsdom lacks TextEncoder).
function utf8Encode(text) {
    const str = String(text);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8');
    const bin = unescape(encodeURIComponent(str));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(bin));
}

function bytesToBase64Url(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    let b64;
    if (typeof btoa === 'function') {
        b64 = btoa(binary);
    } else {
        b64 = Buffer.from(binary, 'binary').toString('base64');
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url) {
    let b64 = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    let binary;
    if (typeof atob === 'function') {
        binary = atob(b64);
    } else {
        binary = Buffer.from(b64, 'base64').toString('binary');
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function base64UrlToText(b64url) {
    return utf8Decode(base64UrlToBytes(b64url));
}

async function streamToBytes(readable) {
    if (typeof Response !== 'undefined' && typeof ReadableStream !== 'undefined') {
        try {
            const buf = await new Response(readable).arrayBuffer();
            return new Uint8Array(buf);
        } catch (err) {}
    }
    const reader = readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

async function deflateRawBytes(bytes) {
    const input = new ReadableStream({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        }
    });
    return streamToBytes(input.pipeThrough(new CompressionStream('deflate-raw')));
}

async function inflateRawBytes(bytes) {
    const input = new ReadableStream({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        }
    });
    return streamToBytes(input.pipeThrough(new DecompressionStream('deflate-raw')));
}

// Encode JSON text to a compact URL-safe token. Prefers deflate-raw + base64url
// when available (and smaller), falls back to plain base64url of the JSON.
async function encodeSharePayloadText(jsonText) {
    const text = String(jsonText);
    if (typeof CompressionStream !== 'undefined' && typeof ReadableStream !== 'undefined') {
        try {
            const rawBytes = utf8Encode(text);
            const compressed = await deflateRawBytes(rawBytes);
            const compressedToken = SHARE_COMPRESSED_PREFIX + bytesToBase64Url(compressed);
            const plainToken = SHARE_PLAIN_PREFIX + bytesToBase64Url(rawBytes);
            return compressedToken.length <= plainToken.length ? compressedToken : plainToken;
        } catch (err) {}
    }
    return SHARE_PLAIN_PREFIX + bytesToBase64Url(utf8Encode(text));
}

async function decodeSharePayloadText(token) {
    // Strip whitespace: chat apps and email clients often wrap very long URLs
    // with line breaks, which would otherwise corrupt the token.
    const raw = String(token || '').replace(/\s+/g, '');
    if (!raw) throw new Error('Empty share payload.');
    if (raw.startsWith(SHARE_COMPRESSED_PREFIX)) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('Compressed share link needs a browser with DecompressionStream support.');
        }
        return utf8Decode(await inflateRawBytes(base64UrlToBytes(raw.slice(SHARE_COMPRESSED_PREFIX.length))));
    }
    if (raw.startsWith(SHARE_PLAIN_PREFIX)) {
        return base64UrlToText(raw.slice(SHARE_PLAIN_PREFIX.length));
    }
    // Back-compat: raw base64url JSON without a version prefix.
    return base64UrlToText(raw);
}

// ===== Compact share schema (v2) =====
// The verbose export payload repeats key names and default values on every
// item (e.g. "bgColor":"#ffffff"). The compact form stores items as positional
// arrays with single-letter type codes and drops anything equal to the
// default, which compresses significantly better. v1 links keep decoding.

var SHARE_NODE_TYPES_ENCODE = {
    start: 's',
    process: 'p',
    decision: 'd',
    group: 'g',
    floatingText: 'f',
    table: 't'
};

var SHARE_NODE_TYPES_DECODE = {
    s: 'start',
    p: 'process',
    d: 'decision',
    g: 'group',
    f: 'floatingText',
    t: 'table'
};

var SHARE_DEFAULT_BG = '#ffffff';
var SHARE_DEFAULT_FG = '#0f172a';

function shareNum(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.round(num) : fallback;
}

function shareTrimmed(arr) {
    while (arr.length && (arr[arr.length - 1] == null || arr[arr.length - 1] === '')) arr.pop();
    return arr;
}

function compactShareNode(n) {
    if (!n || typeof n.id === 'undefined') return null;
    const content = n.html ? String(n.html) : String(n.text || '');
    const arr = [
        String(n.id),
        SHARE_NODE_TYPES_ENCODE[n.type] || String(n.type || 'process'),
        shareNum(n.x, 0),
        shareNum(n.y, 0),
        content || null,
        n.html ? 1 : null,
        n.bgColor && n.bgColor !== SHARE_DEFAULT_BG ? String(n.bgColor) : null,
        n.textColor && n.textColor !== SHARE_DEFAULT_FG ? String(n.textColor) : null,
        n.width != null ? shareNum(n.width, null) : null,
        n.height != null ? shareNum(n.height, null) : null,
        n.parentGroupId ? String(n.parentGroupId) : null,
        n.metadata && typeof n.metadata === 'object' ? n.metadata : null
    ];
    return shareTrimmed(arr);
}

function compactShareConnection(c) {
    if (!c || typeof c.from === 'undefined' || typeof c.to === 'undefined') return null;
    const type = c.type === 'dependency' ? 'd' : null;
    const style = c.style === 'curved' ? 'c' : (c.style === 'orthogonal' ? 'o' : null);
    const label = c.label ? String(c.label) : null;
    return shareTrimmed([String(c.from), String(c.to), type, style, label]);
}

function compactShareTable(t) {
    if (!t || typeof t.id === 'undefined') return null;
    const filters = Array.isArray(t.filters) ? t.filters : [];
    const arr = [
        String(t.id),
        shareNum(t.x, 0),
        shareNum(t.y, 0),
        t.html ? String(t.html) : null,
        t.bgColor && t.bgColor !== SHARE_DEFAULT_BG ? String(t.bgColor) : null,
        t.textColor && t.textColor !== SHARE_DEFAULT_FG ? String(t.textColor) : null,
        t.filtersEnabled ? 1 : null,
        filters.length ? filters : null,
        t.sortState && typeof t.sortState === 'object' ? t.sortState : null
    ];
    return shareTrimmed(arr);
}

// data is a getGraphExportPayload()-shaped object; returns the compact form.
function compactGraphForShare(data) {
    const compact = {
        n: (Array.isArray(data.nodes) ? data.nodes : []).map(compactShareNode).filter(Boolean),
        l: (Array.isArray(data.connections) ? data.connections : []).map(compactShareConnection).filter(Boolean)
    };
    const tables = (Array.isArray(data.tables) ? data.tables : []).map(compactShareTable).filter(Boolean);
    if (tables.length) compact.b = tables;
    if (data.camera && (data.camera.panX || data.camera.panY || data.camera.zoom !== 1)) {
        compact.cam = [shareNum(data.camera.panX, 0), shareNum(data.camera.panY, 0), Number(data.camera.zoom) || 1];
    }
    const cs = (Array.isArray(data.collapsedSequenceNodes) ? data.collapsedSequenceNodes : []).filter(id => typeof id === 'string');
    const cd = (Array.isArray(data.collapsedDependencyNodes) ? data.collapsedDependencyNodes : []).filter(id => typeof id === 'string');
    if (cs.length) compact.cs = cs;
    if (cd.length) compact.cd = cd;
    return compact;
}

function expandShareNode(a) {
    if (!Array.isArray(a) || a[0] == null || a[0] === '') return null;
    const code = a[1];
    const type = SHARE_NODE_TYPES_DECODE[code] || (typeof code === 'string' && code ? code : 'process');
    const node = {
        id: String(a[0]),
        type,
        x: shareNum(a[2], 0),
        y: shareNum(a[3], 0)
    };
    const content = a[4] == null ? '' : String(a[4]);
    if (a[5] === 1) node.html = content;
    else node.text = content;
    if (a[6]) node.bgColor = String(a[6]);
    if (a[7]) node.textColor = String(a[7]);
    if (a[8] != null) node.width = shareNum(a[8], null);
    if (a[9] != null) node.height = shareNum(a[9], null);
    if (a[10]) node.parentGroupId = String(a[10]);
    if (a[11] && typeof a[11] === 'object') node.metadata = a[11];
    return node;
}

function expandShareConnection(a) {
    if (!Array.isArray(a) || a[0] == null || a[0] === '' || a[1] == null || a[1] === '') return null;
    return {
        from: String(a[0]),
        to: String(a[1]),
        type: a[2] === 'd' ? 'dependency' : 'sequence',
        style: a[3] === 'c' ? 'curved' : (a[3] === 'o' ? 'orthogonal' : 'straight'),
        label: a[4] == null ? '' : String(a[4])
    };
}

function expandShareTable(a) {
    if (!Array.isArray(a) || a[0] == null || a[0] === '') return null;
    const table = {
        id: String(a[0]),
        x: shareNum(a[1], 0),
        y: shareNum(a[2], 0),
        html: a[3] == null ? '' : String(a[3])
    };
    if (a[4]) table.bgColor = String(a[4]);
    if (a[5]) table.textColor = String(a[5]);
    if (a[6] === 1) table.filtersEnabled = true;
    if (Array.isArray(a[7])) table.filters = a[7];
    if (a[8] && typeof a[8] === 'object') table.sortState = a[8];
    return table;
}

// Expands a compact v2 payload back to the verbose export shape.
// Returns null when the payload is malformed.
function expandCompactGraph(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.n) || !Array.isArray(d.l)) return null;
    const nodes = d.n.map(expandShareNode).filter(Boolean);
    const connections = d.l.map(expandShareConnection).filter(Boolean);
    if ((d.n.length > 0 && nodes.length === 0) || (d.l.length > 0 && connections.length === 0)) return null;
    const data = { nodes, connections };
    if (Array.isArray(d.b)) {
        const tables = d.b.map(expandShareTable).filter(Boolean);
        if (d.b.length > 0 && tables.length === 0) return null;
        data.tables = tables;
    }
    if (Array.isArray(d.cam) && d.cam.length === 3
        && Number.isFinite(Number(d.cam[0])) && Number.isFinite(Number(d.cam[1]))
        && Number.isFinite(Number(d.cam[2])) && Number(d.cam[2]) > 0) {
        data.camera = { panX: Number(d.cam[0]), panY: Number(d.cam[1]), zoom: Number(d.cam[2]) };
    }
    if (Array.isArray(d.cs)) data.collapsedSequenceNodes = d.cs.filter(id => typeof id === 'string');
    if (Array.isArray(d.cd)) data.collapsedDependencyNodes = d.cd.filter(id => typeof id === 'string');
    return data;
}

// Accepts both the v2 compact wrapper { v:2, t, d } and the legacy v1/verbose
// forms ({ v:1, title, data } or a raw graph payload). Returns
// { title, data } or null when there is no usable diagram.
function parseShareWrapper(wrapper) {
    if (!wrapper || typeof wrapper !== 'object') return null;
    if (wrapper.v === 2 && wrapper.d) {
        const data = expandCompactGraph(wrapper.d);
        if (!data) return null;
        return { title: typeof wrapper.t === 'string' ? wrapper.t : '', data };
    }
    const data = wrapper.data ? wrapper.data : wrapper;
    const title = typeof wrapper.title === 'string' ? wrapper.title : '';
    if (!isValidShareGraphData(data)) return null;
    return { title, data };
}

// Read the encoded share token from `#d=...` (primary) or `?d=...` (fallback).
function getShareEncodedFromUrl() {
    try {
        const loc = typeof window !== 'undefined' ? window.location : null;
        if (!loc) return '';
        const hash = loc.hash || '';
        if (hash.startsWith('#' + SHARE_HASH_KEY + '=')) return hash.slice(3);
        if (hash.length > 1) {
            try {
                const fromHash = new URLSearchParams(hash.slice(1)).get(SHARE_HASH_KEY);
                if (fromHash) return fromHash;
            } catch (err) {}
        }
        if (loc.search) {
            try {
                const fromQuery = new URLSearchParams(loc.search).get(SHARE_HASH_KEY);
                if (fromQuery) return fromQuery;
            } catch (err) {}
        }
    } catch (err) {}
    return '';
}

function buildShareUrl(encodedToken) {
    const href = String(window.location.href);
    const base = href.split('#')[0].split('?')[0];
    return base + '#' + SHARE_HASH_KEY + '=' + encodedToken;
}

function clearShareTokenFromUrl() {
    try {
        const loc = window.location;
        const clean = loc.pathname + (loc.search || '');
        window.history?.replaceState(null, '', clean);
    } catch (err) {}
}

function isValidShareGraphData(data) {
    return Boolean(data && Array.isArray(data.nodes) && Array.isArray(data.connections));
}

// Build a shareable URL for the current diagram, update the address bar so the
// URL itself is shareable, and copy it to the clipboard. Returns the URL.
async function copyShareLinkToClipboard() {
    if (typeof hideSaveMenu === 'function') hideSaveMenu();
    if (typeof hideAlignMenu === 'function') hideAlignMenu();
    try {
        if (typeof getGraphExportPayload !== 'function') throw new Error('Export unavailable.');
        const title = typeof activeDocumentTitle === 'string' ? activeDocumentTitle : '';
        const wrapper = { v: 2, d: compactGraphForShare(getGraphExportPayload()) };
        if (title.trim()) wrapper.t = title.trim().slice(0, 120);
        const encoded = await encodeSharePayloadText(JSON.stringify(wrapper));
        const url = buildShareUrl(encoded);
        try {
            window.history?.replaceState(null, '', url);
        } catch (err) {}
        let copied = false;
        try {
            await writeTextToClipboard(url);
            copied = true;
        } catch (err) {}
        const kb = (url.length / 1024).toFixed(1);
        const sizeNote = `(${kb} KB)`;
        if (copied) {
            if (url.length > 100000) {
                showToast(`Share link copied ${sizeNote} — very long links may fail in some browsers.`, 'warning', 5000);
            } else {
                showToast(`Share link copied ${sizeNote} — opening it loads this diagram.`, 'success', 4000);
            }
        } else if (typeof showModalPrompt === 'function') {
            // Clipboard API unavailable (permissions, insecure context): let the
            // user copy the link manually. It is also in the address bar.
            await showModalPrompt({ title: `Copy your share link ${sizeNote}`, defaultValue: url, confirmLabel: 'Done' });
        } else {
            showToast(`Sharing ready ${sizeNote} — copy the link from the address bar.`, 'info', 6000);
        }
        return url;
    } catch (err) {
        showToast('Unable to create a share link.', 'error');
        return null;
    }
}

// If the URL carries a shared diagram, restore it (resetting undo history so
// the shared state becomes the baseline) and strip the token from the address
// bar so later reloads fall back to the local autosave copy. Returns true when
// a shared diagram was loaded, false when the URL carries nothing shareable.
async function loadSharedGraphFromUrl(options = {}) {
    const encoded = typeof getShareEncodedFromUrl === 'function' ? getShareEncodedFromUrl() : '';
    if (!encoded) return false;
    const stripHash = options.stripHash !== false;
    let jsonText;
    try {
        jsonText = await decodeSharePayloadText(encoded);
    } catch (err) {
        if (stripHash) clearShareTokenFromUrl();
        showToast('This share link is invalid or unsupported here. Loaded your saved diagram instead.', 'error', 5000);
        return false;
    }
    let wrapper;
    try {
        wrapper = JSON.parse(jsonText);
    } catch (err) {
        wrapper = null;
    }
    // Accept the v2 compact wrapper, the legacy v1 wrapper, and raw payloads.
    const parsed = typeof parseShareWrapper === 'function' ? parseShareWrapper(wrapper) : null;
    if (!parsed) {
        if (stripHash) clearShareTokenFromUrl();
        showToast('This share link has no diagram data. Loaded your saved diagram instead.', 'error', 5000);
        return false;
    }
    const data = parsed.data;
    const title = parsed.title;
    const cleanTitle = String(title || '').trim().slice(0, 120);
    if (cleanTitle && typeof updateDocHeaderUI === 'function') {
        try {
            activeDocumentTitle = cleanTitle;
            updateDocHeaderUI();
        } catch (err) {}
    }
    if (typeof restoreGraphPayload !== 'function') return false;
    restoreGraphPayload(data, true);
    if (stripHash) clearShareTokenFromUrl();
    showToast('Loaded the shared diagram from the link.', 'success', 4000);
    return true;
}
