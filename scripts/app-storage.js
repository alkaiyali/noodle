// IndexedDB storage layer and multi-document manager for Noodle.
// Provides non-destructive diagram switching, naming, cloning, and autosave.

var DB_NAME = 'noodle-diagrams-db';
var DB_VERSION = 1;
var STORE_NAME = 'diagrams';
var ACTIVE_DOC_KEY = 'noodle-active-doc-id';

var activeDocumentId = 'default';
var activeDocumentTitle = 'My Diagram';
var dbInstance = null;

// All IndexedDB writes funnel through this chain so overlapping autosaves can
// never complete out of order (last call always wins).
var storageWriteQueue = Promise.resolve();

function queueStorageWrite(task) {
    storageWriteQueue = storageWriteQueue.then(task, task);
    return storageWriteQueue;
}

// ===== Cross-tab coordination =====
// BroadcastChannel tells the other tabs when this one saves the active diagram.
// Two tabs editing the same document would otherwise silently overwrite each
// other; we warn on the receiving side instead of merging.
var STORAGE_SYNC_CHANNEL_NAME = 'noodle-storage-sync';
var storageSyncChannel = null;
var lastForeignSaveWarningAt = 0;
var TAB_ID = 'tab_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

function initStorageSync() {
    if (storageSyncChannel || typeof BroadcastChannel === 'undefined') return;
    try {
        storageSyncChannel = new BroadcastChannel(STORAGE_SYNC_CHANNEL_NAME);
    } catch (err) {
        storageSyncChannel = null;
        return;
    }
    storageSyncChannel.addEventListener('message', (event) => {
        const message = event.data || {};
        if (message.tabId === TAB_ID || message.type !== 'doc-saved') return;
        if (message.docId !== activeDocumentId) return;
        const now = Date.now();
        if (now - lastForeignSaveWarningAt < 30000) return;
        lastForeignSaveWarningAt = now;
        if (typeof showToast === 'function') {
            showToast('Another tab is editing this diagram. Edits may overwrite each other — use one tab per diagram.', 'warning', 7000);
        }
    });
}

function notifyStorageSyncSaved(docId) {
    if (!storageSyncChannel) return;
    try {
        storageSyncChannel.postMessage({ type: 'doc-saved', docId, tabId: TAB_ID, at: Date.now() });
    } catch (err) {}
}

function openDiagramsDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve) => {
        if (!window.indexedDB) {
            resolve(null);
            return;
        }
        try {
            const req = window.indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            req.onsuccess = (e) => {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };
            req.onerror = () => resolve(null);
        } catch (err) {
            resolve(null);
        }
    });
}

async function initDocumentStorage() {
    initStorageSync();
    const savedActiveId = window.localStorage?.getItem(ACTIVE_DOC_KEY);
    if (savedActiveId) activeDocumentId = savedActiveId;

    const db = await openDiagramsDB();
    if (!db) {
        updateDocHeaderUI();
        return;
    }

    // Check if diagrams exist
    const allDocs = await getAllDiagramsFromDB();
    if (allDocs.length === 0) {
        // Migrate from localStorage 'graph-autosave-v1' if present
        let starterData = null;
        try {
            const raw = window.localStorage?.getItem('graph-autosave-v1');
            if (raw) starterData = JSON.parse(raw);
        } catch (e) {}

        const initialDoc = {
            id: 'default',
            title: 'My Diagram',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            nodeCount: starterData?.nodes ? Object.keys(starterData.nodes).length : 2,
            data: starterData || null
        };
        await putDiagramInDB(initialDoc);
        activeDocumentId = 'default';
        activeDocumentTitle = initialDoc.title;
    } else {
        const found = allDocs.find(d => d.id === activeDocumentId) || allDocs[0];
        activeDocumentId = found.id;
        activeDocumentTitle = found.title || 'Untitled Diagram';
    }

    updateDocHeaderUI();
}

var memoryFallbackDiagrams = {
    'default': {
        id: 'default',
        title: 'My Diagram',
        updatedAt: Date.now()
    }
};

function putDiagramInDB(doc) {
    if (doc && doc.id) {
        memoryFallbackDiagrams[doc.id] = { ...doc };
    }
    return new Promise((resolve) => {
        if (!dbInstance) {
            resolve(true);
            return;
        }
        try {
            const tx = dbInstance.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(doc);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

function getDiagramFromDB(id) {
    return new Promise((resolve) => {
        if (!dbInstance) {
            resolve(memoryFallbackDiagrams[id] || null);
            return;
        }
        try {
            const tx = dbInstance.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result || memoryFallbackDiagrams[id] || null);
            req.onerror = () => resolve(memoryFallbackDiagrams[id] || null);
        } catch (e) {
            resolve(memoryFallbackDiagrams[id] || null);
        }
    });
}

function getAllDiagramsFromDB() {
    return new Promise((resolve) => {
        if (!dbInstance) {
            resolve(Object.values(memoryFallbackDiagrams));
            return;
        }
        try {
            const tx = dbInstance.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => {
                const results = req.result || [];
                resolve(results.length > 0 ? results : Object.values(memoryFallbackDiagrams));
            };
            req.onerror = () => resolve(Object.values(memoryFallbackDiagrams));
        } catch (e) {
            resolve(Object.values(memoryFallbackDiagrams));
        }
    });
}

function listAllDiagrams() {
    return getAllDiagramsFromDB();
}

function deleteDiagramFromDB(id) {
    delete memoryFallbackDiagrams[id];
    return new Promise((resolve) => {
        if (!dbInstance) {
            resolve(true);
            return;
        }
        try {
            const tx = dbInstance.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

async function saveActiveDiagramState(payload) {
    if (!payload) return;
    const nodeCount = Array.isArray(payload.nodes) ? payload.nodes.length : 0;
    const doc = {
        id: activeDocumentId,
        title: activeDocumentTitle,
        updatedAt: Date.now(),
        nodeCount,
        data: payload
    };
    await queueStorageWrite(() => putDiagramInDB(doc));
    try {
        window.localStorage?.setItem(ACTIVE_DOC_KEY, activeDocumentId);
    } catch (e) {}
    notifyStorageSyncSaved(activeDocumentId);
}

// IndexedDB is the source of truth on boot; the localStorage mirror is only a
// fallback for older sessions and quota-constrained browsers.
async function restoreActiveDocumentFromStore() {
    if (typeof getDiagramFromDB !== 'function' || typeof restoreGraphPayload !== 'function') return false;
    const doc = await getDiagramFromDB(activeDocumentId);
    if (!doc || !doc.data || !Array.isArray(doc.data.nodes) || !Array.isArray(doc.data.connections)) return false;
    restoreGraphPayload(doc.data, true);
    return true;
}

async function switchDiagram(id) {
    if (id === activeDocumentId) return;
    // Save current diagram first
    if (typeof getGraphExportPayload === 'function') {
        await saveActiveDiagramState(getGraphExportPayload());
    }

    const doc = await getDiagramFromDB(id);
    if (!doc) {
        showToast('Diagram not found.', 'error');
        return;
    }

    activeDocumentId = doc.id;
    activeDocumentTitle = doc.title || 'Untitled Diagram';
    try {
        window.localStorage?.setItem(ACTIVE_DOC_KEY, activeDocumentId);
    } catch (e) {}

    updateDocHeaderUI();

    if (doc.data && typeof restoreGraphPayload === 'function') {
        restoreGraphPayload(doc.data);
    } else if (typeof createDefaultStarterGraph === 'function') {
        createDefaultStarterGraph();
    }
    showToast(`Opened "${activeDocumentTitle}"`, 'info', 2000);
}

async function createNewDiagram(title = 'Untitled Diagram') {
    if (typeof getGraphExportPayload === 'function') {
        await saveActiveDiagramState(getGraphExportPayload());
    }

    const newId = 'doc_' + Date.now();
    const newDoc = {
        id: newId,
        title: title || 'Untitled Diagram',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodeCount: 2,
        data: null
    };
    await putDiagramInDB(newDoc);
    activeDocumentId = newId;
    activeDocumentTitle = newDoc.title;
    try {
        window.localStorage?.setItem(ACTIVE_DOC_KEY, activeDocumentId);
    } catch (e) {}

    updateDocHeaderUI();
    if (typeof createDefaultStarterGraph === 'function') {
        createDefaultStarterGraph();
    }
    showToast(`Created "${activeDocumentTitle}"`, 'success', 2500);
}

async function duplicateCurrentDiagram() {
    if (typeof getGraphExportPayload === 'function') {
        await saveActiveDiagramState(getGraphExportPayload());
    }

    const newId = 'doc_' + Date.now();
    const payload = typeof getGraphExportPayload === 'function' ? getGraphExportPayload() : null;
    const newDoc = {
        id: newId,
        title: `${activeDocumentTitle} (Copy)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodeCount: payload?.nodes ? Object.keys(payload.nodes).length : 2,
        data: payload
    };
    await putDiagramInDB(newDoc);
    activeDocumentId = newId;
    activeDocumentTitle = newDoc.title;
    try {
        window.localStorage?.setItem(ACTIVE_DOC_KEY, activeDocumentId);
    } catch (e) {}

    updateDocHeaderUI();
    showToast(`Duplicated to "${activeDocumentTitle}"`, 'success', 2500);
}

async function renameCurrentDiagram(newTitle) {
    const trimmed = (newTitle || '').trim();
    if (!trimmed) return;
    activeDocumentTitle = trimmed;
    updateDocHeaderUI();
    if (typeof getGraphExportPayload === 'function') {
        await saveActiveDiagramState(getGraphExportPayload());
    }
    showToast(`Renamed to "${activeDocumentTitle}"`, 'success', 2000);
}

async function deleteDiagram(id) {
    const allDocs = await getAllDiagramsFromDB();
    if (allDocs.length <= 1) {
        showToast('Cannot delete the only diagram.', 'warning');
        return;
    }

    await deleteDiagramFromDB(id);
    if (id === activeDocumentId) {
        const remaining = allDocs.filter(d => d.id !== id);
        await switchDiagram(remaining[0].id);
    }
    showToast('Diagram deleted.', 'info', 2000);
}

function updateDocHeaderUI() {
    const titleLabel = document.getElementById('docTitleLabel');
    if (titleLabel) {
        titleLabel.textContent = activeDocumentTitle;
    }
}

// Diagrams modal UI
var diagramsModalEl = null;

async function openDiagramsModal() {
    if (diagramsModalEl && diagramsModalEl.isConnected) {
        closeDiagramsModal();
        return;
    }

    const allDocs = await getAllDiagramsFromDB();
    if (allDocs.length === 0) {
        allDocs.push({
            id: activeDocumentId,
            title: activeDocumentTitle,
            updatedAt: Date.now(),
            nodeCount: Object.keys(nodes || {}).length
        });
    }

    allDocs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    diagramsModalEl = document.createElement('div');
    diagramsModalEl.className = 'modal-overlay';
    diagramsModalEl.setAttribute('role', 'dialog');
    diagramsModalEl.setAttribute('aria-modal', 'true');
    diagramsModalEl.setAttribute('aria-label', 'Manage Diagrams');

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog diagrams-dialog';

    const header = document.createElement('div');
    header.className = 'modal-title';
    const headerLabel = document.createElement('span');
    headerLabel.textContent = 'My Diagrams';
    const headerBtns = document.createElement('div');
    headerBtns.style.display = 'flex';
    headerBtns.style.gap = '6px';
    const newDocBtn = document.createElement('button');
    newDocBtn.type = 'button';
    newDocBtn.className = 'mini-btn new-doc-btn';
    newDocBtn.textContent = '+ Blank';
    const templateDocBtn = document.createElement('button');
    templateDocBtn.type = 'button';
    templateDocBtn.className = 'mini-btn template-doc-btn';
    templateDocBtn.textContent = 'Templates...';
    templateDocBtn.addEventListener('click', () => {
        closeDiagramsModal();
        openTemplatesModal();
    });
    headerBtns.appendChild(newDocBtn);
    headerBtns.appendChild(templateDocBtn);
    header.appendChild(headerLabel);
    header.appendChild(headerBtns);

    const list = document.createElement('div');
    list.className = 'diagrams-list';

    allDocs.forEach(doc => {
        const item = document.createElement('div');
        item.className = `diagram-item${doc.id === activeDocumentId ? ' active' : ''}`;

        const info = document.createElement('div');
        info.className = 'diagram-info';
        info.setAttribute('role', 'button');
        info.setAttribute('tabindex', '0');
        info.title = doc.title || 'Untitled';

        const nameRow = document.createElement('div');
        nameRow.className = 'diagram-name';
        nameRow.textContent = doc.title || 'Untitled';
        if (doc.id === activeDocumentId) {
            const currentBadge = document.createElement('span');
            currentBadge.className = 'diagram-current';
            currentBadge.textContent = '(Current)';
            nameRow.appendChild(currentBadge);
        }

        const metaRow = document.createElement('div');
        metaRow.className = 'diagram-meta';
        metaRow.textContent = `${doc.nodeCount || 0} nodes • ${new Date(doc.updatedAt || Date.now()).toLocaleDateString()}`;

        info.appendChild(nameRow);
        info.appendChild(metaRow);
        info.addEventListener('click', () => {
            closeDiagramsModal();
            if (doc.id !== activeDocumentId) switchDiagram(doc.id);
        });
        info.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                closeDiagramsModal();
                if (doc.id !== activeDocumentId) switchDiagram(doc.id);
            }
        });

        const actions = document.createElement('div');
        actions.className = 'diagram-actions';

        const dupBtn = document.createElement('button');
        dupBtn.className = 'mini-btn';
        dupBtn.textContent = 'Copy';
        dupBtn.title = 'Duplicate diagram';
        dupBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            closeDiagramsModal();
            if (doc.id !== activeDocumentId) await switchDiagram(doc.id);
            await duplicateCurrentDiagram();
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'mini-btn danger-btn';
        delBtn.textContent = 'Del';
        delBtn.title = 'Delete diagram';
        delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${doc.title}"?`)) {
                await deleteDiagram(doc.id);
                closeDiagramsModal();
                openDiagramsModal();
            }
        });

        actions.appendChild(dupBtn);
        if (allDocs.length > 1) actions.appendChild(delBtn);

        item.appendChild(info);
        item.appendChild(actions);
        list.appendChild(item);
    });

    const footer = document.createElement('div');
    footer.className = 'modal-actions';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn modal-btn-primary';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Done';
    closeBtn.addEventListener('click', closeDiagramsModal);
    footer.appendChild(closeBtn);

    newDocBtn.addEventListener('click', async () => {
        closeDiagramsModal();
        const title = prompt('Enter diagram name:', 'Untitled Diagram');
        if (title !== null) await createNewDiagram(title);
    });

    dialog.appendChild(header);
    dialog.appendChild(list);
    dialog.appendChild(footer);
    diagramsModalEl.appendChild(dialog);
    document.body.appendChild(diagramsModalEl);

    diagramsModalEl.addEventListener('pointerdown', (e) => {
        if (e.target === diagramsModalEl) closeDiagramsModal();
    });
}

function closeDiagramsModal() {
    if (!diagramsModalEl || !diagramsModalEl.isConnected) return;
    diagramsModalEl.remove();
    diagramsModalEl = null;
}

// ===== Diagram Templates =====
var templatesModalEl = null;

var DIAGRAM_TEMPLATES = {
    auth_flow: {
        title: 'User Authentication Flow',
        description: 'Login form, credential check, session issuance, and database audit.',
        build: () => ({
            nodes: [
                { id: 't_start', type: 'start', x: 240, y: 80, text: 'User Enters Credentials', bgColor: '#dcfce7', textColor: '#166534' },
                { id: 't_decision', type: 'decision', x: 230, y: 190, text: 'Valid Credentials?', bgColor: '#fef3c7', textColor: '#92400e' },
                { id: 't_error', type: 'process', x: 470, y: 200, text: 'Show Error & Rate Limit', bgColor: '#ffe4e6', textColor: '#9f1239' },
                { id: 't_session', type: 'process', x: 230, y: 340, text: 'Issue JWT & Session Cookie', bgColor: '#e0f2fe', textColor: '#075985' },
                { id: 't_db', type: 'database', x: 230, y: 460, text: 'Update User Last Login', bgColor: '#f1f5f9', textColor: '#334155' },
                { id: 't_end', type: 'start', x: 240, y: 570, text: 'Redirect to Dashboard', bgColor: '#dcfce7', textColor: '#166534' }
            ],
            tables: [],
            connections: [
                { from: 't_start', to: 't_decision', type: 'sequence', label: 'Submit form' },
                { from: 't_decision', to: 't_error', type: 'sequence', label: 'No' },
                { from: 't_error', to: 't_start', type: 'sequence', label: 'Retry' },
                { from: 't_decision', to: 't_session', type: 'sequence', label: 'Yes' },
                { from: 't_session', to: 't_db', type: 'sequence', label: 'Audit' },
                { from: 't_db', to: 't_end', type: 'sequence', label: 'Success' }
            ]
        })
    },
    cloud_arch: {
        title: 'Cloud Microservices Architecture',
        description: 'Web client, API gateway, auth and core microservices with DB and cache.',
        build: () => ({
            nodes: [
                { id: 'c_client', type: 'start', x: 100, y: 150, text: 'Web / Mobile Client', bgColor: '#e0f2fe', textColor: '#0369a1' },
                { id: 'c_gateway', type: 'process', x: 310, y: 150, text: 'API Gateway / WAF', bgColor: '#f3e8ff', textColor: '#6b21a8' },
                { id: 'c_auth', type: 'process', x: 530, y: 80, text: 'Auth Microservice', bgColor: '#dcfce7', textColor: '#15803d' },
                { id: 'c_core', type: 'process', x: 530, y: 220, text: 'Core Application API', bgColor: '#fef3c7', textColor: '#a16207' },
                { id: 'c_db', type: 'database', x: 760, y: 180, text: 'Primary PostgreSQL', bgColor: '#ffffff', textColor: '#0f172a' },
                { id: 'c_cache', type: 'database', x: 760, y: 290, text: 'Redis Cache Layer', bgColor: '#ffe4e6', textColor: '#be123c' },
                { id: 'c_note', type: 'note', x: 730, y: 60, text: '5m TTL on cached sessions', bgColor: '#fef9c3', textColor: '#713f12' }
            ],
            tables: [],
            connections: [
                { from: 'c_client', to: 'c_gateway', type: 'sequence', label: 'HTTPS' },
                { from: 'c_gateway', to: 'c_auth', type: 'sequence', label: 'Verify token' },
                { from: 'c_gateway', to: 'c_core', type: 'sequence', label: 'Route request' },
                { from: 'c_core', to: 'c_db', type: 'dependency', label: 'Read/Write' },
                { from: 'c_core', to: 'c_cache', type: 'dependency', label: 'Check cache' },
                { from: 'c_cache', to: 'c_note', type: 'dependency', label: '' }
            ]
        })
    },
    incident_triage: {
        title: 'Incident Triage & Response',
        description: 'Alert response, health checks, rollback branch, and post-mortem document.',
        build: () => ({
            nodes: [
                { id: 'i_alert', type: 'start', x: 220, y: 80, text: 'High Latency Alert', bgColor: '#ffe4e6', textColor: '#9f1239' },
                { id: 'i_check', type: 'decision', x: 210, y: 190, text: 'Service Healthy?', bgColor: '#fef3c7', textColor: '#854d0e' },
                { id: 'i_rollback', type: 'process', x: 450, y: 190, text: 'Rollback Deployment', bgColor: '#fee2e2', textColor: '#b91c1c' },
                { id: 'i_logs', type: 'process', x: 210, y: 320, text: 'Inspect Trace Logs & Metrics', bgColor: '#e0f2fe', textColor: '#0369a1' },
                { id: 'i_doc', type: 'document', x: 210, y: 440, text: 'Incident Post-Mortem Doc', bgColor: '#ffffff', textColor: '#334155' },
                { id: 'i_resolved', type: 'start', x: 220, y: 560, text: 'Incident Resolved', bgColor: '#dcfce7', textColor: '#15803d' }
            ],
            tables: [],
            connections: [
                { from: 'i_alert', to: 'i_check', type: 'sequence', label: 'Page on-call' },
                { from: 'i_check', to: 'i_rollback', type: 'sequence', label: 'Degraded' },
                { from: 'i_check', to: 'i_logs', type: 'sequence', label: 'Online' },
                { from: 'i_rollback', to: 'i_doc', type: 'sequence', label: 'Document fix' },
                { from: 'i_logs', to: 'i_doc', type: 'sequence', label: 'Root cause' },
                { from: 'i_doc', to: 'i_resolved', type: 'sequence', label: 'Close ticket' }
            ]
        })
    }
};

async function createDiagramFromTemplate(templateKey) {
    const tmpl = DIAGRAM_TEMPLATES[templateKey];
    if (!tmpl) return;
    if (typeof getGraphExportPayload === 'function') {
        await saveActiveDiagramState(getGraphExportPayload());
    }

    const templateData = tmpl.build();
    const newId = 'doc_' + Date.now();
    const newDoc = {
        id: newId,
        title: tmpl.title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodeCount: templateData.nodes ? templateData.nodes.length : 0,
        data: templateData
    };
    await putDiagramInDB(newDoc);
    activeDocumentId = newId;
    activeDocumentTitle = newDoc.title;
    try {
        window.localStorage?.setItem(ACTIVE_DOC_KEY, activeDocumentId);
    } catch (e) {}

    updateDocHeaderUI();
    if (typeof restoreGraphPayload === 'function') {
        restoreGraphPayload(templateData, true);
    }
    if (typeof centerViewOnOrigin === 'function') centerViewOnOrigin();
    if (typeof showToast === 'function') {
        showToast(`Loaded template: ${tmpl.title}`, 'success', 2500);
    }
}

function openTemplatesModal() {
    if (templatesModalEl && templatesModalEl.isConnected) {
        closeTemplatesModal();
        return;
    }

    templatesModalEl = document.createElement('div');
    templatesModalEl.className = 'modal-overlay';
    templatesModalEl.setAttribute('role', 'dialog');
    templatesModalEl.setAttribute('aria-modal', 'true');
    templatesModalEl.setAttribute('aria-label', 'Diagram Templates');

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog templates-dialog';

    const header = document.createElement('div');
    header.className = 'modal-title';
    header.textContent = 'Diagram Templates';

    const list = document.createElement('div');
    list.className = 'templates-list';

    Object.entries(DIAGRAM_TEMPLATES).forEach(([key, tmpl]) => {
        const card = document.createElement('div');
        card.className = 'template-card';

        const info = document.createElement('div');
        info.className = 'template-info';

        const title = document.createElement('div');
        title.className = 'template-title';
        title.textContent = tmpl.title;

        const desc = document.createElement('div');
        desc.className = 'template-desc';
        desc.textContent = tmpl.description;

        info.appendChild(title);
        info.appendChild(desc);

        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'mini-btn use-template-btn';
        useBtn.textContent = 'Use Template';
        useBtn.addEventListener('click', async () => {
            closeTemplatesModal();
            await createDiagramFromTemplate(key);
        });

        card.appendChild(info);
        card.appendChild(useBtn);
        list.appendChild(card);
    });

    const footer = document.createElement('div');
    footer.className = 'modal-actions';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn modal-btn-primary';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Cancel';
    closeBtn.addEventListener('click', closeTemplatesModal);
    footer.appendChild(closeBtn);

    dialog.appendChild(header);
    dialog.appendChild(list);
    dialog.appendChild(footer);
    templatesModalEl.appendChild(dialog);
    document.body.appendChild(templatesModalEl);

    templatesModalEl.addEventListener('pointerdown', (e) => {
        if (e.target === templatesModalEl) closeTemplatesModal();
    });
}

function closeTemplatesModal() {
    if (!templatesModalEl || !templatesModalEl.isConnected) return;
    templatesModalEl.remove();
    templatesModalEl = null;
}
