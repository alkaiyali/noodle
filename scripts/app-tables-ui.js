// Table menus, handles, and table-scoped UI helpers.

    function getTableFilterMatchText(cellEl) {
        return String(cellEl?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function closeTableFilterMenu({ tableId = null, commitHistory = true } = {}) {
        if (!activeTableFilterMenu) return false;
        if (tableId && activeTableFilterMenu.tableId !== tableId) return false;

        const { tableId: activeTableId, columnIndex, initialValue } = activeTableFilterMenu;
        const tableData = tables[activeTableId];
        const menuEl = getTableFilterMenu(activeTableId);
        if (menuEl) {
            menuEl.hidden = true;
            menuEl.innerHTML = '';
        }
        if (tableData) {
            tableData.openFilterIndex = null;
            if (commitHistory) {
                const currentValue = syncTableFilterState(tableData)[columnIndex] || '';
                if (currentValue !== initialValue) saveHistoryState();
            }
        }
        activeTableFilterMenu = null;
        return true;
    }

    function positionTableFilterMenu(tableOrId) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        const menuEl = getTableFilterMenu(tableData);
        const openFilterIndex = tableData?.openFilterIndex;
        if (!tableData || !menuEl || menuEl.hidden || !Number.isInteger(openFilterIndex) || openFilterIndex < 0) return false;

        const headerCell = getTableHeaderCells(tableData)[openFilterIndex];
        if (!headerCell) return false;

        const tableRect = tableData.el.getBoundingClientRect();
        const cellRect = headerCell.getBoundingClientRect();
        const desiredLeft = cellRect.left - tableRect.left + cellRect.width - menuEl.offsetWidth;
        const maxLeft = Math.max(8, tableRect.width - menuEl.offsetWidth - 8);
        menuEl.style.left = `${Math.max(8, Math.min(desiredLeft, maxLeft))}px`;
        menuEl.style.top = `${Math.max(8, cellRect.bottom - tableRect.top + 6)}px`;
        return true;
    }

    function openTableFilterMenu(tableId, columnIndex) {
        const tableData = tables[tableId];
        const menuEl = getTableFilterMenu(tableData);
        const headerCell = getTableHeaderCells(tableData)[columnIndex];
        if (!tableData || !menuEl || !(headerCell instanceof HTMLElement)) return false;

        const filters = syncTableFilterState(tableData);
        const sortState = syncTableSortState(tableData, filters.length);
        const currentValue = filters[columnIndex] || '';
        const currentSortDirection = sortState?.columnIndex === columnIndex ? sortState.direction : '';
        const currentSortMode = sortState?.columnIndex === columnIndex ? sortState.mode : 'text';
        if (activeTableFilterMenu?.tableId === tableId && activeTableFilterMenu.columnIndex === columnIndex && !menuEl.hidden) {
            return closeTableFilterMenu({ tableId, commitHistory: true });
        }

        closeTableFilterMenu({ commitHistory: true });
        tableData.openFilterIndex = columnIndex;
        menuEl.hidden = false;
        menuEl.innerHTML = `
            <div class="table-filter-menu-heading">${escapeHTML(getTableHeaderLabel(headerCell) || `Column ${columnIndex + 1}`)}</div>
            <div class="table-filter-menu-section">
                <div class="table-filter-menu-label">Sort</div>
                <div class="table-filter-sort-grid">
                    <button class="mini-btn table-filter-sort-btn${currentSortMode === 'text' && currentSortDirection === 'asc' ? ' active' : ''}" type="button" data-table-filter-menu-action="sort-text-asc" data-filter-index="${columnIndex}">Text A to Z</button>
                    <button class="mini-btn table-filter-sort-btn${currentSortMode === 'text' && currentSortDirection === 'desc' ? ' active' : ''}" type="button" data-table-filter-menu-action="sort-text-desc" data-filter-index="${columnIndex}">Text Z to A</button>
                    <button class="mini-btn table-filter-sort-btn${currentSortMode === 'numeric' && currentSortDirection === 'asc' ? ' active' : ''}" type="button" data-table-filter-menu-action="sort-numeric-asc" data-filter-index="${columnIndex}">Lowest to highest</button>
                    <button class="mini-btn table-filter-sort-btn${currentSortMode === 'numeric' && currentSortDirection === 'desc' ? ' active' : ''}" type="button" data-table-filter-menu-action="sort-numeric-desc" data-filter-index="${columnIndex}">Highest to lowest</button>
                </div>
            </div>
            <div class="table-filter-menu-divider"></div>
            <label class="table-filter-menu-field">
                <span class="table-filter-menu-label">Contains</span>
                <input class="table-filter-menu-input" type="text" data-filter-index="${columnIndex}" value="${escapeHTML(currentValue)}" placeholder="Filter values" aria-label="Filter column ${columnIndex + 1}">
            </label>
            <div class="table-filter-menu-actions">
                <button class="mini-btn table-filter-menu-btn" type="button" data-table-filter-menu-action="clear" data-filter-index="${columnIndex}">Clear</button>
                <button class="mini-btn table-filter-menu-btn" type="button" data-table-filter-menu-action="done" data-filter-index="${columnIndex}">Done</button>
            </div>
        `;
        positionTableFilterMenu(tableData);
        activeTableFilterMenu = { tableId, columnIndex, initialValue: currentValue };
        window.requestAnimationFrame(() => {
            const inputEl = menuEl.querySelector('.table-filter-menu-input');
            inputEl?.focus();
            inputEl?.select();
        });
        return true;
    }

    function syncTableFilterUI(tableOrId) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        const tableGrid = getTableGrid(tableData);
        const menuEl = getTableFilterMenu(tableData);
        const headerCells = getTableHeaderCells(tableData);
        if (!tableData || !tableGrid || !menuEl || !headerCells.length) return;

        const filters = syncTableFilterState(tableData, headerCells.length);
        const sortState = syncTableSortState(tableData, headerCells.length);
        const shouldShowFilters = tableData.filtersEnabled;
        tableData.el.classList.toggle('filters-visible', shouldShowFilters);
        headerCells.forEach((headerCell, index) => {
            let buttonEl = headerCell.querySelector('.table-filter-btn');
            if (!shouldShowFilters) {
                buttonEl?.remove();
                headerCell.classList.remove('table-sort-column');
                return;
            }
            if (!buttonEl) {
                buttonEl = document.createElement('button');
                buttonEl.type = 'button';
                buttonEl.className = 'table-filter-btn';
                buttonEl.dataset.filterIndex = String(index);
                buttonEl.setAttribute('aria-label', `Open filter for column ${index + 1}`);
                buttonEl.setAttribute('contenteditable', 'false');
                headerCell.appendChild(buttonEl);
            }
            const isSortedColumn = Boolean(sortState && sortState.columnIndex === index);
            const sortDirection = isSortedColumn ? sortState.direction : '';
            const sortMode = isSortedColumn ? sortState.mode : 'text';
            buttonEl.dataset.filterIndex = String(index);
            buttonEl.dataset.icon = sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : '▾';
            buttonEl.dataset.sortDirection = sortDirection;
            buttonEl.classList.toggle('active', Boolean(filters[index]));
            buttonEl.classList.toggle('menu-open', Boolean(tableData.openFilterIndex === index && !menuEl.hidden));
            buttonEl.classList.toggle('sorted', isSortedColumn);
            buttonEl.title = `${filters[index] ? 'Filtered' : 'Filter'}${sortDirection ? ` • Sorted ${sortMode === 'numeric' ? (sortDirection === 'asc' ? 'lowest to highest' : 'highest to lowest') : (sortDirection === 'asc' ? 'text A to Z' : 'text Z to A')}` : ''}`;
            headerCell.classList.toggle('table-sort-column', isSortedColumn);
        });

        const activeFilters = filters.map(value => value.toLowerCase());
        const filtersAreActive = shouldShowFilters && activeFilters.some(Boolean);
        tableData.el.classList.toggle('filters-active', filtersAreActive);
        getTableBodyRows(tableData).forEach(row => {
            const rowCells = Array.from(row.children).filter(cell => cell.matches('th, td'));
            const matchesAllFilters = (!shouldShowFilters ? [] : activeFilters).every((filterValue, index) => {
                if (!filterValue) return true;
                return getTableFilterMatchText(rowCells[index]).includes(filterValue);
            });
            row.hidden = !matchesAllFilters;
        });
        const summaryRowEl = getTableSummaryRowElement(tableData);
        if (summaryRowEl) summaryRowEl.hidden = false;

        if (!shouldShowFilters) {
            closeTableFilterMenu({ tableId: tableData.id, commitHistory: false });
            return;
        }

        if (!Number.isInteger(tableData.openFilterIndex) || tableData.openFilterIndex < 0 || tableData.openFilterIndex >= headerCells.length) {
            closeTableFilterMenu({ tableId: tableData.id, commitHistory: false });
            return;
        }

        const menuInput = menuEl.querySelector('.table-filter-menu-input');
        if (menuInput) {
            menuInput.value = filters[tableData.openFilterIndex] || '';
        }
        menuEl.hidden = false;
        positionTableFilterMenu(tableData);
        positionTableSummaryMenu(tableData);
    }

    function setTableFilterValue(tableId, columnIndex, value = '', { recordHistory = false } = {}) {
        const tableData = tables[tableId];
        if (!tableData || !Number.isInteger(columnIndex) || columnIndex < 0) return false;
        const filters = syncTableFilterState(tableData);
        if (columnIndex >= filters.length) return false;
        const nextValue = sanitizeTableFilterValue(value);
        if (filters[columnIndex] === nextValue) return false;
        filters[columnIndex] = nextValue;
        tableData.filters = filters;
        syncTableFilterUI(tableData);
        queueTableStructureHandleLayout(tableData);
        updateToolbarColors();
        if (recordHistory) saveHistoryState();
        else scheduleAutosave();
        return true;
    }

    function clearTableFilters(tableId, { recordHistory = false } = {}) {
        const tableData = tables[tableId];
        if (!tableData) return false;
        const filters = syncTableFilterState(tableData);
        if (!filters.some(Boolean)) return false;
        tableData.filters = filters.map(() => '');
        syncTableFilterUI(tableData);
        queueTableStructureHandleLayout(tableData);
        updateToolbarColors();
        if (recordHistory) saveHistoryState();
        else scheduleAutosave();
        return true;
    }

    function toggleTableFilters(tableId) {
        const tableData = tables[tableId];
        if (!tableData) return false;
        syncTableFilterState(tableData);
        tableData.filtersEnabled = !tableData.filtersEnabled;
        syncTableFilterUI(tableData);
        queueTableStructureHandleLayout(tableData);
        updateToolbarColors();
        saveHistoryState();
        if (tableData.filtersEnabled) {
            window.requestAnimationFrame(() => {
                getTableHeaderCells(tableData)[0]?.querySelector('.table-filter-btn')?.focus();
            });
        }
        return true;
    }

    function syncTableSummaryUI(tableOrId) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        const summaryButton = getTableElement(tableData)?.querySelector('[data-table-action="add-summary-row"]');
        if (!tableData || !(summaryButton instanceof HTMLElement)) return;

        const summaryFunction = getTableSummaryFunctionFromRowElement(getTableSummaryRowElement(tableData));
        const summaryMeta = getTableSummaryFunctionMeta(summaryFunction);
        const isMenuOpen = Boolean(activeTableSummaryMenu?.tableId === tableData.id);

        summaryButton.classList.toggle('summary-active', Boolean(summaryMeta));
        summaryButton.classList.toggle('menu-open', isMenuOpen);
        summaryButton.textContent = summaryMeta?.label || 'Summary';
        summaryButton.title = summaryMeta
            ? `${summaryMeta.label} summary row`
            : 'Add a summary row';
        summaryButton.setAttribute('aria-pressed', summaryMeta ? 'true' : 'false');
    }

    function setTableMarkup(tableOrId, tableHtml) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        if (!tableData) return;
        closeTableSummaryMenu({ tableId: tableData.id });
        tableData.el.innerHTML = buildTableShellHTML(tableData.id, tableHtml);
        applyTableAppearance(tableData);
        syncTableSummaryUI(tableData);
        syncTableFilterUI(tableData);
        syncActiveTableSelectionUI(tableData.id);
        queueTableStructureHandleLayout(tableData);
    }

    function buildTableStructureHandle(tableId, kind, index, label) {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = `table-structure-handle table-${kind}-drag-handle`;
        handle.dataset.tableId = tableId;
        handle.dataset.tableDragKind = kind;
        handle.dataset.index = String(index);
        handle.tabIndex = -1;
        handle.contentEditable = 'false';
        handle.setAttribute('aria-label', label);
        return handle;
    }

    function attachTableStructureHandles(tableOrId) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        const tableGrid = getTableGrid(tableData);
        const columnHandleLayer = getTableColumnHandleLayer(tableData);
        const rowHandleLayer = getTableRowHandleLayer(tableData);
        const headerCells = getTableHeaderCells(tableData);
        if (!tableData || !tableGrid || !columnHandleLayer || !rowHandleLayer) return;

        tableData.el.querySelectorAll('.table-structure-handle').forEach(handle => handle.remove());
        const gridRect = tableGrid.getBoundingClientRect();
        const tableRect = tableData.el.getBoundingClientRect();
        columnHandleLayer.style.left = `${gridRect.left - tableRect.left}px`;
        columnHandleLayer.style.top = `${gridRect.top - tableRect.top}px`;
        columnHandleLayer.style.width = `${gridRect.width}px`;
        columnHandleLayer.style.height = '0px';
        rowHandleLayer.style.left = `${gridRect.left - tableRect.left}px`;
        rowHandleLayer.style.top = `${gridRect.top - tableRect.top}px`;
        rowHandleLayer.style.width = '0px';
        rowHandleLayer.style.height = `${gridRect.height}px`;

        headerCells.forEach((cell, index) => {
            const handle = buildTableStructureHandle(tableData.id, 'column', index, `Select or reorder column ${index + 1}`);
            handle.style.left = `${cell.offsetLeft + (cell.offsetWidth / 2)}px`;
            handle.style.top = '-7px';
            columnHandleLayer.appendChild(handle);
        });

        if (hasActiveTableFilters(tableData)) return;

        getTableBodyRows(tableData).forEach((row, index) => {
            const handle = buildTableStructureHandle(tableData.id, 'row', index, `Select or reorder row ${index + 1}`);
            handle.style.left = '-7px';
            handle.style.top = `${row.offsetTop + (row.offsetHeight / 2)}px`;
            rowHandleLayer.appendChild(handle);
        });
    }

    function queueTableStructureHandleLayout(tableOrId) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        if (!tableData?.el) return;
        if (tableData.handleLayoutFrameId) window.cancelAnimationFrame(tableData.handleLayoutFrameId);
        tableData.handleLayoutFrameId = window.requestAnimationFrame(() => {
            tableData.handleLayoutFrameId = null;
            syncTableFilterUI(tableData);
            attachTableStructureHandles(tableData);
            syncActiveTableSelectionUI(tableData.id);
            positionTableSummaryMenu(tableData);
        });
    }

    function clearTableStructureDropTargets(tableId = null) {
        const scope = tableId && tables[tableId] ? tables[tableId].el : document;
        scope.querySelectorAll('.table-drop-target, .table-drop-row-target').forEach(el => {
            el.classList.remove('table-drop-target', 'table-drop-row-target');
        });
        if (tableId && tables[tableId]) {
            tables[tableId].el.classList.remove('reordering');
        }
    }

    function applyTableStructureDropTarget(tableId, kind, index, rangeLength = 1) {
        const tableData = tables[tableId];
        if (!tableData) return;
        clearTableStructureDropTargets(tableId);
        tableData.el.classList.add('reordering');
        if (!Number.isInteger(index) || index < 0) return;
        const normalizedRangeLength = Math.max(1, rangeLength);

        if (kind === 'row') {
            const rows = getTableBodyRows(tableData);
            rows.slice(index, index + normalizedRangeLength).forEach(rowEl => rowEl?.classList.add('table-drop-row-target'));
            return;
        }

        Array.from(tableData.el.querySelectorAll('tr')).forEach(row => {
            const cells = Array.from(row.children).filter(cell => cell.matches('th, td'));
            cells.slice(index, index + normalizedRangeLength).forEach(cell => cell?.classList.add('table-drop-target'));
        });
    }

    function resolveTableStructureTargetIndex(tableId, kind, clientX, clientY) {
        const tableData = tables[tableId];
        if (!tableData) return null;
        const tableRect = tableData.el.getBoundingClientRect();
        if (clientX < tableRect.left - 24 || clientX > tableRect.right + 24 || clientY < tableRect.top - 24 || clientY > tableRect.bottom + 24) {
            return null;
        }

        if (kind === 'row') {
            const rows = getTableBodyRows(tableData);
            if (!rows.length) return null;
            return rows.reduce((closestIndex, rowEl, index, list) => {
                const rowRect = rowEl.getBoundingClientRect();
                const distance = Math.abs(clientY - (rowRect.top + (rowRect.height / 2)));
                const closestRowRect = list[closestIndex].getBoundingClientRect();
                const closestDistance = Math.abs(clientY - (closestRowRect.top + (closestRowRect.height / 2)));
                return distance < closestDistance ? index : closestIndex;
            }, 0);
        }

        const headerCells = Array.from(tableData.el.querySelectorAll('thead tr:first-child > th, thead tr:first-child > td'));
        if (!headerCells.length) return null;
        return headerCells.reduce((closestIndex, cellEl, index, list) => {
            const cellRect = cellEl.getBoundingClientRect();
            const distance = Math.abs(clientX - (cellRect.left + (cellRect.width / 2)));
            const closestCellRect = list[closestIndex].getBoundingClientRect();
            const closestDistance = Math.abs(clientX - (closestCellRect.left + (closestCellRect.width / 2)));
            return distance < closestDistance ? index : closestIndex;
        }, 0);
    }

    function startTableStructureDrag(handleEl, pointerId) {
        const tableId = handleEl?.dataset.tableId || handleEl?.closest('.canvas-table')?.id;
        const kind = handleEl?.dataset.tableDragKind;
        const sourceIndex = Number(handleEl?.dataset.index);
        if (!tableId || !tables[tableId] || !['row', 'column'].includes(kind) || !Number.isInteger(sourceIndex) || sourceIndex < 0) return false;

        const sourceStartIndex = isTableContextIndexSelected(activeTableContext, kind, sourceIndex) && activeTableContext.tableId === tableId
            ? (kind === 'row' ? getTableContextRowRange(activeTableContext)[0] : getTableContextColumnRange(activeTableContext)[0])
            : sourceIndex;
        const sourceEndIndex = isTableContextIndexSelected(activeTableContext, kind, sourceIndex) && activeTableContext.tableId === tableId
            ? (kind === 'row' ? getTableContextRowRange(activeTableContext)[1] : getTableContextColumnRange(activeTableContext)[1])
            : sourceIndex;

        activeTableStructureDrag = {
            pointerId,
            tableId,
            kind,
            sourceIndex,
            sourceStartIndex,
            sourceEndIndex,
            targetIndex: sourceIndex
        };
        applyTableStructureDropTarget(tableId, kind, sourceStartIndex, (sourceEndIndex - sourceStartIndex) + 1);
        return true;
    }

    function updateTableStructureDrag(clientX, clientY) {
        if (!activeTableStructureDrag) return false;
        const nextIndex = resolveTableStructureTargetIndex(activeTableStructureDrag.tableId, activeTableStructureDrag.kind, clientX, clientY);
        if (!Number.isInteger(nextIndex) || nextIndex < 0) return false;
        activeTableStructureDrag.targetIndex = nextIndex;
        const movedCount = (activeTableStructureDrag.sourceEndIndex - activeTableStructureDrag.sourceStartIndex) + 1;
        const previewIndex = nextIndex > activeTableStructureDrag.sourceEndIndex
            ? nextIndex - movedCount + 1
            : nextIndex;
        applyTableStructureDropTarget(activeTableStructureDrag.tableId, activeTableStructureDrag.kind, previewIndex, movedCount);
        return true;
    }

    function finishTableStructureDrag(clientX, clientY) {
        if (!activeTableStructureDrag) return false;
        updateTableStructureDrag(clientX, clientY);

        const { tableId, kind, sourceIndex, sourceStartIndex, sourceEndIndex, targetIndex } = activeTableStructureDrag;
        activeTableStructureDrag = null;
        clearTableStructureDropTargets(tableId);

        if (!tables[tableId] || !Number.isInteger(targetIndex) || targetIndex < 0) return false;
        if (targetIndex >= sourceStartIndex && targetIndex <= sourceEndIndex) return false;

        const matrix = getTableMatrix(tableId);
        let nextContext;
        const movedCount = (sourceEndIndex - sourceStartIndex) + 1;

        if (kind === 'row') {
            const movedRows = matrix.rows.splice(sourceStartIndex, movedCount);
            if (!movedRows.length) return false;
            const insertIndex = targetIndex > sourceEndIndex ? targetIndex - movedCount + 1 : targetIndex;
            matrix.rows.splice(insertIndex, 0, ...movedRows);
            tables[tableId].sortState = null;
            nextContext = {
                tableId,
                scope: 'row',
                section: 'body',
                rowIndex: insertIndex,
                rowIndexEnd: insertIndex + movedRows.length - 1,
                colIndex: Math.min(activeTableContext.colIndex || 0, matrix.header.length - 1),
                colIndexEnd: Math.min((activeTableContext.colIndexEnd ?? activeTableContext.colIndex ?? 0), matrix.header.length - 1)
            };
        } else {
            const movedHeaders = matrix.header.splice(sourceStartIndex, movedCount);
            if (!movedHeaders.length) return false;
            const insertIndex = targetIndex > sourceEndIndex ? targetIndex - movedCount + 1 : targetIndex;
            matrix.header.splice(insertIndex, 0, ...movedHeaders);
            matrix.rows.forEach(row => {
                const movedCells = row.splice(sourceStartIndex, movedCount);
                row.splice(insertIndex, 0, ...movedCells.map(cell => typeof cell === 'undefined' ? createEmptyTableCellData() : cell));
            });
            const filters = syncTableFilterState(tableId, matrix.header.length);
            const movedFilters = filters.splice(sourceStartIndex, movedCount);
            filters.splice(insertIndex, 0, ...movedFilters.map(filterValue => typeof filterValue === 'undefined' ? '' : filterValue));
            tables[tableId].filters = filters;
            const sortState = syncTableSortState(tableId, matrix.header.length);
            if (sortState) {
                if (sortState.columnIndex >= sourceStartIndex && sortState.columnIndex <= sourceEndIndex) {
                    sortState.columnIndex = insertIndex + (sortState.columnIndex - sourceStartIndex);
                } else if (sourceEndIndex < sortState.columnIndex && insertIndex <= sortState.columnIndex) {
                    sortState.columnIndex -= movedCount;
                } else if (sourceStartIndex > sortState.columnIndex && insertIndex <= sortState.columnIndex) {
                    sortState.columnIndex += movedCount;
                }
                tables[tableId].sortState = normalizeTableSortState(sortState, matrix.header.length);
            }
            nextContext = {
                tableId,
                scope: 'column',
                section: 'head',
                rowIndex: 0,
                rowIndexEnd: 0,
                colIndex: insertIndex,
                colIndexEnd: insertIndex + movedHeaders.length - 1
            };
        }

        setTableMatrix(tableId, matrix, nextContext);
        return true;
    }

    function cancelTableStructureDrag() {
        if (!activeTableStructureDrag) return;
        clearTableStructureDropTargets(activeTableStructureDrag.tableId);
        activeTableStructureDrag = null;
    }

    function getTableScopeCells(tableId, context = activeTableContext) {
        const tableData = tables[tableId];
        if (!tableData) return [];

        if (context.scope === 'cell') {
            const [rowStart, rowEnd] = getTableContextRowRange(context);
            const [colStart, colEnd] = getTableContextColumnRange(context);
            const rows = getTableRowsForSection(tableData, context.section);
            return rows
                .slice(Math.max(0, rowStart), Math.max(0, rowEnd) + 1)
                .flatMap(rowEl => Array.from(rowEl.children).filter(cell => cell.matches('th, td')).slice(colStart, colEnd + 1))
                .filter(cell => Boolean(cell));
        }

        if (context.scope === 'row') {
            const [rowStart, rowEnd] = getTableContextRowRange(context);
            const rows = context.section === 'head'
                ? getTableRowsForSection(tableData, 'head')
                : getTableBodyRows(tableData);
            return rows
                .slice(Math.max(0, rowStart), Math.max(0, rowEnd) + 1)
                .flatMap(rowEl => Array.from(rowEl.children).filter(cell => cell.matches('th, td')));
        }

        if (context.scope === 'column') {
            const [colStart, colEnd] = getTableContextColumnRange(context);
            return [...getTableRowsForSection(tableData, 'head'), ...getTableBodyRows(tableData)]
                .flatMap(rowEl => Array.from(rowEl.children).filter(cell => cell.matches('th, td')).slice(colStart, colEnd + 1))
                .filter(cell => Boolean(cell));
        }

        return [...getTableRowsForSection(tableData, 'head'), ...getTableBodyRows(tableData), ...getTableRowsForSection(tableData, 'summary')]
            .flatMap(rowEl => Array.from(rowEl.children).filter(cell => cell.matches('th, td')));
    }

    function syncActiveTableSelectionUI(tableId = null) {
        const tableIds = tableId ? [tableId] : Object.keys(tables);
        tableIds.forEach(id => {
            const tableData = tables[id];
            if (!tableData?.el) return;

            tableData.el.querySelectorAll('.table-scope-selected, .table-scope-anchor').forEach(cell => {
                cell.classList.remove('table-scope-selected', 'table-scope-anchor');
            });
            tableData.el.querySelectorAll('.table-structure-handle.scope-selected').forEach(handle => {
                handle.classList.remove('scope-selected');
            });

            if (!selectedTableIds.has(id) || activeTableContext.tableId !== id || activeTableContext.scope === 'table') return;

            getResolvedTableScopeCells(id, activeTableContext).forEach(cell => cell.classList.add('table-scope-selected'));
            const anchorCell = getTableCellByContext(id, activeTableContext);
            if (anchorCell) anchorCell.classList.add('table-scope-anchor');

            if (activeTableContext.scope === 'column') {
                const [colStart, colEnd] = getTableContextColumnRange(activeTableContext);
                for (let index = colStart; index <= colEnd; index += 1) {
                    tableData.el.querySelector(`.table-col-drag-handle[data-index="${index}"]`)?.classList.add('scope-selected');
                }
            }
            if (activeTableContext.scope === 'row') {
                const [rowStart, rowEnd] = getTableContextRowRange(activeTableContext);
                for (let index = rowStart; index <= rowEnd; index += 1) {
                    tableData.el.querySelector(`.table-row-drag-handle[data-index="${index}"]`)?.classList.add('scope-selected');
                }
            }
        });
    }

    function setTableCellScopedColor(cellEl, property, colorValue = '') {
        if (!(cellEl instanceof HTMLElement)) return;
        const attributeName = property === 'bgColor' ? 'data-cell-bg-color' : 'data-cell-text-color';
        const styleProperty = property === 'bgColor' ? 'backgroundColor' : 'color';
        const sanitizedColor = sanitizeCSSColor(colorValue);
        if (!sanitizedColor) {
            cellEl.removeAttribute(attributeName);
            cellEl.style[styleProperty] = '';
            return;
        }
        cellEl.setAttribute(attributeName, sanitizedColor);
        cellEl.style[styleProperty] = sanitizedColor;
    }

    function applySelectedTableColor(property, hexCode) {
        const tableIds = Array.from(selectedTableIds).filter(id => tables[id]);
        if (!tableIds.length) return false;

        if (tableIds.length === 1 && selectedNodes.size === 0 && activeTableContext.tableId === tableIds[0] && activeTableContext.scope !== 'table') {
            if (activeTableContext.section === 'summary') return false;
            getResolvedTableScopeCells(tableIds[0], activeTableContext).forEach(cell => setTableCellScopedColor(cell, property, hexCode));
            syncActiveTableSelectionUI(tableIds[0]);
            return true;
        }

        tableIds.forEach(id => {
            const table = tables[id];
            table[property] = hexCode;
            if (property === 'bgColor') table.el.style.backgroundColor = hexCode;
            if (property === 'textColor') table.el.style.color = hexCode;
        });
        return true;
    }

