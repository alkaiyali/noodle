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
    const headerLabel = document.createElement('span');
    headerLabel.textContent = 'My Diagrams';
    const newDocBtn = document.createElement('button');
    newDocBtn.type = 'button';
    newDocBtn.className = 'mini-btn new-doc-btn';
    newDocBtn.textContent = '+ New Diagram';
    header.appendChild(headerLabel);
    header.appendChild(newDocBtn);

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
