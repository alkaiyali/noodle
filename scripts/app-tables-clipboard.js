// Table clipboard, summary, and import helpers.

    function getTableScopeCellMatrix(tableId, context = activeTableContext) {
        const tableData = tables[tableId];
        if (!tableData || !context || context.tableId !== tableId) return [];

        if (context.scope === 'cell') {
            const [rowStart, rowEnd] = getTableContextRowRange(context);
            const [colStart, colEnd] = getTableContextColumnRange(context);
            const rows = getTableRowsForSection(tableData, context.section);
            return rows
                .slice(Math.max(0, rowStart), Math.max(0, rowEnd) + 1)
                .map(rowEl => Array.from(rowEl.children).filter(cell => cell.matches('th, td')).slice(colStart, colEnd + 1))
                .filter(row => row.length > 0);
        }

        if (context.scope === 'row') {
            const [rowStart, rowEnd] = getTableContextRowRange(context);
            const rows = getTableBodyRows(tableData);
            return rows
                .slice(rowStart, rowEnd + 1)
                .map(rowEl => Array.from(rowEl.children).filter(cell => cell.matches('th, td')))
                .filter(row => row.length > 0);
        }

        if (context.scope === 'column') {
            const [colStart, colEnd] = getTableContextColumnRange(context);
            return [...getTableRowsForSection(tableData, 'head'), ...getTableBodyRows(tableData)]
                .map(rowEl => Array.from(rowEl.children).filter(cell => cell.matches('th, td')).slice(colStart, colEnd + 1))
                .filter(row => row.length > 0);
        }

        return [...getTableRowsForSection(tableData, 'head'), ...getTableBodyRows(tableData), ...getTableRowsForSection(tableData, 'summary')]
            .map(rowEl => Array.from(rowEl.children).filter(cell => cell.matches('th, td')))
            .filter(row => row.length > 0);
    }

    function buildTableScopeClipboardText(tableId, context = activeTableContext) {
        if (context?.tableId === tableId && context.scope === 'cell') {
            const positions = getResolvedTableSelectionCellPositions(tableId, context);
            if (positions.length) {
                const rowStart = Math.min(...positions.map(position => position.rowIndex));
                const rowEnd = Math.max(...positions.map(position => position.rowIndex));
                const colStart = Math.min(...positions.map(position => position.colIndex));
                const colEnd = Math.max(...positions.map(position => position.colIndex));
                const cellTextByKey = new Map();
                positions.forEach(position => {
                    const key = `${position.section}:${position.rowIndex}:${position.colIndex}`;
                    const cell = getTableCellByContext(tableId, position);
                    cellTextByKey.set(key, String(cell?.textContent || '').replace(/\s+/g, ' ').trim());
                });
                return Array.from({ length: rowEnd - rowStart + 1 }, (_, rowOffset) => Array.from({ length: colEnd - colStart + 1 }, (_, colOffset) => (
                    cellTextByKey.get(`${positions[0].section}:${rowStart + rowOffset}:${colStart + colOffset}`) || ''
                )).join('\t')).join('\n').trim();
            }
        }
        return getTableScopeCellMatrix(tableId, context)
            .map(row => row.map(cell => String(cell?.textContent || '').replace(/\s+/g, ' ').trim()).join('\t'))
            .join('\n')
            .trim();
    }

    function parseTableClipboardMatrix(text = '') {
        const normalizedText = String(text ?? '').replace(/\r\n?/g, '\n');
        if (!normalizedText) return [];
        const rows = normalizedText.split('\n');
        if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
        return rows.map(row => row.split('\t'));
    }

    function buildPastedTableCellData(text = '', cellData = '') {
        const normalizedExistingCellData = normalizeTableCellData(cellData);
        return {
            html: text ? normalizeTableCellHTML(escapeHTML(String(text))) : '',
            bgColor: normalizedExistingCellData.bgColor,
            textColor: normalizedExistingCellData.textColor
        };
    }

    function normalizeMarkdownTableClipboardText(text = '') {
        const normalizedText = String(text ?? '').replace(/\r\n?/g, '\n').trim();
        if (!normalizedText) return '';
        const fencedMarkdownMatch = normalizedText.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
        return fencedMarkdownMatch ? fencedMarkdownMatch[1].trim() : normalizedText;
    }

    function splitMarkdownTableCells(rowText = '') {
        const trimmedLine = String(rowText ?? '').trim();
        if (!trimmedLine) return [];

        const normalizedLine = trimmedLine.replace(/^\|/, '').replace(/\|$/, '');
        const cells = [];
        let currentCell = '';

        for (let index = 0; index < normalizedLine.length; index += 1) {
            const character = normalizedLine[index];
            if (character === '\\' && normalizedLine[index + 1] === '|') {
                currentCell += '|';
                index += 1;
                continue;
            }
            if (character === '|') {
                cells.push(currentCell.trim());
                currentCell = '';
                continue;
            }
            currentCell += character;
        }

        cells.push(currentCell.trim());
        return cells;
    }

    function isMarkdownTableDividerCell(value = '') {
        return /^:?-{3,}:?$/.test(String(value ?? '').trim());
    }

    function buildMarkdownTableImportedCellData(text = '') {
        return createEmptyTableCellData(escapeHTML(String(text ?? '')));
    }

    function parseMarkdownTableMatrix(text = '') {
        const normalizedText = normalizeMarkdownTableClipboardText(text);
        if (!normalizedText) return null;

        const lines = normalizedText
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        if (lines.length < 2 || !lines[0].includes('|') || !lines[1].includes('|')) return null;

        const headerCells = splitMarkdownTableCells(lines[0]);
        const dividerCells = splitMarkdownTableCells(lines[1]);
        if (headerCells.length < 2 || dividerCells.length !== headerCells.length || !dividerCells.every(isMarkdownTableDividerCell)) return null;

        const bodyLines = lines.slice(2);
        if (bodyLines.some(line => !line.includes('|'))) return null;

        const bodyRows = bodyLines.map(splitMarkdownTableCells);
        const columnCount = Math.max(headerCells.length, ...bodyRows.map(row => row.length), 1);
        const normalizeRow = row => Array.from({ length: columnCount }, (_, index) => row[index] || '');

        return {
            header: normalizeRow(headerCells).map(buildMarkdownTableImportedCellData),
            rows: bodyRows.map(row => normalizeRow(row).map(buildMarkdownTableImportedCellData))
        };
    }

    function applyMarkdownTableMatrix(tableId, matrix, { recordHistory = false } = {}) {
        const tableData = tables[tableId];
        if (!tableData || !matrix) return false;

        closeTableFilterMenu({ tableId, commitHistory: false });
        tableData.filters = [];
        tableData.sortState = null;
        tableData.openFilterIndex = null;

        const focusContext = matrix.rows.length
            ? { tableId, scope: 'cell', section: 'body', rowIndex: 0, rowIndexEnd: 0, colIndex: 0, colIndexEnd: 0 }
            : { tableId, scope: 'cell', section: 'head', rowIndex: 0, rowIndexEnd: 0, colIndex: 0, colIndexEnd: 0 };
        setTableMatrix(tableId, matrix, focusContext);
        if (recordHistory) saveHistoryState();
        else scheduleAutosave();
        return true;
    }

    function applyDetectedTableClipboardText(tableId, context = activeTableContext, clipboardText = '', { recordHistory = false } = {}) {
        const markdownMatrix = parseMarkdownTableMatrix(clipboardText);
        if (markdownMatrix) return applyMarkdownTableMatrix(tableId, markdownMatrix, { recordHistory });
        return applyTableClipboardText(tableId, context, clipboardText, { recordHistory });
    }

    function getActiveTablePasteContext() {
        if (selectedNodes.size !== 0 || selectedConnectionIndexes.size !== 0 || selectedTableIds.size !== 1) return null;
        const context = getResolvedTableActionContext();
        if (!context || !tables[context.tableId]) return null;
        if (context.section === 'summary') return getTableCellContext(context.tableId, null, { scope: 'table' });
        return context;
    }

    function getActiveTableScopeSelectionContext() {
        if (selectedNodes.size !== 0 || selectedConnectionIndexes.size !== 0 || selectedTableIds.size !== 1) return null;
        const context = getResolvedTableActionContext();
        if (!context || !tables[context.tableId] || context.scope === 'table') return null;
        return context;
    }

    function copyActiveTableScopeSelection() {
        const context = getActiveTableScopeSelectionContext();
        if (!context) return false;
        const clipboardText = buildTableScopeClipboardText(context.tableId, context);

        clipboard.nodes = [];
        clipboard.tables = [];
        clipboard.connections = [];
        if (clipboardText) {
            writeTextToClipboard(clipboardText).catch(() => {});
        }
        return true;
    }

    function applyTableClipboardText(tableId, context = activeTableContext, clipboardText = '', { recordHistory = false } = {}) {
        const tableData = tables[tableId];
        if (!tableData || !context || context.tableId !== tableId) return false;
        if (context.section === 'summary') return false;

        const clipboardMatrix = parseTableClipboardMatrix(clipboardText);
        if (!clipboardMatrix.length) return false;

        const targetContext = getEditableTableCellContext(context);
        if (!targetContext) return false;

        const matrix = getTableMatrix(tableId);
        const startCol = Math.max(0, targetContext.colIndex || 0);
        const maxColumnCount = Math.max(1, ...clipboardMatrix.map(row => Math.max(1, row.length)));
        const shouldFillSelectedScope = clipboardMatrix.length === 1
            && maxColumnCount === 1
            && getResolvedTableScopeCells(tableId, context).length > 1;

        const applyValueToScope = value => {
            const setCellValue = (rowData, columnIndex) => {
                if (!Array.isArray(rowData) || columnIndex < 0) return;
                rowData[columnIndex] = buildPastedTableCellData(value, rowData[columnIndex]);
            };

            if (context.scope === 'cell') {
                getResolvedTableSelectionCellPositions(tableId, context).forEach(position => {
                    const rowData = position.section === 'head' ? matrix.header : matrix.rows[position.rowIndex];
                    setCellValue(rowData, position.colIndex);
                });
                return;
            }

            if (context.scope === 'row') {
                const [rowStart, rowEnd] = getTableContextRowRange(context);
                for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
                    const rowData = matrix.rows[rowIndex];
                    for (let columnIndex = 0; columnIndex < matrix.header.length; columnIndex += 1) {
                        setCellValue(rowData, columnIndex);
                    }
                }
                return;
            }

            if (context.scope === 'column') {
                const [colStart, colEnd] = getTableContextColumnRange(context);
                for (let columnIndex = colStart; columnIndex <= colEnd; columnIndex += 1) {
                    setCellValue(matrix.header, columnIndex);
                }
                matrix.rows.forEach(rowData => {
                    for (let columnIndex = colStart; columnIndex <= colEnd; columnIndex += 1) {
                        setCellValue(rowData, columnIndex);
                    }
                });
            }
        };

        if (shouldFillSelectedScope) {
            applyValueToScope(clipboardMatrix[0][0] || '');
            setTableMatrix(tableId, matrix, context);
            if (recordHistory) saveHistoryState();
            else scheduleAutosave();
            return true;
        }

        const requiredColumnCount = startCol + maxColumnCount;
        while (matrix.header.length < requiredColumnCount) {
            matrix.header.push(createEmptyTableCellData());
            matrix.rows.forEach(row => row.push(createEmptyTableCellData()));
        }

        const requiredBodyRowCount = targetContext.section === 'head'
            ? Math.max(matrix.rows.length, Math.max(0, clipboardMatrix.length - 1))
            : Math.max(matrix.rows.length, targetContext.rowIndex + clipboardMatrix.length);
        while (matrix.rows.length < requiredBodyRowCount) {
            matrix.rows.push(Array.from({ length: matrix.header.length }, () => createEmptyTableCellData()));
        }

        clipboardMatrix.forEach((rowValues, rowOffset) => {
            const targetRow = targetContext.section === 'head' && rowOffset === 0
                ? matrix.header
                : matrix.rows[targetContext.section === 'head' ? rowOffset - 1 : targetContext.rowIndex + rowOffset];
            if (!Array.isArray(targetRow)) return;
            rowValues.forEach((value, columnOffset) => {
                targetRow[startCol + columnOffset] = buildPastedTableCellData(value, targetRow[startCol + columnOffset]);
            });
        });

        const focusContext = {
            tableId,
            scope: 'cell',
            section: targetContext.section,
            rowIndex: targetContext.rowIndex,
            rowIndexEnd: targetContext.section === 'body' ? targetContext.rowIndex + clipboardMatrix.length - 1 : targetContext.rowIndex,
            colIndex: startCol,
            colIndexEnd: startCol + maxColumnCount - 1
        };
        setTableMatrix(tableId, matrix, focusContext);
        if (recordHistory) saveHistoryState();
        else scheduleAutosave();
        return true;
    }

    function clearTableScopeStyles(tableId, context = activeTableContext, { recordHistory = false } = {}) {
        const tableData = tables[tableId];
        if (!tableData || !context || context.tableId !== tableId) return false;

        const scopedCells = getResolvedTableScopeCells(tableId, context);
        if (!scopedCells.length) return false;
        const hasScopedStyles = scopedCells.some(cell => getTableCellScopedColor(cell, 'bgColor') || getTableCellScopedColor(cell, 'textColor'));
        if (!hasScopedStyles) return false;

        scopedCells.forEach(cell => {
            setTableCellScopedColor(cell, 'bgColor', '');
            setTableCellScopedColor(cell, 'textColor', '');
        });
        syncActiveTableSelectionUI(tableId);
        updateToolbarColors();
        if (recordHistory) saveHistoryState();
        else scheduleAutosave();
        return true;
    }

    function clearTableScopeContents(tableId, context = activeTableContext, { recordHistory = false } = {}) {
        const tableData = tables[tableId];
        if (!tableData || !context || context.tableId !== tableId || context.scope === 'table') return false;
        if (context.section === 'summary') return false;

        const matrix = getTableMatrix(tableId);
        let didChange = false;
        const clearCell = (rowData, columnIndex) => {
            const normalizedCellData = normalizeTableCellData(rowData?.[columnIndex] || createEmptyTableCellData());
            if (!normalizedCellData.html) return;
            rowData[columnIndex] = {
                html: '',
                bgColor: normalizedCellData.bgColor,
                textColor: normalizedCellData.textColor
            };
            didChange = true;
        };

        if (context.scope === 'cell') {
            getResolvedTableSelectionCellPositions(tableId, context).forEach(position => {
                const rowData = position.section === 'head' ? matrix.header : matrix.rows[position.rowIndex];
                clearCell(rowData, position.colIndex);
            });
        }

        if (context.scope === 'row') {
            const [rowStart, rowEnd] = getTableContextRowRange(context);
            for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
                if (!Array.isArray(matrix.rows[rowIndex])) continue;
                for (let columnIndex = 0; columnIndex < matrix.header.length; columnIndex += 1) {
                    clearCell(matrix.rows[rowIndex], columnIndex);
                }
            }
        }

        if (context.scope === 'column') {
            const [colStart, colEnd] = getTableContextColumnRange(context);
            for (let columnIndex = colStart; columnIndex <= colEnd; columnIndex += 1) {
                clearCell(matrix.header, columnIndex);
            }
            matrix.rows.forEach(row => {
                for (let columnIndex = colStart; columnIndex <= colEnd; columnIndex += 1) {
                    clearCell(row, columnIndex);
                }
            });
        }

        if (!didChange) return false;

        setTableMatrix(tableId, matrix, context);
        if (recordHistory) saveHistoryState();
        else scheduleAutosave();
        return true;
    }

    function cutActiveTableScopeSelection() {
        const context = getActiveTableScopeSelectionContext();
        if (!context) return false;
        if (context.section === 'summary') return false;

        const clipboardText = buildTableScopeClipboardText(context.tableId, context);
        clipboard.nodes = [];
        clipboard.tables = [];
        clipboard.connections = [];
        if (clipboardText) {
            writeTextToClipboard(clipboardText).catch(() => {});
        }
        clearTableScopeContents(context.tableId, context, { recordHistory: true });
        return true;
    }

    async function pasteActiveTableScopeSelection(context = getActiveTablePasteContext()) {
        if (!context) return false;
        const clipboardText = await readTextFromClipboard('Paste text here:');
        if (!clipboardText) return false;
        return applyDetectedTableClipboardText(context.tableId, context, clipboardText, { recordHistory: true });
    }

    async function pasteMarkdownTableIntoTable(explicitTableId = null) {
        const context = getResolvedTableActionContext(explicitTableId);
        if (!context || !tables[context.tableId]) return false;

        const clipboardText = await readTextFromClipboard('Paste Markdown table here:');
        if (!clipboardText) return false;

        const markdownMatrix = parseMarkdownTableMatrix(clipboardText);
        if (!markdownMatrix) {
            showToast('Clipboard does not contain a valid Markdown table.', 'error');
            return false;
        }
        return applyMarkdownTableMatrix(context.tableId, markdownMatrix, { recordHistory: true });
    }

    function closeTableSummaryMenu({ tableId = null } = {}) {
        if (!activeTableSummaryMenu) return false;
        if (tableId && activeTableSummaryMenu.tableId !== tableId) return false;

        const activeTableId = activeTableSummaryMenu.tableId;
        const menuEl = getTableSummaryMenu(activeTableId);
        if (menuEl) {
            menuEl.hidden = true;
            menuEl.innerHTML = '';
        }
        activeTableSummaryMenu = null;
        if (typeof syncTableSummaryUI === 'function') syncTableSummaryUI(activeTableId);
        return true;
    }

    function positionTableSummaryMenu(tableOrId) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        const menuEl = getTableSummaryMenu(tableData);
        if (!tableData || !menuEl || menuEl.hidden || activeTableSummaryMenu?.tableId !== tableData.id) return false;

        const tableRect = tableData.el.getBoundingClientRect();
        const anchorEl = activeTableSummaryMenu.anchorEl instanceof HTMLElement ? activeTableSummaryMenu.anchorEl : null;
        const anchorRect = anchorEl && document.body.contains(anchorEl) ? anchorEl.getBoundingClientRect() : null;
        const desiredLeft = anchorRect && tableData.el.contains(anchorEl)
            ? anchorRect.right - tableRect.left - menuEl.offsetWidth
            : tableRect.width - menuEl.offsetWidth - 8;
        const desiredTop = anchorRect && tableData.el.contains(anchorEl)
            ? anchorRect.bottom - tableRect.top + 6
            : 12;
        const maxLeft = Math.max(8, tableRect.width - menuEl.offsetWidth - 8);

        menuEl.style.left = `${Math.max(8, Math.min(desiredLeft, maxLeft))}px`;
        menuEl.style.top = `${Math.max(8, desiredTop)}px`;
        return true;
    }

    function getTableSummaryMenuMetrics(matrix = buildDefaultTableMatrix()) {
        const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
        const columnCount = Array.isArray(matrix.header) ? matrix.header.length : 0;
        const numericColumnCount = Array.from({ length: columnCount }, (_, columnIndex) => rows.some(row => (
            parseTableNumericValue(getTableCellDataPlainText(row?.[columnIndex] || createEmptyTableCellData())) !== null
        ))).filter(Boolean).length;

        return {
            rowCount: rows.length,
            numericColumnCount
        };
    }

    function openTableSummaryMenu(tableId, anchorEl = null) {
        const tableData = tables[tableId];
        const menuEl = getTableSummaryMenu(tableData);
        if (!tableData || !menuEl) return false;

        const matrix = getTableMatrix(tableId);
        const currentSummaryFunction = normalizeTableSummaryFunction(matrix.summaryFunction);
        const currentSummaryMeta = getTableSummaryFunctionMeta(currentSummaryFunction);
        const { rowCount, numericColumnCount } = getTableSummaryMenuMetrics(matrix);
        const resolvedAnchorEl = anchorEl instanceof HTMLElement
            ? anchorEl
            : tableData.el.querySelector('[data-table-action="add-summary-row"]');
        if (activeTableSummaryMenu?.tableId === tableId && !menuEl.hidden) {
            return closeTableSummaryMenu({ tableId });
        }

        closeTableFilterMenu({ commitHistory: true });
        closeTableSummaryMenu();
        menuEl.hidden = false;
        menuEl.innerHTML = `
            <div class="table-summary-menu-eyebrow">Bottom Row</div>
            <div class="table-summary-menu-heading">Summary</div>
            <div class="table-summary-menu-description">${numericColumnCount
                ? `Choose how to calculate ${numericColumnCount === 1 ? 'the numeric column' : `${numericColumnCount} numeric columns`} across ${rowCount === 1 ? '1 row' : `${rowCount} rows`}.`
                : 'No numeric columns detected yet. Pick a mode now and the row will populate as soon as numbers are added.'}</div>
            <div class="table-summary-menu-current">${currentSummaryMeta
                ? `Current mode: <strong>${escapeHTML(currentSummaryMeta.label)}</strong>`
                : 'No summary row is active yet.'}</div>
            <div class="table-summary-menu-grid">
                ${['min', 'max', 'average', 'sum'].map(summaryFunction => {
                    const summaryMeta = getTableSummaryFunctionMeta(summaryFunction);
                    return `
                    <button
                        class="mini-btn table-summary-menu-option${currentSummaryFunction === summaryFunction ? ' active' : ''}"
                        type="button"
                        data-table-summary-menu-action="set"
                        data-table-summary-function="${summaryFunction}"
                    >
                        <span class="table-summary-menu-option-label">${escapeHTML(summaryMeta?.label || summaryFunction)}</span>
                        <span class="table-summary-menu-option-description">${escapeHTML(summaryMeta?.description || '')}</span>
                        <span class="table-summary-menu-option-state">${currentSummaryFunction === summaryFunction ? 'Selected' : 'Apply'}</span>
                    </button>
                `;
                }).join('')}
            </div>
            <div class="table-summary-menu-actions">
                ${currentSummaryFunction ? '<button class="mini-btn table-summary-menu-btn" type="button" data-table-summary-menu-action="remove">Remove</button>' : ''}
                <button class="mini-btn table-summary-menu-btn" type="button" data-table-summary-menu-action="close">Close</button>
            </div>
        `;
        activeTableSummaryMenu = { tableId, anchorEl: resolvedAnchorEl };
        if (typeof syncTableSummaryUI === 'function') syncTableSummaryUI(tableData);
        positionTableSummaryMenu(tableData);
        window.requestAnimationFrame(() => {
            const preferredButton = menuEl.querySelector('.table-summary-menu-option.active, .table-summary-menu-option');
            preferredButton?.focus();
        });
        return true;
    }

    function setTableSummaryFunction(tableId, summaryFunction = '', { recordHistory = false } = {}) {
        const tableData = tables[tableId];
        if (!tableData) return false;

        const normalizedFunction = normalizeTableSummaryFunction(summaryFunction);
        const matrix = getTableMatrix(tableId);
        if (matrix.summaryFunction === normalizedFunction) return false;

        matrix.summaryFunction = normalizedFunction;
        setTableMatrix(tableId, matrix, normalizedFunction
            ? { tableId, scope: 'cell', section: 'summary', rowIndex: 0, rowIndexEnd: 0, colIndex: 0, colIndexEnd: 0 }
            : { tableId, scope: 'cell', section: 'body', rowIndex: Math.max(0, matrix.rows.length - 1), rowIndexEnd: Math.max(0, matrix.rows.length - 1), colIndex: 0, colIndexEnd: 0 });
        if (recordHistory) saveHistoryState();
        else scheduleAutosave();
        return true;
    }

    function addTableSummaryRow(explicitTableId = null, anchorEl = null) {
        const context = getResolvedTableActionContext(explicitTableId);
        if (!context || !tables[context.tableId]) return false;
        return openTableSummaryMenu(context.tableId, anchorEl);
    }

