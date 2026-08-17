// Graph import, export, and JSON clipboard helpers.

    async function copyJSONToClipboard() {
        hideSaveMenu();
        hideAlignMenu();
        try {
            await writeTextToClipboard(JSON.stringify(getGraphExportPayload(), null, 2));
        } catch (err) {
            showToast('Unable to copy JSON to clipboard.', 'error');
        }
    }

    async function pasteJSONFromClipboard() {
        hideSaveMenu();
        hideAlignMenu();
        const rawText = await readTextFromClipboard('Paste JSON here:');
        if (!rawText || !rawText.trim()) return;
        importJSONText(rawText);
    }

    function importJSONText(rawText) {
        try {
            const data = JSON.parse(rawText);
            restoreGraphPayload(data);
            return true;
        } catch (err) {
            showToast('Invalid JSON: could not import the pasted data.', 'error');
            return false;
        }
    }

    function exportJSON() {
        hideSaveMenu();
        hideAlignMenu();
        clearSelection();
        const blob = new Blob([JSON.stringify(getGraphExportPayload(), null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "chart-data.json";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        showToast('Exported chart-data.json', 'success', 2500);
    }

    function importJSON(e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            importJSONText(ev.target.result);
            e.target.value = "";
        };
        reader.readAsText(file);
    }
