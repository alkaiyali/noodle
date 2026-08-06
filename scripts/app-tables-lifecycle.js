// Table lifecycle, creation, and shared table state helpers.

    function setTablePosition(tableOrId, x, y) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        if (!tableData) return;
        tableData.x = x;
        tableData.y = y;
        tableData.el.style.left = `${x}px`;
        tableData.el.style.top = `${y}px`;
    }

    function applyTableAppearance(tableOrId) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        if (!tableData) return;
        tableData.el.style.backgroundColor = tableData.bgColor;
        tableData.el.style.color = tableData.textColor;
    }

    function serializeTable(tableOrId, extra = {}) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        if (!tableData) return null;
        syncTableFilterState(tableData);
        syncTableSortState(tableData);
        return {
            id: tableData.id,
            x: roundPersistedPositionValue(tableData.x),
            y: roundPersistedPositionValue(tableData.y),
            html: sanitizeCanvasTableHTML(getTableGrid(tableData)?.outerHTML || ''),
            bgColor: tableData.bgColor,
            textColor: tableData.textColor,
            filtersEnabled: tableData.filtersEnabled,
            filters: [...tableData.filters],
            sortState: tableData.sortState ? { ...tableData.sortState } : null,
            ...extra
        };
    }

    function serializeTables(tableIds = Object.keys(tables)) {
        return tableIds.map(id => serializeTable(id)).filter(Boolean);
    }

    function getNextTableIdCounter(tableData = []) {
        return tableData.reduce((maxId, table) => {
            const num = parseInt(String(table.id || '').split('_')[1], 10);
            return Number.isNaN(num) ? maxId : Math.max(maxId, num + 1);
        }, 0);
    }

    function createTable(presetId = null, presetX = null, presetY = null, presetHtml = '', presetBg = '#ffffff', presetColor = '#0f172a', recordHistory = !presetId, autoSelect = !presetId, presetFiltersEnabled = false, presetFilters = null, presetSortState = null) {
        const id = presetId || `table_${tableIdCounter++}`;
        const tableEl = document.createElement('div');
        tableEl.id = id;
        tableEl.className = 'canvas-table';

        const x = presetX !== null ? presetX : ((window.innerWidth / 2) - panX) / zoom - 140 + (Math.random() * 40 - 20);
        const y = presetY !== null ? presetY : ((window.innerHeight / 3) - panY) / zoom + (Math.random() * 40 - 20);

        tables[id] = {
            id,
            el: tableEl,
            x,
            y,
            bgColor: presetBg || '#ffffff',
            textColor: presetColor || '#0f172a',
            filtersEnabled: Boolean(presetFiltersEnabled),
            filters: Array.isArray(presetFilters) ? [...presetFilters] : [],
            sortState: presetSortState && typeof presetSortState === 'object' ? { ...presetSortState } : null
        };
        setTablePosition(tables[id], x, y);
        content.appendChild(tableEl);
        setTableMarkup(tables[id], sanitizeCanvasTableHTML(presetHtml || getDefaultTableHTML()));

        tableEl.addEventListener('pointerdown', handleTablePointerDown);
        tableEl.addEventListener('dblclick', handleTableDoubleClick);
        tableEl.addEventListener('click', (e) => {
            const filterButton = e.target.closest('.table-filter-btn');
            const filterMenuAction = e.target.closest('[data-table-filter-menu-action]');
            const summaryMenuAction = e.target.closest('[data-table-summary-menu-action]');
            if (filterButton) {
                e.preventDefault();
                e.stopPropagation();
                if (!selectedTableIds.has(id) || selectedTableIds.size !== 1) {
                    clearSelection();
                    addTableToSelection(id);
                }
                setActiveTableContext(id, getTableCellByContext(id, { section: 'head', rowIndex: 0, colIndex: Number(filterButton.dataset.filterIndex) || 0 }), { scope: 'column' });
                commitActiveInlineEditors(filterButton);
                openTableFilterMenu(id, Number(filterButton.dataset.filterIndex));
                return;
            }
            if (filterMenuAction) {
                e.preventDefault();
                e.stopPropagation();
                if (
                    filterMenuAction.dataset.tableFilterMenuAction === 'sort-text-asc'
                    || filterMenuAction.dataset.tableFilterMenuAction === 'sort-text-desc'
                    || filterMenuAction.dataset.tableFilterMenuAction === 'sort-numeric-asc'
                    || filterMenuAction.dataset.tableFilterMenuAction === 'sort-numeric-desc'
                ) {
                    const columnIndex = Number(filterMenuAction.dataset.filterIndex);
                    if (Number.isInteger(columnIndex) && columnIndex >= 0) {
                        const action = filterMenuAction.dataset.tableFilterMenuAction;
                        sortTableByColumn(
                            id,
                            columnIndex,
                            action === 'sort-text-desc' || action === 'sort-numeric-desc' ? 'desc' : 'asc',
                            action === 'sort-numeric-asc' || action === 'sort-numeric-desc' ? 'numeric' : 'text'
                        );
                    }
                    return;
                }
                if (filterMenuAction.dataset.tableFilterMenuAction === 'clear') {
                    const columnIndex = Number(filterMenuAction.dataset.filterIndex);
                    if (Number.isInteger(columnIndex) && columnIndex >= 0) {
                        setTableFilterValue(id, columnIndex, '', { recordHistory: false });
                        if (activeTableFilterMenu?.tableId === id && activeTableFilterMenu.columnIndex === columnIndex) {
                            activeTableFilterMenu.initialValue = '';
                        }
                        const menuInput = getTableFilterMenu(id)?.querySelector('.table-filter-menu-input');
                        if (menuInput) {
                            menuInput.value = '';
                            menuInput.focus();
                            menuInput.select();
                        }
                    }
                    return;
                }
                if (filterMenuAction.dataset.tableFilterMenuAction === 'done') {
                    closeTableFilterMenu({ tableId: id, commitHistory: true });
                }
                return;
            }
            if (!summaryMenuAction) return;
            e.preventDefault();
            e.stopPropagation();
            if (summaryMenuAction.dataset.tableSummaryMenuAction === 'set') {
                setTableSummaryFunction(id, summaryMenuAction.dataset.tableSummaryFunction, { recordHistory: true });
                closeTableSummaryMenu({ tableId: id });
                return;
            }
            if (summaryMenuAction.dataset.tableSummaryMenuAction === 'remove') {
                setTableSummaryFunction(id, '', { recordHistory: true });
                closeTableSummaryMenu({ tableId: id });
                return;
            }
            if (summaryMenuAction.dataset.tableSummaryMenuAction === 'close') {
                closeTableSummaryMenu({ tableId: id });
            }
        });
        tableEl.addEventListener('input', (e) => {
            const filterInput = e.target.closest('.table-filter-menu-input');
            if (filterInput) {
                setTableFilterValue(id, Number(filterInput.dataset.filterIndex), filterInput.value);
                return;
            }
            queueTableStructureHandleLayout(id);
        });
        tableEl.addEventListener('change', (e) => {
            const filterInput = e.target.closest('.table-filter-menu-input');
            if (!filterInput) return;
            closeTableFilterMenu({ tableId: id, commitHistory: true });
        });
        tableEl.addEventListener('keydown', (e) => {
            const filterInput = e.target.closest('.table-filter-menu-input');
            if (filterInput) {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    closeTableFilterMenu({ tableId: id, commitHistory: true });
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    if (activeTableFilterMenu?.tableId === id) {
                        setTableFilterValue(id, activeTableFilterMenu.columnIndex, activeTableFilterMenu.initialValue, { recordHistory: false });
                    }
                    closeTableFilterMenu({ tableId: id, commitHistory: false });
                }
                return;
            }

            if (e.target.closest('.table-summary-menu') && e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeTableSummaryMenu({ tableId: id });
                const summaryButton = tables[id]?.el.querySelector('[data-table-action="add-summary-row"]');
                if (summaryButton instanceof HTMLElement) summaryButton.focus();
                return;
            }
        });
        tableEl.addEventListener('paste', (e) => {
            const cell = e.target.closest('th, td');
            if (editingTableId !== id || !(cell instanceof HTMLElement) || !cell.isContentEditable) return;
            const clipboardText = e.clipboardData?.getData('text/plain') || '';
            const markdownMatrix = parseMarkdownTableMatrix(clipboardText);
            if (markdownMatrix) {
                e.preventDefault();
                e.stopPropagation();
                applyMarkdownTableMatrix(id, markdownMatrix, { recordHistory: true });
                return;
            }
            if (!/[\t\r\n]/.test(clipboardText)) return;
            e.preventDefault();
            e.stopPropagation();
            applyTableClipboardText(id, getTableCellContext(id, cell, { scope: 'cell' }), clipboardText, { recordHistory: true });
        });
        tableEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hasPanned = false;
            isDragging = false;
            pendingNodeEditId = null;
            clearDeleteDropZoneState();
            setCanvasSelectionSuppressed(false);
            if (typeof openContextMenuAtTarget === 'function') {
                openContextMenuAtTarget(e.target, e.clientX, e.clientY);
            }
        });
        tableEl.addEventListener('focusout', () => {
            if (editingTableId !== id) return;
            if (suspendedTableFocusCommitCount > 0) return;
            window.setTimeout(() => {
                if (suspendedTableFocusCommitCount > 0) return;
                const activeElement = document.activeElement;
                if (!tables[id] || tables[id].el.contains(activeElement)) return;
                finishTableEditing(true, true);
            }, 0);
        });

        if (autoSelect) {
            clearSelection();
            addTableToSelection(id);
        }
        if (recordHistory) saveHistoryState();
        return id;
    }

    document.addEventListener('pointerdown', (e) => {
        if (
            e.target.closest('.table-filter-menu')
            || e.target.closest('.table-filter-btn')
            || e.target.closest('.table-summary-menu')
            || e.target.closest('[data-table-action="add-summary-row"]')
        ) return;
        closeTableFilterMenu({ commitHistory: true });
        closeTableSummaryMenu();
    });

    function clearTableSelection() {
        closeTableSummaryMenu();
        selectedTableIds.forEach(id => { if (tables[id]) tables[id].el.classList.remove('selected'); });
        selectedTableIds.clear();
        activeTableContext = getDefaultActiveTableContext();
        activeTableAdditionalCellContexts = [];
        syncActiveTableSelectionUI();
        updateToolbarColors();
    }

    function addTableToSelection(tableId) {
        if (!tables[tableId]) return;
        if (selectedConnectionIndexes.size) clearConnectionSelection();
        if (selectedNodes.size) clearNodeSelection();
        selectedTableIds.add(tableId);
        tables[tableId].el.classList.add('selected');
        syncActiveTableSelectionUI(tableId);
        updateToolbarColors();
    }

    function removeTableFromSelection(tableId) {
        if (!selectedTableIds.has(tableId) || !tables[tableId]) return;
        closeTableSummaryMenu({ tableId });
        selectedTableIds.delete(tableId);
        tables[tableId].el.classList.remove('selected');
        if (activeTableContext.tableId === tableId) {
            activeTableContext = getDefaultActiveTableContext();
            activeTableAdditionalCellContexts = [];
        }
        syncActiveTableSelectionUI();
        updateToolbarColors();
    }

    function getSharedSelectedTableColor(property) {
        const tableIds = Array.from(selectedTableIds).filter(id => tables[id]);
        if (!tableIds.length) return null;
        if (tableIds.length === 1 && activeTableContext.tableId === tableIds[0] && activeTableContext.scope !== 'table') {
            if (activeTableContext.section === 'summary') return null;
            const scopedCells = getResolvedTableScopeCells(tableIds[0], activeTableContext);
            if (!scopedCells.length) return null;
            const firstValue = getTableCellScopedColor(scopedCells[0], property);
            return scopedCells.every(cell => getTableCellScopedColor(cell, property) === firstValue) ? (firstValue || null) : null;
        }
        const firstValue = tables[tableIds[0]][property];
        return tableIds.every(id => tables[id][property] === firstValue) ? firstValue : null;
    }

    function getSelectedTableEntry() {
        const tableIds = Array.from(selectedTableIds).filter(id => tables[id]);
        return tableIds.length === 1 ? tables[tableIds[0]] : null;
    }

