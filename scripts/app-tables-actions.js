// Table interaction, editing, and action application.

    function getDraggedTableIds() {
        return Array.from(selectedTableIds).filter(id => tables[id]);
    }

    function getTableStructureSelectionCell(tableId, handleEl) {
        const dragKind = handleEl?.dataset.tableDragKind;
        const sourceIndex = Number(handleEl?.dataset.index);
        if (!Number.isInteger(sourceIndex) || sourceIndex < 0) return null;
        if (dragKind === 'row') {
            return getTableCellByContext(tableId, {
                section: 'body',
                rowIndex: sourceIndex,
                colIndex: Math.max(0, activeTableContext.tableId === tableId ? activeTableContext.colIndex || 0 : 0)
            });
        }
        if (dragKind === 'column') {
            return getTableCellByContext(tableId, { section: 'head', rowIndex: 0, colIndex: sourceIndex });
        }
        return null;
    }

    function getTableStructureScope(handleEl) {
        return handleEl?.dataset.tableDragKind === 'column' ? 'column' : 'row';
    }

    function handleTablePointerDown(e) {
        const tableId = e.currentTarget.id;
        const table = tables[tableId];
        const cell = e.target.closest('th, td');
        const structureHandle = e.target.closest('.table-structure-handle');
        const filterControl = e.target.closest('.table-filter-btn, .table-filter-menu, .table-summary-menu');
        if (!table) return;
        pendingTableEditContext = null;
        if (e.button === 2) {
            hasPanned = false;
            if (structureHandle) {
                setActiveTableContext(tableId, getTableStructureSelectionCell(tableId, structureHandle), {
                    scope: getTableStructureScope(structureHandle)
                });
            } else {
                setActiveTableContext(tableId, cell, { scope: cell ? 'cell' : 'table' });
            }
            return;
        }

        if (filterControl) {
            if (!selectedTableIds.has(tableId) || selectedTableIds.size !== 1) {
                clearSelection();
                addTableToSelection(tableId);
            }
            if (e.target.closest('.table-filter-btn')) {
                setActiveTableContext(tableId, getTableCellByContext(tableId, { section: 'head', rowIndex: 0, colIndex: Number(e.target.closest('.table-filter-btn')?.dataset.filterIndex) || 0 }), { scope: 'column' });
            } else {
                setActiveTableContext(tableId, null, { scope: 'table' });
            }
            commitActiveInlineEditors(e.target);
            setCanvasSelectionSuppressed(false);
            return;
        }

        if (structureHandle) {
            if (!selectedTableIds.has(tableId) || selectedTableIds.size !== 1) {
                clearSelection();
                addTableToSelection(tableId);
            }
            const structureScope = getTableStructureScope(structureHandle);
            const handleIndex = Number(structureHandle.dataset.index);
            const existingStructureContext = activeTableContext.tableId === tableId && activeTableContext.scope === structureScope
                ? activeTableContext
                : null;
            if (e.shiftKey && existingStructureContext && Number.isInteger(handleIndex) && handleIndex >= 0) {
                applyActiveTableContext(structureScope === 'row'
                    ? {
                        tableId,
                        scope: structureScope,
                        section: 'body',
                        rowIndex: existingStructureContext.rowIndex,
                        colIndex: Math.max(0, existingStructureContext.colIndex || 0),
                        rowIndexEnd: handleIndex,
                        colIndexEnd: existingStructureContext.colIndexEnd ?? existingStructureContext.colIndex
                    }
                    : {
                        tableId,
                        scope: structureScope,
                        section: 'head',
                        rowIndex: 0,
                        rowIndexEnd: 0,
                        colIndex: existingStructureContext.colIndex,
                        colIndexEnd: handleIndex
                    });
                commitActiveInlineEditors(structureHandle);
                e.preventDefault();
                setCanvasSelectionSuppressed(false);
                currentMode = 'IDLE';
                return;
            }
            const shouldPreserveRange = existingStructureContext && isTableContextIndexSelected(existingStructureContext, structureScope, handleIndex);
            if (shouldPreserveRange) {
                applyActiveTableContext({ ...existingStructureContext });
            } else {
                setActiveTableContext(
                    tableId,
                    getTableStructureSelectionCell(tableId, structureHandle),
                    structureScope === 'row'
                        ? {
                            scope: structureScope,
                            rowIndexEnd: handleIndex
                        }
                        : {
                            scope: structureScope,
                            colIndexEnd: handleIndex
                        }
                );
            }
            commitActiveInlineEditors(structureHandle);
            e.preventDefault();
            clearTextSelection();
            setCanvasSelectionSuppressed(true);
            isDragging = false;
            if (!startTableStructureDrag(structureHandle, e.pointerId)) {
                setCanvasSelectionSuppressed(false);
                return;
            }
            currentMode = 'DRAG_TABLE_STRUCTURE';
            lastPoint = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
        }

        if (e.target.closest('.table-add-btn')) {
            setActiveTableContext(tableId, null, { scope: 'table' });
            commitActiveInlineEditors(e.target);
            setCanvasSelectionSuppressed(false);
            return;
        }
        if (!table.el.classList.contains('editing') && e.target.closest('a')) {
            setActiveTableContext(tableId, cell, { scope: cell ? 'cell' : 'table' });
            setCanvasSelectionSuppressed(false);
            return;
        }

        if (table.el.classList.contains('editing') && cell && cell.isContentEditable) {
            setActiveTableContext(tableId, cell, { scope: 'cell' });
            window.requestAnimationFrame(() => {
                if (editingTableId !== tableId || !tables[tableId]?.el.contains(cell)) return;
                ensureTableCellSelection(cell);
            });
            setCanvasSelectionSuppressed(false);
            return;
        }

        commitActiveInlineEditors(e.target);
        e.preventDefault();
        clearTextSelection();
        setCanvasSelectionSuppressed(true);
        if (e.pointerType === 'touch') {
            trackActivePointer(e);
            e.currentTarget.setPointerCapture(e.pointerId);
            queueLongPressContextMenu(e);
            if (beginTouchGesture()) return;
        }

        const isTableSelected = selectedTableIds.has(tableId);
        const wasOnlySelectedTable = selectedTableIds.size === 1 && selectedTableIds.has(tableId) && selectedNodes.size === 0 && selectedConnectionIndexes.size === 0;
        const activeCellContext = activeTableContext.tableId === tableId && activeTableContext.scope === 'cell'
            ? activeTableContext
            : null;
        const clickedCellContext = cell ? getTableCellContext(tableId, cell, { scope: 'cell' }) : null;
        isDragging = false;
        const isToggleModifier = e.ctrlKey || e.metaKey;
        const isModifierSelect = e.shiftKey || isToggleModifier;
        if (isModifierSelect) {
            const existingCellContext = activeTableContext.tableId === tableId && activeTableContext.scope === 'cell'
                ? activeTableContext
                : null;
            const nextCellContext = cell ? getTableCellContext(tableId, cell, { scope: 'cell' }) : null;
            if (e.shiftKey && nextCellContext && existingCellContext && existingCellContext.section === nextCellContext.section) {
                addTableToSelection(tableId);
                applyActiveTableContext({
                    tableId,
                    scope: 'cell',
                    section: existingCellContext.section,
                    rowIndex: existingCellContext.rowIndex,
                    rowIndexEnd: nextCellContext.rowIndex,
                    colIndex: existingCellContext.colIndex,
                    colIndexEnd: nextCellContext.colIndex
                });
                setCanvasSelectionSuppressed(false);
                currentMode = 'IDLE';
                return;
            }

            const canToggleCellSelection = Boolean(
                isToggleModifier
                && nextCellContext
                && selectedNodes.size === 0
                && selectedConnectionIndexes.size === 0
                && (
                    selectedTableIds.size === 0
                    || (selectedTableIds.size === 1 && selectedTableIds.has(tableId))
                )
            );
            if (canToggleCellSelection) {
                if (!isTableSelected || selectedTableIds.size !== 1) {
                    clearSelection();
                    addTableToSelection(tableId);
                    setActiveTableContext(tableId, cell, { scope: 'cell' });
                } else {
                    toggleActiveTableCellSelection(nextCellContext);
                }
            } else if (isTableSelected && isToggleModifier) removeTableFromSelection(tableId);
            else {
                addTableToSelection(tableId);
                setActiveTableContext(tableId, cell, { scope: cell ? 'cell' : 'table' });
            }
            setCanvasSelectionSuppressed(false);
            currentMode = 'IDLE';
            return;
        }

        if (!isTableSelected) {
            clearSelection();
            addTableToSelection(tableId);
        } else if (
            wasOnlySelectedTable
            && clickedCellContext
            && isSingleTableCellContext(activeCellContext)
            && isSameTableCellContext(activeCellContext, clickedCellContext)
        ) {
            pendingTableEditContext = clickedCellContext;
        }
        setActiveTableContext(tableId, cell, { scope: cell ? 'cell' : 'table' });
        currentMode = 'DRAG_TABLE';
        lastPoint = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function handleTableDoubleClick(e) {
        const tableId = e.currentTarget.id;
        const cell = e.target.closest('th, td');
        if (!tables[tableId]) return;
        clearSelection();
        addTableToSelection(tableId);
        setActiveTableContext(tableId, cell, { scope: 'cell' });
        if (isTableSummaryRowElement(cell?.closest('tr'))) return;
        beginTableEditing(tableId, cell);
    }

    function getActiveEditingTableElement() {
        return editingTableId && tables[editingTableId] ? tables[editingTableId].el : null;
    }

    function getActiveEditingTableCell() {
        const activeElement = document.activeElement;
        return activeElement instanceof HTMLElement ? activeElement.closest('.canvas-table.editing th, .canvas-table.editing td') : null;
    }

    function getTableCellSelectionRange(cell = getActiveEditingTableCell()) {
        const selection = window.getSelection();
        if (!cell || !selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        if (!cell.contains(range.commonAncestorContainer)) return null;
        return range;
    }

    function placeTableCellCaretAtEnd(cell) {
        if (!cell) return;
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function ensureTableCellSelection(cell) {
        if (!cell) return false;
        cell.focus();
        if (!getTableCellSelectionRange(cell)) placeTableCellCaretAtEnd(cell);
        return true;
    }

    function setTableCellEditing(tableId, isEditable) {
        const tableData = tables[tableId];
        if (!tableData) return;
        tableData.el.querySelectorAll('th, td').forEach(cell => {
            const isSummaryCell = isTableSummaryRowElement(cell.closest('tr'));
            cell.contentEditable = isEditable && !isSummaryCell ? 'true' : 'false';
            if (!isEditable) cell.blur();
        });
    }

    function beginTableEditing(tableId, targetCell = null) {
        const tableData = tables[tableId];
        if (!tableData) return false;

        stopEditingLabel(getActiveEditingLabel());
        if (editingConnectionIndex !== null) finishConnectionLabelEditing(true, true);
        if (editingTableId !== null && editingTableId !== tableId) finishTableEditing(true, true);

        editingTableId = tableId;
        tableData.el.classList.add('editing');
        setTableCellEditing(tableId, true);

        const focusCell = targetCell && tableData.el.contains(targetCell)
            ? targetCell
            : tableData.el.querySelector('tbody td, thead th, td, th');
        if (focusCell instanceof HTMLElement) {
            ensureTableCellSelection(focusCell);
            setActiveTableContext(tableId, focusCell, { scope: 'cell' });
        }

        updateToolbarColors();
        return true;
    }

    function finishTableEditing(commitChanges = true, recordHistory = true) {
        if (!editingTableId || !tables[editingTableId]) return false;
        const tableId = editingTableId;
        const tableData = tables[tableId];
        const nextHtml = sanitizeCanvasTableHTML(getTableGrid(tableData)?.outerHTML || '');

        setTableCellEditing(tableId, false);
        tableData.el.classList.remove('editing');
        editingTableId = null;
        if (commitChanges) setTableMarkup(tableData, nextHtml);

        if (recordHistory) saveHistoryState();
        else scheduleAutosave();
        updateToolbarColors();
        return true;
    }

    function getTableCellContext(tableId, cellEl = null, options = {}) {
        const tableData = tables[tableId];
        if (!tableData) return null;

        const scope = options.scope || (cellEl ? 'cell' : 'table');

        const selectedCell = cellEl && tableData.el.contains(cellEl)
            ? cellEl
            : tableData.el.querySelector('tbody td, tbody th, thead th, thead td, td, th');
        if (!(selectedCell instanceof HTMLElement)) {
            return { tableId, scope, section: 'body', rowIndex: 0, rowIndexEnd: 0, colIndex: 0, colIndexEnd: 0 };
        }

        const rowEl = selectedCell.closest('tr');
        const sectionEl = selectedCell.closest('thead, tbody');
        const section = isTableSummaryRowElement(rowEl)
            ? 'summary'
            : sectionEl?.tagName.toLowerCase() === 'thead'
                ? 'head'
                : 'body';
        const rows = section === 'summary'
            ? [rowEl]
            : Array.from(sectionEl?.querySelectorAll(':scope > tr') || [rowEl])
                .filter(Boolean)
                .filter(row => !isTableSummaryRowElement(row));
        const cells = Array.from(rowEl?.children || []).filter(cell => cell.matches('th, td'));

        return {
            tableId,
            scope,
            section,
            rowIndex: Math.max(0, rows.indexOf(rowEl)),
            rowIndexEnd: Number.isInteger(options.rowIndexEnd) ? options.rowIndexEnd : Math.max(0, rows.indexOf(rowEl)),
            colIndex: Math.max(0, cells.indexOf(selectedCell)),
            colIndexEnd: Number.isInteger(options.colIndexEnd) ? options.colIndexEnd : Math.max(0, cells.indexOf(selectedCell))
        };
    }

    function isSingleTableCellContext(context = null) {
        return Boolean(
            context
            && context.scope === 'cell'
            && (context.rowIndexEnd ?? context.rowIndex) === context.rowIndex
            && (context.colIndexEnd ?? context.colIndex) === context.colIndex
        );
    }

    function isSameTableCellContext(a = null, b = null) {
        return Boolean(
            a
            && b
            && a.tableId === b.tableId
            && a.section === b.section
            && a.rowIndex === b.rowIndex
            && a.colIndex === b.colIndex
        );
    }

    function toggleActiveTableCellSelection(cellContext = null) {
        const normalizedCellContext = normalizeTableSelectionContext(cellContext);
        if (!isSingleTableCellContext(normalizedCellContext)) return false;

        const activeSelectionContext = activeTableContext.tableId === normalizedCellContext.tableId && activeTableContext.scope === 'cell'
            ? activeTableContext
            : null;
        if (!activeSelectionContext || activeSelectionContext.section !== normalizedCellContext.section) {
            applyActiveTableContext(normalizedCellContext);
            return true;
        }

        const nextAdditionalContexts = normalizeActiveTableAdditionalCellContexts(activeTableAdditionalCellContexts, activeSelectionContext);
        const existingAdditionalIndex = nextAdditionalContexts.findIndex(context => isSameTableCellContext(context, normalizedCellContext));
        if (existingAdditionalIndex >= 0) {
            nextAdditionalContexts.splice(existingAdditionalIndex, 1);
            applyActiveTableContext(activeSelectionContext, {
                preserveAdditionalCellContexts: true,
                additionalCellContexts: nextAdditionalContexts
            });
            return true;
        }

        if (isTableCellContextWithinScope(activeSelectionContext, normalizedCellContext)) {
            if (!isSingleTableCellContext(activeSelectionContext) || !nextAdditionalContexts.length) return true;
            const nextPrimaryContext = nextAdditionalContexts.pop();
            applyActiveTableContext(nextPrimaryContext, {
                preserveAdditionalCellContexts: true,
                additionalCellContexts: nextAdditionalContexts
            });
            return true;
        }

        nextAdditionalContexts.push(normalizedCellContext);
        applyActiveTableContext(activeSelectionContext, {
            preserveAdditionalCellContexts: true,
            additionalCellContexts: nextAdditionalContexts
        });
        return true;
    }

    function applyActiveTableContext(nextContext = null, options = {}) {
        const normalizedContext = normalizeTableSelectionContext(nextContext);
        activeTableContext = nextContext ? normalizedContext : getDefaultActiveTableContext();
        activeTableAdditionalCellContexts = options.preserveAdditionalCellContexts
            ? normalizeActiveTableAdditionalCellContexts(options.additionalCellContexts || activeTableAdditionalCellContexts, activeTableContext)
            : [];
        syncActiveTableSelectionUI();
        updateToolbarColors();
        return activeTableContext;
    }

    function setActiveTableContext(tableId = null, cellEl = null, options = {}) {
        const { preserveAdditionalCellContexts = false, ...contextOptions } = options;
        return applyActiveTableContext(tableId && tables[tableId]
            ? getTableCellContext(tableId, cellEl, contextOptions)
            : null, { preserveAdditionalCellContexts });
    }

    function getResolvedTableActionContext(explicitTableId = null) {
        if (explicitTableId && tables[explicitTableId]) {
            if (activeTableContext.tableId === explicitTableId) return activeTableContext;
            return getTableCellContext(explicitTableId, null, { scope: 'table' });
        }
        if (activeTableContext.tableId && selectedTableIds.has(activeTableContext.tableId) && tables[activeTableContext.tableId]) {
            return activeTableContext;
        }
        const selectedTable = getSelectedTableEntry();
        return selectedTable ? getTableCellContext(selectedTable.id, null, { scope: 'table' }) : null;
    }

    function getTableCellByContext(tableId, context = {}) {
        const tableData = tables[tableId];
        if (!tableData) return null;

        const rows = getTableRowsForSection(tableData, context.section);
        const rowEl = rows[Math.max(0, Math.min(context.rowIndex || 0, rows.length - 1))];
        if (!rowEl) return null;

        const cells = Array.from(rowEl.children).filter(cell => cell.matches('th, td'));
        return cells[Math.max(0, Math.min(context.colIndex || 0, cells.length - 1))] || null;
    }

    function getEditableTableCellContext(context = null) {
        const resolvedContext = context || getResolvedTableActionContext();
        if (!resolvedContext || !tables[resolvedContext.tableId]) return null;
        if (resolvedContext.section === 'summary') return null;

        if (resolvedContext.scope === 'column') {
            return {
                tableId: resolvedContext.tableId,
                scope: 'cell',
                section: 'head',
                rowIndex: 0,
                colIndex: resolvedContext.colIndex
            };
        }

        if (resolvedContext.scope === 'row') {
            return {
                tableId: resolvedContext.tableId,
                scope: 'cell',
                section: 'body',
                rowIndex: resolvedContext.rowIndex,
                colIndex: resolvedContext.colIndex
            };
        }

        if (resolvedContext.scope === 'table') {
            return {
                tableId: resolvedContext.tableId,
                scope: 'cell',
                section: 'body',
                rowIndex: 0,
                colIndex: 0
            };
        }

        return { ...resolvedContext, scope: 'cell' };
    }

    function getDefaultTableActionContext(tableId, action) {
        const matrix = getTableMatrix(tableId);
        if (action === 'add-column' || action === 'add-column-end') {
            return {
                tableId,
                scope: 'column',
                section: 'head',
                rowIndex: 0,
                colIndex: Math.max(0, matrix.header.length - 1)
            };
        }
        return {
            tableId,
            scope: 'row',
            section: 'body',
            rowIndex: Math.max(0, matrix.rows.length - 1),
            colIndex: Math.max(0, matrix.header.length - 1)
        };
    }

    function setTableMatrix(tableId, matrix, focusContext = null) {
        const tableData = tables[tableId];
        if (!tableData) return false;

        const wasEditing = editingTableId === tableId;
        tableData.filters = normalizeTableFilters(tableData.filters, matrix.header.length);
        tableData.sortState = normalizeTableSortState(tableData.sortState, matrix.header.length);
        setTableMarkup(tableData, buildTableHTMLFromMatrix(matrix));
        invalidateCachedElementSizes();
        if (wasEditing) {
            beginTableEditing(tableId, getTableCellByContext(tableId, focusContext || { section: 'body', rowIndex: 0, colIndex: 0 }));
        } else {
            const focusCell = getTableCellByContext(tableId, focusContext || { section: 'body', rowIndex: 0, colIndex: 0 });
            setActiveTableContext(tableId, focusCell, { scope: focusContext?.scope || (focusCell ? 'cell' : 'table') });
        }
        return true;
    }

    function getTableMatrix(tableId) {
        return extractTableMatrix(getTableGrid(tableId));
    }

    function insertTableCellHTML(cell, html) {
        if (!cell || !ensureTableCellSelection(cell)) return false;
        const didInsert = document.execCommand ? document.execCommand('insertHTML', false, html) : false;
        if (!didInsert) {
            const range = getTableCellSelectionRange(cell);
            if (!range) return false;
            const template = document.createElement('template');
            template.innerHTML = html;
            const fragment = template.content.cloneNode(true);
            range.deleteContents();
            range.insertNode(fragment);
            placeTableCellCaretAtEnd(cell);
        }
        cell.innerHTML = sanitizeRichTextHTML(cell.innerHTML, { allowTables: false });
        return true;
    }

    function beginTableKeyboardEditing(inputText = '', options = {}) {
        const editableContext = getEditableTableCellContext();
        if (!editableContext) return false;

        const cell = getTableCellByContext(editableContext.tableId, editableContext);
        if (!cell) return false;

        beginTableEditing(editableContext.tableId, cell);
        if (!ensureTableCellSelection(cell)) return false;

        if (options.replaceContents) {
            cell.innerHTML = '';
            placeTableCellCaretAtEnd(cell);
        }

        if (inputText) {
            const didInsert = document.execCommand ? document.execCommand('insertText', false, inputText) : false;
            if (!didInsert) {
                const range = getTableCellSelectionRange(cell);
                if (!range) return false;
                range.deleteContents();
                range.insertNode(document.createTextNode(inputText));
                placeTableCellCaretAtEnd(cell);
            }
            cell.innerHTML = sanitizeRichTextHTML(cell.innerHTML, { allowTables: false });
        }

        setActiveTableContext(editableContext.tableId, cell, { scope: 'cell' });
        return true;
    }

    function placeSelectionAfterTableNode(node) {
        const selection = window.getSelection();
        if (!(node instanceof Node) || !selection) return false;
        const range = document.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
    }

    function insertTableLinkAtRange(cell, range, href, fallbackText = '') {
        if (!(cell instanceof HTMLElement)) return false;

        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer noopener';

        if (range) {
            if (!cell.contains(range.startContainer) || !cell.contains(range.endContainer)) return false;

            if (!range.collapsed) {
                const fragment = range.extractContents();
                if (fragment.childNodes.length) {
                    anchor.appendChild(fragment);
                } else {
                    anchor.textContent = fallbackText || href;
                }
                range.insertNode(anchor);
                placeSelectionAfterTableNode(anchor);
                return true;
            }

            anchor.textContent = fallbackText || href;
            range.insertNode(anchor);
            placeSelectionAfterTableNode(anchor);
            return true;
        }

        return insertTableCellHTML(cell, `<a href="${escapeHTML(href)}" target="_blank" rel="noreferrer noopener">${escapeHTML(fallbackText || href)}</a>`);
    }

    async function insertTableLink(explicitTableId = null) {
        const activeCell = getActiveEditingTableCell();
        const activeTableId = activeCell?.closest('.canvas-table')?.id || null;
        const activeCellMatchesTarget = activeCell
            && activeTableId
            && (!explicitTableId || explicitTableId === activeTableId)
            && tables[activeTableId]
            && selectedTableIds.has(activeTableId);
        const context = activeCellMatchesTarget
            ? getTableCellContext(activeTableId, activeCell, { scope: 'cell' })
            : getResolvedTableActionContext(explicitTableId);
        if (!context || !tables[context.tableId]) return false;

        const targetContext = getTableCellContext(
            context.tableId,
            activeCellMatchesTarget ? activeCell : getTableCellByContext(context.tableId, context),
            { scope: 'cell' }
        );
        if (!targetContext) return false;

        let cell = getTableCellByContext(targetContext.tableId, targetContext);
        if (!(cell instanceof HTMLElement)) return false;

        const preservedRange = getClonedSelectionRangeWithin(cell);
        const preservedText = preservedRange && !preservedRange.collapsed ? preservedRange.toString() : '';
        if (editingTableId !== targetContext.tableId || !cell.isContentEditable) {
            beginTableEditing(targetContext.tableId, cell);
            cell = getTableCellByContext(targetContext.tableId, targetContext) || cell;
            if (!(cell instanceof HTMLElement)) return false;
        }
        if (!preservedRange && !ensureTableCellSelection(cell)) return false;

        // Suspend focus-commit handling while the modal is open, matching the
        // previous synchronous window.prompt behavior.
        suspendedTableFocusCommitCount += 1;
        let urlInput;
        try {
            urlInput = await showModalPrompt({ title: 'Insert link', defaultValue: 'https://', confirmLabel: 'Insert' });
        } finally {
            suspendedTableFocusCommitCount = Math.max(0, suspendedTableFocusCommitCount - 1);
        }
        const href = sanitizeRichTextHref(urlInput || '');
        if (!href) {
            if (tables[targetContext.tableId]) {
                cell = getTableCellByContext(targetContext.tableId, targetContext) || cell;
                if (cell instanceof HTMLElement) {
                    ensureTableCellSelection(cell);
                    setActiveTableContext(targetContext.tableId, cell, { scope: 'cell' });
                }
            }
            return false;
        }

        if (editingTableId !== targetContext.tableId || !tables[targetContext.tableId]) {
            beginTableEditing(targetContext.tableId, getTableCellByContext(targetContext.tableId, targetContext));
        }
        cell = getTableCellByContext(targetContext.tableId, targetContext) || cell;
        if (!(cell instanceof HTMLElement)) return false;

        const range = preservedRange && cell.contains(preservedRange.startContainer) && cell.contains(preservedRange.endContainer)
            ? preservedRange.cloneRange()
            : (ensureTableCellSelection(cell) ? getTableCellSelectionRange(cell) : null);
        const selectedText = range && !range.collapsed ? range.toString() : preservedText;
        if (!insertTableLinkAtRange(cell, range, href, selectedText || href)) return false;

        cell.innerHTML = sanitizeRichTextHTML(cell.innerHTML, { allowTables: false });
        setActiveTableContext(targetContext.tableId, cell, { scope: 'cell' });
        saveHistoryState();
        return true;
    }

    function canApplyTableAction(action, context = null) {
        const normalizedAction = action === 'add-row-end' ? 'add-row' : action === 'add-column-end' ? 'add-column' : action;
        const resolvedContext = context || getResolvedTableActionContext();
        if (!resolvedContext || !tables[resolvedContext.tableId]) return false;
        const matrix = getTableMatrix(resolvedContext.tableId);
        const isSummaryContext = resolvedContext.section === 'summary';
        if (normalizedAction === 'add-row' || normalizedAction === 'add-column' || normalizedAction === 'toggle-filters' || normalizedAction === 'paste-markdown-table' || normalizedAction === 'add-summary-row') return true;
        if (normalizedAction === 'insert-link') return !isSummaryContext;
        if (normalizedAction === 'clear-filters') return syncTableFilterState(resolvedContext.tableId, matrix.header.length).some(Boolean);
        if (normalizedAction === 'clear-cell-styles') return !isSummaryContext && getResolvedTableScopeCells(resolvedContext.tableId, resolvedContext).some(cell => getTableCellScopedColor(cell, 'bgColor') || getTableCellScopedColor(cell, 'textColor'));
        if (normalizedAction === 'duplicate-row') return resolvedContext.section === 'body' && matrix.rows.length > 0;
        if (normalizedAction === 'duplicate-column') return matrix.header.length > 0;
        if (normalizedAction === 'delete-row') return resolvedContext.section === 'body' && matrix.rows.length > 1;
        if (normalizedAction === 'delete-column') return matrix.header.length > 1;
        return false;
    }

    function applyTableAction(action, explicitTableId = null, triggerEl = null) {
        if (explicitTableId && tables[explicitTableId] && !selectedTableIds.has(explicitTableId)) {
            clearSelection();
            addTableToSelection(explicitTableId);
        }
        const normalizedAction = action === 'add-row-end' ? 'add-row' : action === 'add-column-end' ? 'add-column' : action;
        const context = explicitTableId && tables[explicitTableId]
            ? getDefaultTableActionContext(explicitTableId, action)
            : getResolvedTableActionContext();
        if (!canApplyTableAction(normalizedAction, context)) return false;

        if (normalizedAction === 'insert-link') {
            return insertTableLink(explicitTableId || context.tableId);
        }
        if (normalizedAction === 'add-summary-row') {
            return addTableSummaryRow(explicitTableId || context.tableId, triggerEl);
        }
        if (normalizedAction === 'paste-markdown-table') {
            return pasteMarkdownTableIntoTable(explicitTableId || context.tableId);
        }
        if (normalizedAction === 'toggle-filters') {
            return toggleTableFilters(explicitTableId || context.tableId);
        }
        if (normalizedAction === 'clear-filters') {
            return clearTableFilters(explicitTableId || context.tableId, { recordHistory: true });
        }
        if (normalizedAction === 'clear-cell-styles') {
            return clearTableScopeStyles(explicitTableId || context.tableId, context, { recordHistory: true });
        }

        const matrix = getTableMatrix(context.tableId);
        const tableData = tables[context.tableId];
        const filters = syncTableFilterState(tableData, matrix.header.length);
        const sortState = syncTableSortState(tableData, matrix.header.length);
        let nextSortState = sortState ? { ...sortState } : null;
        let nextContext = { ...context };

        if (normalizedAction === 'add-row') {
            const insertIndex = context.section === 'body'
                ? context.rowIndex + 1
                : context.section === 'summary'
                    ? matrix.rows.length
                    : 0;
            matrix.rows.splice(insertIndex, 0, Array.from({ length: matrix.header.length }, () => createEmptyTableCellData()));
            nextSortState = null;
            nextContext = {
                tableId: context.tableId,
                scope: context.scope === 'cell' ? 'cell' : 'row',
                section: 'body',
                rowIndex: insertIndex,
                colIndex: context.colIndex
            };
        }

        if (normalizedAction === 'add-column') {
            const insertIndex = Math.min(matrix.header.length, context.colIndex + 1);
            matrix.header.splice(insertIndex, 0, createEmptyTableCellData());
            matrix.rows.forEach(row => row.splice(insertIndex, 0, createEmptyTableCellData()));
            filters.splice(insertIndex, 0, '');
            if (nextSortState && insertIndex <= nextSortState.columnIndex) nextSortState.columnIndex += 1;
            nextContext = {
                tableId: context.tableId,
                scope: context.scope === 'cell' ? 'cell' : 'column',
                section: context.scope === 'cell'
                    ? (context.section === 'summary' ? 'body' : context.section)
                    : 'head',
                rowIndex: context.scope === 'cell' && context.section !== 'summary' ? context.rowIndex : 0,
                colIndex: insertIndex
            };
        }

        if (normalizedAction === 'duplicate-row') {
            const sourceRow = matrix.rows[context.rowIndex];
            if (!Array.isArray(sourceRow)) return false;
            const insertIndex = Math.min(matrix.rows.length, context.rowIndex + 1);
            matrix.rows.splice(insertIndex, 0, cloneTableRowData(sourceRow, matrix.header.length));
            nextSortState = null;
            nextContext = {
                tableId: context.tableId,
                scope: context.scope === 'cell' ? 'cell' : 'row',
                section: 'body',
                rowIndex: insertIndex,
                colIndex: Math.min(context.colIndex, matrix.header.length - 1)
            };
        }

        if (normalizedAction === 'duplicate-column') {
            const sourceHeaderCell = matrix.header[context.colIndex];
            if (typeof sourceHeaderCell === 'undefined') return false;
            const insertIndex = Math.min(matrix.header.length, context.colIndex + 1);
            matrix.header.splice(insertIndex, 0, cloneTableCellData(sourceHeaderCell));
            matrix.rows.forEach(row => {
                row.splice(insertIndex, 0, cloneTableCellData(row[context.colIndex] || createEmptyTableCellData()));
            });
            filters.splice(insertIndex, 0, '');
            if (nextSortState && insertIndex <= nextSortState.columnIndex) nextSortState.columnIndex += 1;
            nextContext = {
                tableId: context.tableId,
                scope: context.scope === 'cell' ? 'cell' : 'column',
                section: context.scope === 'cell' ? context.section : 'head',
                rowIndex: context.scope === 'cell' ? context.rowIndex : 0,
                colIndex: insertIndex
            };
        }

        if (normalizedAction === 'delete-row') {
            const [rowStart, rowEnd] = getTableContextRowRange(context);
            const deleteStart = Math.max(0, Math.min(rowStart, matrix.rows.length - 1));
            const deleteEnd = Math.max(deleteStart, Math.min(rowEnd, matrix.rows.length - 1));
            const deletedCount = (deleteEnd - deleteStart) + 1;
            matrix.rows.splice(deleteStart, deletedCount);
            nextSortState = null;
            nextContext = {
                tableId: context.tableId,
                scope: context.scope === 'cell' ? 'cell' : 'row',
                section: 'body',
                rowIndex: Math.max(0, Math.min(deleteStart, matrix.rows.length - 1)),
                colIndex: Math.min(context.colIndex, matrix.header.length - 1)
            };
        }

        if (normalizedAction === 'delete-column') {
            matrix.header.splice(context.colIndex, 1);
            matrix.rows.forEach(row => row.splice(context.colIndex, 1));
            filters.splice(context.colIndex, 1);
            if (nextSortState) {
                if (nextSortState.columnIndex === context.colIndex) nextSortState = null;
                else if (context.colIndex < nextSortState.columnIndex) nextSortState.columnIndex -= 1;
            }
            nextContext = {
                tableId: context.tableId,
                scope: context.scope === 'cell' ? 'cell' : 'column',
                section: context.scope === 'cell' ? context.section : 'head',
                rowIndex: context.scope === 'cell' ? context.rowIndex : 0,
                colIndex: Math.max(0, Math.min(context.colIndex, matrix.header.length - 1))
            };
        }

        tableData.filters = normalizeTableFilters(filters, matrix.header.length);
        tableData.sortState = normalizeTableSortState(nextSortState, matrix.header.length);
        setTableMatrix(context.tableId, matrix, nextContext);
        saveHistoryState();
        return true;
    }

    function getContextMenuTargetTableId() {
        if (contextMenuTableId && tables[contextMenuTableId]) return contextMenuTableId;
        if (activeTableContext.tableId && tables[activeTableContext.tableId]) return activeTableContext.tableId;
        const selectedTable = getSelectedTableEntry();
        return selectedTable?.id || null;
    }
