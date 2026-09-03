// IndexedDB storage layer and multi-document manager for Noodle.
// Provides non-destructive diagram switching, naming, cloning, and autosave.

var DB_NAME = 'noodle-diagrams-db';
var DB_VERSION = 1;
var STORE_NAME = 'diagrams';
var ACTIVE_DOC_KEY = 'noodle-active-doc-id';

var activeDocumentId = 'default';
var activeDocumentTitle = 'My Diagram';
var dbInstance = null;

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
    const nodeCount = payload.nodes ? Object.keys(payload.nodes).length : 0;
    const doc = {
        id: activeDocumentId,
        title: activeDocumentTitle,
        updatedAt: Date.now(),
        nodeCount,
        data: payload
    };
    await putDiagramInDB(doc);
    try {
        window.localStorage?.setItem(ACTIVE_DOC_KEY, activeDocumentId);
        window.localStorage?.setItem('graph-autosave-v1', JSON.stringify(payload));
    } catch (e) {}
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
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.innerHTML = `<span>My Diagrams</span><button type="button" class="mini-btn new-doc-btn" style="padding:4px 10px;font-size:12px;">+ New Diagram</button>`;

    const list = document.createElement('div');
    list.className = 'diagrams-list';
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    list.style.maxHeight = '320px';
    list.style.overflowY = 'auto';
    list.style.marginTop = '12px';

    allDocs.forEach(doc => {
        const item = document.createElement('div');
        item.className = `diagram-item${doc.id === activeDocumentId ? ' active' : ''}`;
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '10px 12px';
        item.style.borderRadius = '10px';
        item.style.border = '1px solid var(--grid-color, #e2e8f0)';
        item.style.background = doc.id === activeDocumentId ? 'rgba(99, 102, 241, 0.08)' : 'transparent';

        const info = document.createElement('div');
        info.style.cursor = 'pointer';
        info.style.flex = '1';
        info.innerHTML = `
            <div style="font-weight:600;font-size:13px;color:var(--text-color);">${doc.title || 'Untitled'} ${doc.id === activeDocumentId ? '<span style="color:var(--primary);font-size:11px;font-weight:700;">(Current)</span>' : ''}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">${doc.nodeCount || 0} nodes • ${new Date(doc.updatedAt || Date.now()).toLocaleDateString()}</div>
        `;
        info.addEventListener('click', () => {
            closeDiagramsModal();
            if (doc.id !== activeDocumentId) switchDiagram(doc.id);
        });

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '4px';

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
        delBtn.className = 'mini-btn';
        delBtn.textContent = 'Del';
        delBtn.title = 'Delete diagram';
        delBtn.style.color = 'var(--danger, #f43f5e)';
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
    footer.style.marginTop = '16px';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn modal-btn-primary';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Done';
    closeBtn.addEventListener('click', closeDiagramsModal);
    footer.appendChild(closeBtn);

    header.querySelector('.new-doc-btn').addEventListener('click', async () => {
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
