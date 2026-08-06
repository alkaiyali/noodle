// Canvas tables, table selection, and row/column editing helpers.

var tables = {};
var selectedTableIds = new Set();
var tableIdCounter = 0;
var editingTableId = null;
var activeTableContext = getDefaultActiveTableContext();
var activeTableAdditionalCellContexts = [];
var activeTableStructureDrag = null;
var suspendedTableFocusCommitCount = 0;
var activeTableFilterMenu = null;
var activeTableSummaryMenu = null;

    function getDefaultActiveTableContext() {
        return { tableId: null, scope: 'table', section: 'body', rowIndex: 0, rowIndexEnd: 0, colIndex: 0, colIndexEnd: 0 };
    }

    function createEmptyTableCellData(html = '') {
        return { html: normalizeTableCellHTML(html), bgColor: '', textColor: '' };
    }

    function normalizeTableCellData(value = '') {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return {
                html: normalizeTableCellHTML(value.html ?? value.value ?? ''),
                bgColor: sanitizeCSSColor(value.bgColor ?? value.backgroundColor ?? ''),
                textColor: sanitizeCSSColor(value.textColor ?? value.color ?? '')
            };
        }
        return createEmptyTableCellData(value);
    }

    function cloneTableCellData(cellData = '') {
        const normalizedCellData = normalizeTableCellData(cellData);
        return {
            html: normalizedCellData.html,
            bgColor: normalizedCellData.bgColor,
            textColor: normalizedCellData.textColor
        };
    }

    function cloneTableRowData(row = [], columnCount = row.length) {
        return Array.from({ length: Math.max(1, columnCount) }, (_, index) => cloneTableCellData(row[index] || createEmptyTableCellData()));
    }

    function sanitizeTableFilterValue(value = '') {
        return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    function normalizeTableFilters(filters = [], columnCount = 0) {
        return Array.from({ length: Math.max(1, columnCount) }, (_, index) => sanitizeTableFilterValue(filters?.[index] || ''));
    }

    function normalizeTableSortDirection(direction = '') {
        return direction === 'desc' ? 'desc' : direction === 'asc' ? 'asc' : '';
    }

    function normalizeTableSortMode(mode = '') {
        return mode === 'numeric' ? 'numeric' : 'text';
    }

    function normalizeTableSummaryFunction(value = '') {
        const normalizedValue = String(value ?? '').trim().toLowerCase();
        if (normalizedValue === 'avg') return 'average';
        return ['min', 'max', 'average', 'sum'].includes(normalizedValue) ? normalizedValue : '';
    }

    function getTableSummaryFunctionMeta(summaryFunction = '') {
        const normalizedFunction = normalizeTableSummaryFunction(summaryFunction);
        if (!normalizedFunction) return null;

        return {
            min: {
                name: 'min',
                label: 'Min',
                description: 'Pick the smallest number in each numeric column.',
                detail: 'Lowest value'
            },
            max: {
                name: 'max',
                label: 'Max',
                description: 'Pick the largest number in each numeric column.',
                detail: 'Highest value'
            },
            average: {
                name: 'average',
                label: 'Average',
                description: 'Show the mean of the numeric values in each column.',
                detail: 'Mean value'
            },
            sum: {
                name: 'sum',
                label: 'Sum',
                description: 'Add the numeric values together for each column.',
                detail: 'Total'
            }
        }[normalizedFunction];
    }

    function getTableSummaryFunctionLabel(summaryFunction = '') {
        return getTableSummaryFunctionMeta(summaryFunction)?.label || '';
    }

    function normalizeTableSortState(sortState = null, columnCount = 0) {
        if (!sortState || !Number.isInteger(sortState.columnIndex) || sortState.columnIndex < 0) return null;
        const direction = normalizeTableSortDirection(sortState.direction);
        if (!direction) return null;
        return {
            columnIndex: Math.max(0, Math.min(sortState.columnIndex, Math.max(0, columnCount - 1))),
            direction,
            mode: normalizeTableSortMode(sortState.mode)
        };
    }

    function getTableCellScopedColor(cellEl, property) {
        if (!(cellEl instanceof HTMLElement)) return '';
        if (property === 'bgColor') return sanitizeCSSColor(cellEl.getAttribute('data-cell-bg-color') || cellEl.style.backgroundColor || '');
        return sanitizeCSSColor(cellEl.getAttribute('data-cell-text-color') || cellEl.style.color || '');
    }

    function extractTableCellData(cellEl) {
        return normalizeTableCellData({
            html: cellEl?.innerHTML || '',
            bgColor: getTableCellScopedColor(cellEl, 'bgColor'),
            textColor: getTableCellScopedColor(cellEl, 'textColor')
        });
    }

    function buildDefaultTableMatrix(columnCount = 2, bodyRowCount = 2) {
        return {
            header: Array.from({ length: Math.max(1, columnCount) }, () => createEmptyTableCellData()),
            rows: Array.from({ length: Math.max(1, bodyRowCount) }, () => Array.from({ length: Math.max(1, columnCount) }, () => createEmptyTableCellData())),
            summaryFunction: ''
        };
    }

    function normalizeTableCellHTML(value = '') {
        return sanitizeRichTextHTML(String(value ?? '').trim(), { allowTables: false });
    }

    function getTableRowCellData(rowEl, columnCount) {
        const cells = Array.from(rowEl?.children || []).filter(cell => cell.matches('th, td'));
        return Array.from({ length: Math.max(1, columnCount) }, (_, index) => cells[index] ? extractTableCellData(cells[index]) : createEmptyTableCellData());
    }

    function isTableSummaryRowElement(rowEl) {
        return rowEl instanceof HTMLTableRowElement && Boolean(normalizeTableSummaryFunction(rowEl.getAttribute('data-table-summary-function') || ''));
    }

    function getTableSummaryFunctionFromRowElement(rowEl) {
        return normalizeTableSummaryFunction(rowEl?.getAttribute('data-table-summary-function') || '');
    }

    function extractTableMatrix(tableEl) {
        if (!(tableEl instanceof HTMLTableElement)) return buildDefaultTableMatrix();

        const allRows = Array.from(tableEl.querySelectorAll('tr'));
        if (!allRows.length) return buildDefaultTableMatrix();

        const headerRow = tableEl.querySelector('thead tr') || allRows[0];
        const bodyRows = Array.from(tableEl.querySelectorAll('tbody tr'));
        const summaryRowEl = bodyRows.find(isTableSummaryRowElement) || null;
        const sourceBodyRows = (bodyRows.length ? bodyRows : allRows.slice(1)).filter(row => !isTableSummaryRowElement(row));
        const columnCount = Math.max(1, ...allRows.map(row => Array.from(row.children).filter(cell => cell.matches('th, td')).length));

        return {
            header: getTableRowCellData(headerRow, columnCount),
            rows: (sourceBodyRows.length ? sourceBodyRows : [null]).map(row => row ? getTableRowCellData(row, columnCount) : Array.from({ length: columnCount }, () => createEmptyTableCellData())),
            summaryFunction: getTableSummaryFunctionFromRowElement(summaryRowEl)
        };
    }

    function buildTableCellDataAttributes(cellData) {
        return `${cellData.bgColor ? ` data-cell-bg-color="${escapeHTML(cellData.bgColor)}"` : ''}${cellData.textColor ? ` data-cell-text-color="${escapeHTML(cellData.textColor)}"` : ''}`;
    }

    function buildTableCellStyleAttribute(cellData) {
        const styleTokens = [];
        if (cellData.bgColor) styleTokens.push(`background-color:${cellData.bgColor}`);
        if (cellData.textColor) styleTokens.push(`color:${cellData.textColor}`);
        return styleTokens.length ? ` style="${escapeHTML(styleTokens.join(';'))}"` : '';
    }

    function buildTableCellHTML(tagName, cellData, placeholder) {
        const normalizedCellData = normalizeTableCellData(cellData);
        return `<${tagName} data-placeholder="${escapeHTML(placeholder)}"${buildTableCellDataAttributes(normalizedCellData)}${buildTableCellStyleAttribute(normalizedCellData)}>${normalizedCellData.html}</${tagName}>`;
    }

    function buildTableRowHTML(tagName, rowData = [], placeholder = '', rowAttributes = '') {
        return `<tr${rowAttributes}>${rowData.map(value => buildTableCellHTML(tagName, value, placeholder)).join('')}</tr>`;
    }

    function buildTableHTMLFromMatrix(matrix = buildDefaultTableMatrix()) {
        const header = Array.isArray(matrix.header) && matrix.header.length ? matrix.header : buildDefaultTableMatrix().header;
        const rows = Array.isArray(matrix.rows) && matrix.rows.length ? matrix.rows : buildDefaultTableMatrix(header.length, 1).rows;
        const summaryFunction = normalizeTableSummaryFunction(matrix.summaryFunction);
        const normalizedHeader = Array.from({ length: header.length }, (_, index) => normalizeTableCellData(header[index] || createEmptyTableCellData()));
        const normalizedRows = rows.map(row => Array.from({ length: normalizedHeader.length }, (_, index) => normalizeTableCellData(row?.[index] || createEmptyTableCellData())));
        const summaryRow = summaryFunction
            ? buildTableSummaryRowCellData(normalizedRows, normalizedHeader.length, summaryFunction)
            : null;

        return `<table><thead>${buildTableRowHTML('th', normalizedHeader, 'Heading')}</thead><tbody>${normalizedRows.map(row => buildTableRowHTML('td', row, 'Type here...')).join('')}${summaryRow ? buildTableRowHTML('td', summaryRow, '', ` class="table-summary-row" data-table-summary-function="${escapeHTML(summaryFunction)}"`) : ''}</tbody></table>`;
    }

    function sanitizeCanvasTableHTML(html = '') {
        const template = document.createElement('template');
        template.innerHTML = sanitizeRichTextHTML(html, { allowTables: true });
        const tableEl = template.content.querySelector('table');
        return buildTableHTMLFromMatrix(extractTableMatrix(tableEl));
    }

    function buildTableShellHTML(tableId, tableHtml) {
        return `
            <div class="table-hover-actions">
                <button class="table-add-btn" data-action="apply-table-action" data-table-action="add-row-end" data-table-id="${escapeHTML(tableId)}" type="button">+ Row</button>
                <button class="table-add-btn" data-action="apply-table-action" data-table-action="add-column-end" data-table-id="${escapeHTML(tableId)}" type="button">+ Col</button>
                <button class="table-add-btn" data-action="apply-table-action" data-table-action="add-summary-row" data-table-id="${escapeHTML(tableId)}" type="button">Summary</button>
                <button class="table-add-btn" data-action="apply-table-action" data-table-action="paste-markdown-table" data-table-id="${escapeHTML(tableId)}" type="button">Paste MD</button>
            </div>
            <div class="table-column-handle-layer" aria-hidden="true"></div>
            <div class="table-row-handle-layer" aria-hidden="true"></div>
            <div class="table-filter-menu" hidden></div>
            <div class="table-summary-menu" hidden></div>
            <div class="table-content">${tableHtml}</div>
        `;
    }

    function getTableElement(tableOrId) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        return tableData?.el || null;
    }

    function getTableContentContainer(tableOrId) {
        return getTableElement(tableOrId)?.querySelector('.table-content') || null;
    }

    function getTableGrid(tableOrId) {
        return getTableContentContainer(tableOrId)?.querySelector('table') || null;
    }

    function getTableBodyRows(tableOrId, { includeSummary = false } = {}) {
        const rows = Array.from(getTableGrid(tableOrId)?.querySelectorAll('tbody tr') || []);
        return includeSummary ? rows : rows.filter(rowEl => !isTableSummaryRowElement(rowEl));
    }

    function getTableSummaryRowElement(tableOrId) {
        return getTableBodyRows(tableOrId, { includeSummary: true }).find(isTableSummaryRowElement) || null;
    }

    function getTableRowsForSection(tableOrId, section = 'body') {
        if (section === 'head') return Array.from(getTableGrid(tableOrId)?.querySelectorAll('thead tr') || []);
        if (section === 'summary') {
            const summaryRowEl = getTableSummaryRowElement(tableOrId);
            return summaryRowEl ? [summaryRowEl] : [];
        }
        return getTableBodyRows(tableOrId);
    }

    function getTableColumnHandleLayer(tableOrId) {
        return getTableElement(tableOrId)?.querySelector('.table-column-handle-layer') || null;
    }

    function getTableRowHandleLayer(tableOrId) {
        return getTableElement(tableOrId)?.querySelector('.table-row-handle-layer') || null;
    }

    function getTableFilterMenu(tableOrId) {
        return getTableElement(tableOrId)?.querySelector('.table-filter-menu') || null;
    }

    function getTableSummaryMenu(tableOrId) {
        return getTableElement(tableOrId)?.querySelector('.table-summary-menu') || null;
    }

    function getTableHeaderCells(tableOrId) {
        return Array.from(getTableGrid(tableOrId)?.querySelectorAll('thead tr:first-child > th, thead tr:first-child > td') || []);
    }

    function getTableHeaderLabel(headerCell) {
        if (!(headerCell instanceof HTMLElement)) return '';
        const clone = headerCell.cloneNode(true);
        clone.querySelectorAll('.table-filter-btn').forEach(button => button.remove());
        return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function syncTableFilterState(tableOrId, columnCount = null) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        if (!tableData) return [];
        const resolvedColumnCount = Math.max(1, columnCount || getTableHeaderCells(tableData).length || 1);
        tableData.filtersEnabled = Boolean(tableData.filtersEnabled);
        tableData.filters = normalizeTableFilters(tableData.filters, resolvedColumnCount);
        return tableData.filters;
    }

    function syncTableSortState(tableOrId, columnCount = null) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        if (!tableData) return null;
        const resolvedColumnCount = Math.max(1, columnCount || getTableHeaderCells(tableData).length || 1);
        tableData.sortState = normalizeTableSortState(tableData.sortState, resolvedColumnCount);
        return tableData.sortState;
    }

    function clearTableSortState(tableOrId) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        if (!tableData) return false;
        if (!tableData.sortState) return false;
        tableData.sortState = null;
        return true;
    }

    function getTableContextRowRange(context = activeTableContext) {
        const start = Math.max(0, context?.rowIndex || 0);
        const end = Math.max(0, Number.isInteger(context?.rowIndexEnd) ? context.rowIndexEnd : start);
        return [Math.min(start, end), Math.max(start, end)];
    }

    function getTableContextColumnRange(context = activeTableContext) {
        const start = Math.max(0, context?.colIndex || 0);
        const end = Math.max(0, Number.isInteger(context?.colIndexEnd) ? context.colIndexEnd : start);
        return [Math.min(start, end), Math.max(start, end)];
    }

    function normalizeTableSelectionContext(context = null) {
        if (!context) return getDefaultActiveTableContext();
        const fallbackContext = getDefaultActiveTableContext();
        return {
            ...fallbackContext,
            ...context,
            rowIndexEnd: Number.isInteger(context.rowIndexEnd) ? context.rowIndexEnd : context.rowIndex || 0,
            colIndexEnd: Number.isInteger(context.colIndexEnd) ? context.colIndexEnd : context.colIndex || 0
        };
    }

    function isSameTableRangeContext(a = null, b = null) {
        return Boolean(
            a
            && b
            && a.tableId === b.tableId
            && a.scope === b.scope
            && a.section === b.section
            && a.rowIndex === b.rowIndex
            && (a.rowIndexEnd ?? a.rowIndex) === (b.rowIndexEnd ?? b.rowIndex)
            && a.colIndex === b.colIndex
            && (a.colIndexEnd ?? a.colIndex) === (b.colIndexEnd ?? b.colIndex)
        );
    }

    function isTableCellContextWithinScope(scopeContext = null, cellContext = null) {
        if (!scopeContext || !cellContext || scopeContext.scope !== 'cell' || cellContext.scope !== 'cell') return false;
        if (scopeContext.tableId !== cellContext.tableId || scopeContext.section !== cellContext.section) return false;
        const [rowStart, rowEnd] = getTableContextRowRange(scopeContext);
        const [colStart, colEnd] = getTableContextColumnRange(scopeContext);
        return cellContext.rowIndex >= rowStart
            && cellContext.rowIndex <= rowEnd
            && cellContext.colIndex >= colStart
            && cellContext.colIndex <= colEnd;
    }

    function normalizeActiveTableAdditionalCellContexts(contexts = [], anchorContext = activeTableContext) {
        const normalizedAnchorContext = normalizeTableSelectionContext(anchorContext);
        if (normalizedAnchorContext.scope !== 'cell' || !normalizedAnchorContext.tableId) return [];

        const seenKeys = new Set();
        return contexts
            .map(context => normalizeTableSelectionContext(context))
            .filter(context => (
                isSingleTableCellContext(context)
                && context.tableId === normalizedAnchorContext.tableId
                && context.section === normalizedAnchorContext.section
                && !isTableCellContextWithinScope(normalizedAnchorContext, context)
            ))
            .filter(context => {
                const key = `${context.tableId}:${context.section}:${context.rowIndex}:${context.colIndex}`;
                if (seenKeys.has(key)) return false;
                seenKeys.add(key);
                return true;
            });
    }

    function getTableSelectionContexts(tableId, context = activeTableContext) {
        if (!context || context.tableId !== tableId) return [];
        if (context.scope !== 'cell' || !isSameTableRangeContext(activeTableContext, context)) return [context];
        return [context, ...normalizeActiveTableAdditionalCellContexts(activeTableAdditionalCellContexts, context)];
    }

    function getResolvedTableSelectionCellPositions(tableId, context = activeTableContext) {
        if (!context || context.tableId !== tableId || context.scope !== 'cell') return [];

        const selectionContexts = getTableSelectionContexts(tableId, context);
        const seenKeys = new Set();
        return selectionContexts.flatMap(selectionContext => {
            const [rowStart, rowEnd] = getTableContextRowRange(selectionContext);
            const [colStart, colEnd] = getTableContextColumnRange(selectionContext);
            const positions = [];
            for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
                for (let colIndex = colStart; colIndex <= colEnd; colIndex += 1) {
                    const key = `${selectionContext.section}:${rowIndex}:${colIndex}`;
                    if (seenKeys.has(key)) continue;
                    seenKeys.add(key);
                    positions.push({
                        tableId,
                        scope: 'cell',
                        section: selectionContext.section,
                        rowIndex,
                        rowIndexEnd: rowIndex,
                        colIndex,
                        colIndexEnd: colIndex
                    });
                }
            }
            return positions;
        });
    }

    function getResolvedTableScopeCells(tableId, context = activeTableContext) {
        if (!context || context.tableId !== tableId) return [];
        if (context.scope !== 'cell') return getTableScopeCells(tableId, context);
        return getResolvedTableSelectionCellPositions(tableId, context)
            .map(cellContext => getTableCellByContext(tableId, cellContext))
            .filter(cell => Boolean(cell));
    }

    function isTableContextIndexSelected(context, kind, index) {
        if (!context || context.scope !== kind || !Number.isInteger(index) || index < 0) return false;
        const [rangeStart, rangeEnd] = kind === 'row'
            ? getTableContextRowRange(context)
            : getTableContextColumnRange(context);
        return index >= rangeStart && index <= rangeEnd;
    }

    function hasActiveTableFilters(tableOrId) {
        const tableData = typeof tableOrId === 'string' ? tables[tableOrId] : tableOrId;
        return Boolean(tableData?.filtersEnabled && syncTableFilterState(tableData).some(Boolean));
    }

    function getTableCellDataPlainText(cellData = '') {
        const normalizedCellData = normalizeTableCellData(cellData);
        const template = document.createElement('template');
        template.innerHTML = normalizedCellData.html;
        return String(template.content.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function parseTableNumericValue(text = '') {
        let candidate = String(text ?? '').trim();
        if (!candidate) return null;

        candidate = candidate.replace(/\s+/g, '').replace(/,/g, '');
        let sign = 1;
        if (/^\(.*\)$/.test(candidate)) {
            sign = -1;
            candidate = candidate.slice(1, -1);
        }
        if (candidate.startsWith('+')) candidate = candidate.slice(1);
        else if (candidate.startsWith('-')) {
            sign *= -1;
            candidate = candidate.slice(1);
        }

        candidate = candidate.replace(/^[$€£¥₹₩₪₽₫฿₴₦₱₲₵₡₭₮₸₺₼₾]+/, '');
        candidate = candidate.replace(/[$€£¥₹₩₪₽₫฿₴₦₱₲₵₡₭₮₸₺₼₾]+$/, '');
        if (candidate.endsWith('%')) candidate = candidate.slice(0, -1);
        if (!/^(?:\d+\.?\d*|\.\d+)$/.test(candidate)) return null;
        return sign * parseFloat(candidate);
    }

    function formatTableSummaryNumericValue(value) {
        if (!Number.isFinite(value)) return '';
        if (Math.abs(value) < 1e-9) return '0';
        if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
        return value.toFixed(4).replace(/\.?0+$/, '');
    }

    function buildTableSummaryLabelCellHTML(summaryFunction = '', valueText = '') {
        const summaryMeta = getTableSummaryFunctionMeta(summaryFunction);
        if (!summaryMeta) return '';

        const detailLine = valueText
            ? `<div>${escapeHTML(valueText)}</div>`
            : `<div>${escapeHTML(summaryMeta.detail)}</div>`;
        return `<div><strong>${escapeHTML(summaryMeta.label)}</strong></div> ${detailLine}`;
    }

    function buildTableSummaryRowCellData(rows = [], columnCount = 0, summaryFunction = '') {
        const normalizedFunction = normalizeTableSummaryFunction(summaryFunction);
        const resolvedColumnCount = Math.max(1, columnCount);
        const summaryCells = Array.from({ length: resolvedColumnCount }, () => createEmptyTableCellData());
        if (!normalizedFunction) return summaryCells;

        const numericValuesByColumn = Array.from({ length: resolvedColumnCount }, (_, columnIndex) => rows
            .map(row => parseTableNumericValue(getTableCellDataPlainText(row?.[columnIndex] || createEmptyTableCellData())))
            .filter(value => value !== null && Number.isFinite(value)));
        const formattedValuesByColumn = Array.from({ length: resolvedColumnCount }, () => '');

        numericValuesByColumn.forEach((values, columnIndex) => {
            if (!values.length) return;

            let computedValue;
            if (normalizedFunction === 'min') computedValue = Math.min(...values);
            else if (normalizedFunction === 'max') computedValue = Math.max(...values);
            else if (normalizedFunction === 'average') computedValue = values.reduce((sum, value) => sum + value, 0) / values.length;
            else computedValue = values.reduce((sum, value) => sum + value, 0);

            formattedValuesByColumn[columnIndex] = formatTableSummaryNumericValue(computedValue);
            summaryCells[columnIndex] = createEmptyTableCellData(escapeHTML(formattedValuesByColumn[columnIndex]));
        });

        summaryCells[0] = createEmptyTableCellData(buildTableSummaryLabelCellHTML(normalizedFunction, formattedValuesByColumn[0]));

        return summaryCells;
    }

    function getTableSortComparable(cellData = '', mode = 'text') {
        const normalizedMode = normalizeTableSortMode(mode);
        const plainText = getTableCellDataPlainText(cellData);
        const normalizedText = plainText.replace(/,/g, '');
        if (!plainText) {
            return { type: 'empty', value: '', text: '' };
        }
        if (/^-?\d+(?:\.\d+)?$/.test(normalizedText)) {
            return { type: 'number', value: parseFloat(normalizedText), text: plainText.toLowerCase() };
        }
        if (normalizedMode === 'numeric') {
            const numericValue = parseTableNumericValue(plainText);
            if (numericValue !== null) {
                return { type: 'number', value: numericValue, text: plainText.toLowerCase() };
            }
        }
        const parsedDate = Date.parse(plainText);
        if (Number.isFinite(parsedDate) && /\d/.test(plainText)) {
            return { type: 'date', value: parsedDate, text: plainText.toLowerCase() };
        }
        return { type: 'text', value: plainText.toLowerCase(), text: plainText.toLowerCase() };
    }

    function compareTableSortEntries(aEntry, bEntry, direction = 'asc', mode = 'text') {
        const normalizedMode = normalizeTableSortMode(mode);
        const directionSign = direction === 'desc' ? -1 : 1;
        const aEmpty = aEntry.value.type === 'empty';
        const bEmpty = bEntry.value.type === 'empty';
        if (aEmpty && !bEmpty) return 1;
        if (!aEmpty && bEmpty) return -1;

        if (normalizedMode === 'numeric') {
            const aIsNumeric = aEntry.value.type === 'number';
            const bIsNumeric = bEntry.value.type === 'number';
            if (aIsNumeric && !bIsNumeric) return -1;
            if (!aIsNumeric && bIsNumeric) return 1;
        }

        if (aEntry.value.type === bEntry.value.type && (aEntry.value.type === 'number' || aEntry.value.type === 'date')) {
            const numericDifference = aEntry.value.value - bEntry.value.value;
            if (numericDifference !== 0) return numericDifference * directionSign;
        }

        const textComparison = aEntry.value.text.localeCompare(bEntry.value.text, undefined, {
            numeric: true,
            sensitivity: 'base'
        });
        if (textComparison !== 0) return textComparison * directionSign;
        return aEntry.index - bEntry.index;
    }

    function sortTableByColumn(tableId, columnIndex, direction = 'asc', mode = 'text') {
        const tableData = tables[tableId];
        const normalizedDirection = normalizeTableSortDirection(direction);
        const normalizedMode = normalizeTableSortMode(mode);
        if (!tableData || !Number.isInteger(columnIndex) || columnIndex < 0 || !normalizedDirection) return false;

        const matrix = getTableMatrix(tableId);
        if (!Array.isArray(matrix.rows) || matrix.rows.length < 2 || columnIndex >= matrix.header.length) return false;

        matrix.rows = matrix.rows
            .map((row, index) => ({
                row,
                index,
                value: getTableSortComparable(row[columnIndex], normalizedMode)
            }))
            .sort((aEntry, bEntry) => compareTableSortEntries(aEntry, bEntry, normalizedDirection, normalizedMode))
            .map(entry => entry.row);

        tableData.sortState = { columnIndex, direction: normalizedDirection, mode: normalizedMode };
        setTableMatrix(tableId, matrix, {
            tableId,
            scope: 'column',
            section: 'head',
            rowIndex: 0,
            colIndex: columnIndex
        });
        if (activeTableFilterMenu?.tableId === tableId && activeTableFilterMenu.columnIndex === columnIndex) {
            openTableFilterMenu(tableId, columnIndex);
        }
        saveHistoryState();
        return true;
    }

