// Share diagrams via URL: the entire diagram payload is encoded into the
// location hash (`#d=...`), so opening the link restores the exact diagram.
// When the URL carries no shared payload, boot falls back to localStorage
// autosave as before. Zero runtime dependencies.

var SHARE_HASH_KEY = 'd';
var SHARE_PAYLOAD_VERSION = 1;
var SHARE_PLAIN_PREFIX = '1.';
var SHARE_COMPRESSED_PREFIX = '2.';

function shareTextEncode(text) {
    return new TextEncoder().encode(String(text));
}

function shareTextDecode(bytes) {
    return new TextDecoder().decode(bytes);
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
    return shareTextDecode(base64UrlToBytes(b64url));
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
            const rawBytes = shareTextEncode(text);
            const compressed = await deflateRawBytes(rawBytes);
            const compressedToken = SHARE_COMPRESSED_PREFIX + bytesToBase64Url(compressed);
            const plainToken = SHARE_PLAIN_PREFIX + bytesToBase64Url(rawBytes);
            return compressedToken.length <= plainToken.length ? compressedToken : plainToken;
        } catch (err) {}
    }
    return SHARE_PLAIN_PREFIX + bytesToBase64Url(shareTextEncode(text));
}

async function decodeSharePayloadText(token) {
    const raw = String(token || '').trim();
    if (!raw) throw new Error('Empty share payload.');
    if (raw.startsWith(SHARE_COMPRESSED_PREFIX)) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('Compressed share link needs a browser with DecompressionStream support.');
        }
        return shareTextDecode(await inflateRawBytes(base64UrlToBytes(raw.slice(SHARE_COMPRESSED_PREFIX.length))));
    }
    if (raw.startsWith(SHARE_PLAIN_PREFIX)) {
        return base64UrlToText(raw.slice(SHARE_PLAIN_PREFIX.length));
    }
    // Back-compat: raw base64url JSON without a version prefix.
    return base64UrlToText(raw);
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
        const wrapper = {
            v: SHARE_PAYLOAD_VERSION,
            title: typeof activeDocumentTitle === 'string' ? activeDocumentTitle : '',
            data: getGraphExportPayload()
        };
        const encoded = await encodeSharePayloadText(JSON.stringify(wrapper));
        const url = buildShareUrl(encoded);
        try {
            window.history?.replaceState(null, '', url);
        } catch (err) {}
        await writeTextToClipboard(url);
        const kb = (url.length / 1024).toFixed(1);
        if (url.length > 100000) {
            showToast(`Share link copied (${kb} KB) — very long links may fail in some browsers.`, 'warning', 5000);
        } else {
            showToast(`Share link copied (${kb} KB) — opening it loads this diagram.`, 'success', 4000);
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
    // Accept both the wrapped form { v, title, data } and a raw graph payload.
    const data = wrapper && wrapper.data ? wrapper.data : wrapper;
    const title = wrapper && typeof wrapper.title === 'string' ? wrapper.title.trim().slice(0, 120) : '';
    if (!isValidShareGraphData(data)) {
        if (stripHash) clearShareTokenFromUrl();
        showToast('This share link has no diagram data. Loaded your saved diagram instead.', 'error', 5000);
        return false;
    }
    if (title && typeof updateDocHeaderUI === 'function') {
        try {
            activeDocumentTitle = title;
            updateDocHeaderUI();
        } catch (err) {}
    }
    if (typeof restoreGraphPayload !== 'function') return false;
    restoreGraphPayload(data, true);
    if (stripHash) clearShareTokenFromUrl();
    showToast('Loaded the shared diagram from the link.', 'success', 4000);
    return true;
}
