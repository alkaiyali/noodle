// Toast notifications, modal prompt dialogs, and global error surfacing.
// Loaded after app-core.js, before modules that surface user-facing feedback.

var toastContainer = null;
var activeModalPromptResolver = null;
var lastErrorToastAt = 0;

function ensureToastContainer() {
    if (toastContainer && toastContainer.isConnected) return toastContainer;
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastContainer);
    return toastContainer;
}

function showToast(message, type = 'info', duration = 3500) {
    if (!message) return null;
    const container = ensureToastContainer();
    while (container.children.length >= 4) container.removeChild(container.firstChild);

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const TOAST_ICONS = { info: 'i', success: '✓', warning: '!', error: '✕' };

    const iconEl = document.createElement('span');
    iconEl.className = 'toast-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = TOAST_ICONS[type] || TOAST_ICONS.info;

    const messageEl = document.createElement('span');
    messageEl.className = 'toast-message';
    messageEl.textContent = String(message);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = '✕';

    toast.appendChild(iconEl);
    toast.appendChild(messageEl);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    let timer = null;
    function dismissToast() {
        if (timer) { clearTimeout(timer); timer = null; }
        toast.classList.add('toast-leaving');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        window.setTimeout(() => { if (toast.isConnected) toast.remove(); }, 400);
    }
    toast.addEventListener('click', (e) => {
        if (e.target === closeBtn) return;
        dismissToast();
    });
    closeBtn.addEventListener('click', dismissToast);
    timer = window.setTimeout(dismissToast, Math.max(1200, Number(duration) || 3500));
    return toast;
}

function showModalPrompt(options = {}) {
    const title = options.title || 'Enter value';
    const placeholder = options.placeholder || '';
    const defaultValue = typeof options.defaultValue === 'string' ? options.defaultValue : '';
    const confirmLabel = options.confirmLabel || 'OK';
    const cancelLabel = options.cancelLabel || 'Cancel';

    if (activeModalPromptResolver) return Promise.resolve(null);

    return new Promise((resolve) => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'modal-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', title);

        const titleEl = document.createElement('div');
        titleEl.className = 'modal-title';
        titleEl.textContent = title;

        const form = document.createElement('form');
        form.className = 'modal-form';

        const input = document.createElement('input');
        input.className = 'modal-input';
        input.type = 'text';
        input.placeholder = placeholder;
        input.value = defaultValue;
        input.setAttribute('aria-label', title);
        input.setAttribute('autocomplete', 'off');

        const actions = document.createElement('div');
        actions.className = 'modal-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'modal-btn modal-btn-cancel';
        cancelBtn.type = 'button';
        cancelBtn.textContent = cancelLabel;

        const okBtn = document.createElement('button');
        okBtn.className = 'modal-btn modal-btn-primary';
        okBtn.type = 'submit';
        okBtn.textContent = confirmLabel;

        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        form.appendChild(input);
        form.appendChild(actions);
        dialog.appendChild(titleEl);
        dialog.appendChild(form);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        activeModalPromptResolver = resolve;

        function closeModal(value) {
            if (!overlay.isConnected) return;
            activeModalPromptResolver = null;
            overlay.classList.add('modal-closing');
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            window.setTimeout(() => { if (overlay.isConnected) overlay.remove(); }, 250);
            if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
            resolve(value);
        }

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            closeModal(input.value);
        });
        cancelBtn.addEventListener('click', () => closeModal(null));
        overlay.addEventListener('pointerdown', (e) => {
            if (e.target === overlay) closeModal(null);
        });
        dialog.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                e.preventDefault();
                closeModal(null);
            }
        });

        input.focus();
        input.select();
    });
}

window.addEventListener('error', (event) => {
    const now = Date.now();
    if (now - lastErrorToastAt < 8000) return;
    lastErrorToastAt = now;
    showToast(event.message ? `Unexpected error: ${event.message}` : 'Unexpected error occurred.', 'error', 6000);
});

window.addEventListener('unhandledrejection', (event) => {
    const now = Date.now();
    if (now - lastErrorToastAt < 8000) return;
    lastErrorToastAt = now;
    showToast('An operation failed unexpectedly.', 'error', 6000);
});

// ===== Keyboard shortcut cheat sheet =====

var helpOverlayEl = null;

function getHelpShortcutEntries() {
    return [
        { keys: 'Ctrl+Z / Ctrl+Y', label: 'Undo / Redo' },
        { keys: 'Ctrl+C / Ctrl+V / Ctrl+X', label: 'Copy / Paste / Cut (incl. images & JSON)' },
        { keys: 'Ctrl+D', label: 'Duplicate' },
        { keys: 'Del / Backspace', label: 'Delete selection' },
        { keys: 'Ctrl+A', label: 'Select all' },
        { keys: 'Ctrl+F', label: 'Find on canvas' },
        { keys: 'Arrow keys', label: 'Nudge selection (grid-snapped)' },
        { keys: 'Shift + Arrow', label: 'Large nudge (3x grid / 10px)' },
        { keys: 'Alt + click', label: 'Connect nodes once' },
        { keys: 'Enter / F2', label: 'Edit label of selected node or arrow' },
        { keys: 'Shift + drag', label: 'Add to marquee selection' },
        { keys: 'Mouse wheel', label: 'Zoom in / out' },
        { keys: 'Drag canvas', label: 'Pan view' },
        { keys: 'Drag corner handle', label: 'Resize node manually (Shift locks aspect)' },
        { keys: 'Double-click handle', label: 'Reset node to auto-fit size' },
        { keys: 'Right-click / long-press', label: 'Context menu' },
        { keys: '?', label: 'Toggle this help' }
    ];
}

function toggleHelpOverlay() {
    if (helpOverlayEl && helpOverlayEl.isConnected) {
        closeHelpOverlay();
        return;
    }
    openHelpOverlay();
}

function openHelpOverlay() {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    helpOverlayEl = document.createElement('div');
    helpOverlayEl.className = 'help-overlay';
    helpOverlayEl.setAttribute('role', 'dialog');
    helpOverlayEl.setAttribute('aria-modal', 'true');
    helpOverlayEl.setAttribute('aria-label', 'Keyboard shortcuts');

    const panel = document.createElement('div');
    panel.className = 'help-panel';

    const header = document.createElement('div');
    header.className = 'help-header';

    const title = document.createElement('div');
    title.className = 'help-title';
    title.textContent = 'Keyboard Shortcuts';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-btn';
    closeBtn.textContent = 'Close';

    header.appendChild(title);
    header.appendChild(closeBtn);

    const grid = document.createElement('div');
    grid.className = 'help-grid';
    getHelpShortcutEntries().forEach(entry => {
        const row = document.createElement('div');
        row.className = 'help-row';

        const keys = document.createElement('kbd');
        keys.className = 'help-keys';
        keys.textContent = entry.keys;

        const label = document.createElement('span');
        label.className = 'help-label';
        label.textContent = entry.label;

        row.appendChild(keys);
        row.appendChild(label);
        grid.appendChild(row);
    });

    panel.appendChild(header);
    panel.appendChild(grid);
    helpOverlayEl.appendChild(panel);
    document.body.appendChild(helpOverlayEl);

    function closeHelp() {
        if (!helpOverlayEl || !helpOverlayEl.isConnected) return;
        const overlay = helpOverlayEl;
        overlay.classList.add('help-closing');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        window.setTimeout(() => { if (overlay.isConnected) overlay.remove(); }, 250);
        helpOverlayEl = null;
        if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    }

    closeBtn.addEventListener('click', closeHelp);
    helpOverlayEl.addEventListener('pointerdown', (e) => {
        if (e.target === helpOverlayEl) closeHelp();
    });
    helpOverlayEl.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closeHelp();
        }
    });
    closeBtn.focus();
}

function closeHelpOverlay() {
    if (!helpOverlayEl || !helpOverlayEl.isConnected) return;
    helpOverlayEl.classList.add('help-closing');
    const overlay = helpOverlayEl;
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    window.setTimeout(() => { if (overlay.isConnected) overlay.remove(); }, 250);
    helpOverlayEl = null;
}

window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const isHelpKey = e.key === '?' || (e.shiftKey && e.key === '/');
    if (!isHelpKey) return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
    e.preventDefault();
    toggleHelpOverlay();
});
