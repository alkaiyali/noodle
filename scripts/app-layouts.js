// Layout algorithms and bulk positioning helpers.

    function getLayoutRootNodeId(nodeId) {
        if (!nodes[nodeId]) return null;
        const ancestorIds = getNodeGroupAncestorIds(nodeId);
        return ancestorIds.length ? ancestorIds[ancestorIds.length - 1] : nodeId;
    }

    function getUniqueLayoutNodeIds(nodeIds = [], options = {}) {
        const includeFloatingText = options.includeFloatingText === true;
        const uniqueIds = new Set();
        nodeIds.forEach(nodeId => {
            if (!nodes[nodeId] || nodes[nodeId].el.style.display === 'none') return;
            if (!includeFloatingText && nodes[nodeId].type === 'floatingText') return;
            const rootId = getLayoutRootNodeId(nodeId);
            if (rootId && nodes[rootId] && nodes[rootId].el.style.display !== 'none') uniqueIds.add(rootId);
        });
        return Array.from(uniqueIds);
    }

    function getVisibleNodeIds() {
        return getUniqueLayoutNodeIds(Object.keys(nodes));
    }

    function getSelectedVisibleNodeIds(options = {}) {
        return getUniqueLayoutNodeIds(Array.from(selectedNodes), options);
    }

    function sortNodeIdsByPosition(nodeIds) {
        return [...nodeIds].sort((a, b) => {
            const deltaY = nodes[a].y - nodes[b].y;
            if (Math.abs(deltaY) > 1) return deltaY;
            return nodes[a].x - nodes[b].x;
        });
    }

    function getNodeMetrics(nodeIds) {
        return nodeIds
            .filter(id => nodes[id])
            .map(id => ({
                id,
                x: nodes[id].x,
                y: nodes[id].y,
                width: nodes[id].el.offsetWidth,
                height: nodes[id].el.offsetHeight
            }));
    }

    function getNodeBounds(metrics) {
        if (!metrics.length) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
        const left = Math.min(...metrics.map(m => m.x));
        const top = Math.min(...metrics.map(m => m.y));
        const right = Math.max(...metrics.map(m => m.x + m.width));
        const bottom = Math.max(...metrics.map(m => m.y + m.height));
        return { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    function getMedianMetricSize(metrics, sizeKey) {
        const values = metrics
            .map(metric => Math.max(0, Number(metric?.[sizeKey]) || 0))
            .sort((a, b) => a - b);
        if (!values.length) return 0;

        const middleIndex = Math.floor(values.length / 2);
        if (values.length % 2 === 1) return values[middleIndex];
        return (values[middleIndex - 1] + values[middleIndex]) / 2;
    }

    function applyNodePositions(positionMap, recordHistory = true) {
        let changed = false;
        const movedNodeIds = new Set();
        Object.entries(positionMap).forEach(([id, position]) => {
            const node = nodes[id];
            if (!node || !position) return;
            const nextX = Math.round(position.x);
            const nextY = Math.round(position.y);
            if (node.x === nextX && node.y === nextY) return;
            const dx = nextX - node.x;
            const dy = nextY - node.y;
            const nodeIdsToMove = isGroupNode(node) ? [id, ...getGroupDescendantIds(id)] : [id];
            nodeIdsToMove.forEach(nodeId => {
                const targetNode = nodes[nodeId];
                if (!targetNode || movedNodeIds.has(nodeId)) return;
                const offsetX = nodeId === id ? nextX : targetNode.x + dx;
                const offsetY = nodeId === id ? nextY : targetNode.y + dy;
                setNodePosition(targetNode, offsetX, offsetY);
                movedNodeIds.add(nodeId);
            });
            changed = true;
        });
        if (!changed) return false;
        if (typeof syncAllNodeGroupMembership === 'function') syncAllNodeGroupMembership({ autosave: false });
        drawConnections();
        updateAnalyticsCard();
        if (recordHistory) saveHistoryState();
        return true;
    }

    function buildDistributedPositionMap(metrics, axis) {
        const isHorizontal = axis === 'horizontal';
        const positionKey = isHorizontal ? 'x' : 'y';
        const sizeKey = isHorizontal ? 'width' : 'height';
        const orderedMetrics = [...metrics].sort((a, b) => {
            const primaryDelta = a[positionKey] - b[positionKey];
            if (Math.abs(primaryDelta) > 1) return primaryDelta;
            return isHorizontal ? (a.y - b.y) : (a.x - b.x);
        });
        const startEdge = orderedMetrics[0][positionKey];
        const endEdge = orderedMetrics[orderedMetrics.length - 1][positionKey] + orderedMetrics[orderedMetrics.length - 1][sizeKey];
        const totalSize = orderedMetrics.reduce((sum, metric) => sum + metric[sizeKey], 0);
        const gap = (endEdge - startEdge - totalSize) / Math.max(1, orderedMetrics.length - 1);
        const positionMap = {};
        let cursor = startEdge;

        orderedMetrics.forEach(metric => {
            positionMap[metric.id] = { x: metric.x, y: metric.y };
            positionMap[metric.id][positionKey] = cursor;
            cursor += metric[sizeKey] + gap;
        });

        return positionMap;
    }

    function getCompressedLayoutGap(metrics, axis) {
        const sizeKey = axis === 'horizontal' ? 'width' : 'height';
        const medianSize = getMedianMetricSize(metrics, sizeKey);
        if (axis === 'horizontal') return Math.max(18, Math.min(42, Math.round(medianSize * 0.12 + 12)));
        return Math.max(20, Math.min(46, Math.round(medianSize * 0.16 + 10)));
    }

    function buildCompressedPositionMap(metrics, axis) {
        const isHorizontal = axis === 'horizontal';
        const positionKey = isHorizontal ? 'x' : 'y';
        const sizeKey = isHorizontal ? 'width' : 'height';
        const orderedMetrics = [...metrics].sort((a, b) => {
            const primaryDelta = a[positionKey] - b[positionKey];
            if (Math.abs(primaryDelta) > 1) return primaryDelta;
            return isHorizontal ? (a.y - b.y) : (a.x - b.x);
        });
        const bounds = getNodeBounds(metrics);
        const center = isHorizontal ? (bounds.left + bounds.width / 2) : (bounds.top + bounds.height / 2);
        const gap = getCompressedLayoutGap(metrics, axis);
        const totalSize = orderedMetrics.reduce((sum, metric) => sum + metric[sizeKey], 0);
        const compressedSpan = totalSize + gap * Math.max(0, orderedMetrics.length - 1);
        const positionMap = {};
        let cursor = center - compressedSpan / 2;

        orderedMetrics.forEach(metric => {
            positionMap[metric.id] = { x: metric.x, y: metric.y };
            positionMap[metric.id][positionKey] = cursor;
            cursor += metric[sizeKey] + gap;
        });

        return positionMap;
    }

    function alignSelectedNodes(mode) {
        const nodeIds = getSelectedVisibleNodeIds({ includeFloatingText: true });
        const minimumNodes = mode === 'distribute-horizontal' || mode === 'distribute-vertical' ? 3 : 2;
        if (nodeIds.length < minimumNodes) return;
        const metrics = getNodeMetrics(nodeIds);

        if (mode === 'distribute-horizontal') {
            applyNodePositions(buildDistributedPositionMap(metrics, 'horizontal'));
            return;
        }
        if (mode === 'distribute-vertical') {
            applyNodePositions(buildDistributedPositionMap(metrics, 'vertical'));
            return;
        }
        if (mode === 'compress-horizontal') {
            applyNodePositions(buildCompressedPositionMap(metrics, 'horizontal'));
            return;
        }
        if (mode === 'compress-vertical') {
            applyNodePositions(buildCompressedPositionMap(metrics, 'vertical'));
            return;
        }

        const bounds = getNodeBounds(metrics);
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        const positionMap = {};

        metrics.forEach(metric => {
            let nextX = metric.x;
            let nextY = metric.y;

            if (mode === 'left') nextX = bounds.left;
            if (mode === 'center') nextX = centerX - metric.width / 2;
            if (mode === 'right') nextX = bounds.right - metric.width;
            if (mode === 'top') nextY = bounds.top;
            if (mode === 'middle') nextY = centerY - metric.height / 2;
            if (mode === 'bottom') nextY = bounds.bottom - metric.height;

            positionMap[metric.id] = { x: nextX, y: nextY };
        });

        applyNodePositions(positionMap);
    }

    function rotateNodeLayoutClockwise() {
        const selectedIds = getSelectedVisibleNodeIds();
        const nodeIds = selectedIds.length > 1 ? selectedIds : getVisibleNodeIds();
        if (nodeIds.length < 2) return;

        const metrics = getNodeMetrics(nodeIds);
        const bounds = getNodeBounds(metrics);
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        const positionMap = {};

        metrics.forEach(metric => {
            const nodeCenterX = metric.x + metric.width / 2;
            const nodeCenterY = metric.y + metric.height / 2;
            const dx = nodeCenterX - centerX;
            const dy = nodeCenterY - centerY;

            positionMap[metric.id] = {
                x: centerX - dy - metric.width / 2,
                y: centerY + dx - metric.height / 2
            };
        });

        applyNodePositions(positionMap);
    }

    function runTopologicalLayout() {
        const selectedIds = getSelectedVisibleNodeIds();
        const nodeIds = selectedIds.length > 1 ? selectedIds : getVisibleNodeIds();
        if (nodeIds.length < 2) return;

        const orderedIds = sortNodeIdsByPosition(nodeIds);
        const idSet = new Set(nodeIds);
        const indegree = Object.fromEntries(nodeIds.map(id => [id, 0]));
        const adjacency = Object.fromEntries(nodeIds.map(id => [id, new Set()]));
        const layers = Object.fromEntries(nodeIds.map(id => [id, 0]));

        connections.forEach(conn => {
            const fromId = getLayoutRootNodeId(conn.from);
            const toId = getLayoutRootNodeId(conn.to);
            if (!fromId || !toId || fromId === toId || !idSet.has(fromId) || !idSet.has(toId)) return;
            if (adjacency[fromId].has(toId)) return;
            adjacency[fromId].add(toId);
            indegree[toId] += 1;
        });

        Object.keys(adjacency).forEach(id => {
            adjacency[id] = Array.from(adjacency[id]).sort((a, b) => orderedIds.indexOf(a) - orderedIds.indexOf(b));
        });

        const queue = orderedIds.filter(id => indegree[id] === 0);
        const topoOrder = [];
        while (queue.length) {
            const currentId = queue.shift();
            topoOrder.push(currentId);
            adjacency[currentId].forEach(nextId => {
                layers[nextId] = Math.max(layers[nextId], layers[currentId] + 1);
                indegree[nextId] -= 1;
                if (indegree[nextId] === 0) queue.push(nextId);
            });
        }

        const remaining = orderedIds.filter(id => !topoOrder.includes(id));
        let maxLayer = topoOrder.length ? Math.max(...topoOrder.map(id => layers[id])) : -1;
        remaining.forEach(id => {
            maxLayer += 1;
            layers[id] = maxLayer;
            topoOrder.push(id);
        });

        const buckets = new Map();
        topoOrder.forEach(id => {
            const layer = layers[id];
            if (!buckets.has(layer)) buckets.set(layer, []);
            buckets.get(layer).push(id);
        });

        const metrics = getNodeMetrics(nodeIds);
        const metricsById = Object.fromEntries(metrics.map(metric => [metric.id, metric]));
        const bounds = getNodeBounds(metrics);
        const layerKeys = [...buckets.keys()].sort((a, b) => a - b);
        const medianWidth = getMedianMetricSize(metrics, 'width');
        const medianHeight = getMedianMetricSize(metrics, 'height');
        const columnGap = Math.max(110, Math.min(220, medianWidth * 0.55 + 40));
        const rowGap = Math.max(70, Math.min(140, medianHeight * 0.35 + 30));
        const verticalCenter = bounds.top + bounds.height / 2;
        const positionMap = {};
        let currentX = bounds.left;

        layerKeys.forEach(layer => {
            const bucket = sortNodeIdsByPosition(buckets.get(layer));
            const bucketWidth = Math.max(...bucket.map(id => metricsById[id].width));
            const totalHeight = bucket.reduce((sum, id) => sum + metricsById[id].height, 0) + rowGap * Math.max(0, bucket.length - 1);
            let currentY = verticalCenter - totalHeight / 2;

            bucket.forEach(id => {
                const metric = metricsById[id];
                positionMap[id] = {
                    x: currentX + (bucketWidth - metric.width) / 2,
                    y: currentY
                };
                currentY += metric.height + rowGap;
            });

            currentX += bucketWidth + columnGap;
        });

        applyNodePositions(positionMap);
        showToast(`Topological layout: ${nodeIds.length} nodes`, 'success', 2200);
    }

    function buildConnectedComponents(nodeIds) {
        const idSet = new Set(nodeIds);
        const adjacency = Object.fromEntries(nodeIds.map(id => [id, new Set()]));
        connections.forEach(conn => {
            const fromId = getLayoutRootNodeId(conn.from);
            const toId = getLayoutRootNodeId(conn.to);
            if (!fromId || !toId || fromId === toId || !idSet.has(fromId) || !idSet.has(toId)) return;
            adjacency[fromId].add(toId);
            adjacency[toId].add(fromId);
        });

        const visited = new Set();
        const components = [];
        sortNodeIdsByPosition(nodeIds).forEach(startId => {
            if (visited.has(startId)) return;
            const stack = [startId];
            const component = [];
            visited.add(startId);
            while (stack.length) {
                const currentId = stack.pop();
                component.push(currentId);
                adjacency[currentId].forEach(nextId => {
                    if (visited.has(nextId)) return;
                    visited.add(nextId);
                    stack.push(nextId);
                });
            }
            components.push(sortNodeIdsByPosition(component));
        });

        return components;
    }

    function getLayoutConnectionPairs(nodeIds) {
        const idSet = new Set(nodeIds);
        const seenPairs = new Set();
        const pairs = [];

        connections.forEach(conn => {
            const fromId = getLayoutRootNodeId(conn.from);
            const toId = getLayoutRootNodeId(conn.to);
            if (!fromId || !toId || fromId === toId || !idSet.has(fromId) || !idSet.has(toId)) return;

            const pairKey = `${fromId}->${toId}`;
            if (seenPairs.has(pairKey)) return;
            seenPairs.add(pairKey);
            pairs.push({ fromId, toId });
        });

        return pairs;
    }

    function getLayoutEdgePointForMetric(metric, targetX, targetY) {
        if (!metric) return { x: 0, y: 0 };
        const width = metric.width;
        const height = metric.height;
        const centerX = metric.x + width / 2;
        const centerY = metric.y + height / 2;
        const dx = targetX - centerX;
        const dy = targetY - centerY;

        if (dx === 0 && dy === 0) return { x: centerX, y: centerY };

        const nodeType = nodes[metric.id]?.type;
        let t;
        if (nodeType === 'decision') {
            t = 1 / (Math.abs(dx) / (width / 2) + Math.abs(dy) / (height / 2));
        } else if (nodeType === 'start') {
            t = 1 / Math.sqrt(Math.pow(dx / (width / 2), 2) + Math.pow(dy / (height / 2), 2));
        } else {
            const tx = Math.abs(dx) > 0 ? (width / 2) / Math.abs(dx) : Infinity;
            const ty = Math.abs(dy) > 0 ? (height / 2) / Math.abs(dy) : Infinity;
            t = Math.min(tx, ty);
        }

        return {
            x: centerX + dx * t,
            y: centerY + dy * t
        };
    }

    function getLayoutConnectionSegment(connectionPair, positionMap, metricsById) {
        const fromMetric = metricsById[connectionPair.fromId];
        const toMetric = metricsById[connectionPair.toId];
        const fromPosition = positionMap[connectionPair.fromId];
        const toPosition = positionMap[connectionPair.toId];
        if (!fromMetric || !toMetric || !fromPosition || !toPosition) return null;

        const layoutFromMetric = {
            ...fromMetric,
            x: fromPosition.x,
            y: fromPosition.y
        };
        const layoutToMetric = {
            ...toMetric,
            x: toPosition.x,
            y: toPosition.y
        };
        const toCenterX = layoutToMetric.x + layoutToMetric.width / 2;
        const toCenterY = layoutToMetric.y + layoutToMetric.height / 2;
        const fromCenterX = layoutFromMetric.x + layoutFromMetric.width / 2;
        const fromCenterY = layoutFromMetric.y + layoutFromMetric.height / 2;

        return {
            ...connectionPair,
            start: getLayoutEdgePointForMetric(layoutFromMetric, toCenterX, toCenterY),
            end: getLayoutEdgePointForMetric(layoutToMetric, fromCenterX, fromCenterY)
        };
    }

    function getOverlappingTidyConnectionMetrics(segmentA, segmentB) {
        if (!segmentA || !segmentB) return null;
        if (
            segmentA.fromId === segmentB.fromId
            || segmentA.fromId === segmentB.toId
            || segmentA.toId === segmentB.fromId
            || segmentA.toId === segmentB.toId
        ) return null;

        const vectorAX = segmentA.end.x - segmentA.start.x;
        const vectorAY = segmentA.end.y - segmentA.start.y;
        const vectorBX = segmentB.end.x - segmentB.start.x;
        const vectorBY = segmentB.end.y - segmentB.start.y;
        const lengthA = Math.hypot(vectorAX, vectorAY);
        const lengthB = Math.hypot(vectorBX, vectorBY);
        if (lengthA < 1 || lengthB < 1) return null;

        const dirAX = vectorAX / lengthA;
        const dirAY = vectorAY / lengthA;
        const dirBX = vectorBX / lengthB;
        const dirBY = vectorBY / lengthB;
        const crossMagnitude = Math.abs(dirAX * dirBY - dirAY * dirBX);
        if (crossMagnitude > 0.08) return null;

        const normalX = -dirAY;
        const normalY = dirAX;
        const offsetStartX = segmentB.start.x - segmentA.start.x;
        const offsetStartY = segmentB.start.y - segmentA.start.y;
        const offsetEndX = segmentB.end.x - segmentA.start.x;
        const offsetEndY = segmentB.end.y - segmentA.start.y;
        const normalOffsetStart = offsetStartX * normalX + offsetStartY * normalY;
        const normalOffsetEnd = offsetEndX * normalX + offsetEndY * normalY;
        const normalDistance = (Math.abs(normalOffsetStart) + Math.abs(normalOffsetEnd)) / 2;
        if (Math.max(Math.abs(normalOffsetStart), Math.abs(normalOffsetEnd)) > 18) return null;

        const projectedStart = offsetStartX * dirAX + offsetStartY * dirAY;
        const projectedEnd = offsetEndX * dirAX + offsetEndY * dirAY;
        const projectedMin = Math.min(projectedStart, projectedEnd);
        const projectedMax = Math.max(projectedStart, projectedEnd);
        const overlapLength = Math.min(lengthA, projectedMax) - Math.max(0, projectedMin);
        if (overlapLength < 42) return null;

        return { normalDistance, overlapLength };
    }

    function packLayerVertically(nodeIds, positionMap, metricsById, rowGap) {
        if (!nodeIds.length) return;
        const orderedIds = [...nodeIds].sort((a, b) => {
            const deltaY = positionMap[a].y - positionMap[b].y;
            if (Math.abs(deltaY) > 0.1) return deltaY;
            return positionMap[a].x - positionMap[b].x;
        });
        const totalHeight = orderedIds.reduce((sum, id) => sum + metricsById[id].height, 0)
            + rowGap * Math.max(0, orderedIds.length - 1);
        const averageCenterY = orderedIds.reduce((sum, id) => sum + positionMap[id].y + metricsById[id].height / 2, 0) / orderedIds.length;
        let currentY = averageCenterY - totalHeight / 2;

        orderedIds.forEach(id => {
            positionMap[id].y = currentY;
            currentY += metricsById[id].height + rowGap;
        });
    }

    function chooseTidyConnectionShiftNode(segment, otherSegment, layerById, positionMap) {
        const candidateIds = [segment.toId, segment.fromId].filter(id => id !== otherSegment.fromId && id !== otherSegment.toId);
        const sortableIds = candidateIds.length ? candidateIds : [segment.toId, segment.fromId];
        if (!sortableIds.length) return null;

        return sortableIds.sort((a, b) => {
            const layerDelta = (layerById[b] || 0) - (layerById[a] || 0);
            if (layerDelta !== 0) return layerDelta;
            const xDelta = positionMap[b].x - positionMap[a].x;
            if (Math.abs(xDelta) > 0.1) return xDelta;
            return positionMap[b].y - positionMap[a].y;
        })[0];
    }

    function resolveTidyConnectionOverlaps(componentIds, positionMap, metricsById, layerById, layerBuckets, rowGap) {
        const connectionPairs = getLayoutConnectionPairs(componentIds);
        if (connectionPairs.length < 2) return;

        for (let iteration = 0; iteration < 12; iteration += 1) {
            const segments = connectionPairs
                .map(pair => getLayoutConnectionSegment(pair, positionMap, metricsById))
                .filter(Boolean);
            const shiftById = {};
            let overlapCount = 0;

            for (let index = 0; index < segments.length; index += 1) {
                for (let compareIndex = index + 1; compareIndex < segments.length; compareIndex += 1) {
                    const overlapMetrics = getOverlappingTidyConnectionMetrics(segments[index], segments[compareIndex]);
                    if (!overlapMetrics) continue;
                    overlapCount += 1;

                    const anchorA = chooseTidyConnectionShiftNode(segments[index], segments[compareIndex], layerById, positionMap);
                    const anchorB = chooseTidyConnectionShiftNode(segments[compareIndex], segments[index], layerById, positionMap);
                    if (!anchorA || !anchorB || anchorA === anchorB) continue;

                    const midpointAY = (segments[index].start.y + segments[index].end.y) / 2;
                    const midpointBY = (segments[compareIndex].start.y + segments[compareIndex].end.y) / 2;
                    const pushDirection = midpointAY <= midpointBY ? 1 : -1;
                    const pushAmount = Math.max(16, Math.min(40, (22 - overlapMetrics.normalDistance) + overlapMetrics.overlapLength * 0.12));

                    shiftById[anchorA] = (shiftById[anchorA] || 0) - pushDirection * (pushAmount / 2);
                    shiftById[anchorB] = (shiftById[anchorB] || 0) + pushDirection * (pushAmount / 2);
                }
            }

            if (!overlapCount || !Object.keys(shiftById).length) break;

            Object.entries(shiftById).forEach(([id, shiftY]) => {
                if (!positionMap[id]) return;
                positionMap[id].y += Math.max(-64, Math.min(64, shiftY));
            });

            Object.values(layerBuckets).forEach(bucket => {
                packLayerVertically(bucket, positionMap, metricsById, rowGap);
            });
        }
    }

    function buildTidyComponentLayout(componentIds, metricsById) {
        const orderedIds = sortNodeIdsByPosition(componentIds);
        const connectionPairs = getLayoutConnectionPairs(componentIds);
        const indegree = Object.fromEntries(componentIds.map(id => [id, 0]));
        const adjacency = Object.fromEntries(componentIds.map(id => [id, new Set()]));
        const reverseAdjacency = Object.fromEntries(componentIds.map(id => [id, new Set()]));
        const layers = Object.fromEntries(componentIds.map(id => [id, 0]));

        connectionPairs.forEach(({ fromId, toId }) => {
            if (adjacency[fromId].has(toId)) return;
            adjacency[fromId].add(toId);
            reverseAdjacency[toId].add(fromId);
            indegree[toId] += 1;
        });

        Object.keys(adjacency).forEach(id => {
            adjacency[id] = Array.from(adjacency[id]).sort((a, b) => orderedIds.indexOf(a) - orderedIds.indexOf(b));
            reverseAdjacency[id] = Array.from(reverseAdjacency[id]).sort((a, b) => orderedIds.indexOf(a) - orderedIds.indexOf(b));
        });

        const queue = orderedIds.filter(id => indegree[id] === 0);
        const topoOrder = [];
        while (queue.length) {
            const currentId = queue.shift();
            topoOrder.push(currentId);
            adjacency[currentId].forEach(nextId => {
                layers[nextId] = Math.max(layers[nextId], layers[currentId] + 1);
                indegree[nextId] -= 1;
                if (indegree[nextId] === 0) queue.push(nextId);
            });
        }

        const remainingIds = orderedIds.filter(id => !topoOrder.includes(id));
        let maxLayer = topoOrder.length ? Math.max(...topoOrder.map(id => layers[id])) : -1;
        remainingIds.forEach(id => {
            const parentLayer = reverseAdjacency[id].length
                ? Math.max(...reverseAdjacency[id].map(parentId => layers[parentId]))
                : maxLayer;
            maxLayer = Math.max(maxLayer + 1, parentLayer + 1);
            layers[id] = maxLayer;
            topoOrder.push(id);
        });

        const layerBucketsMap = new Map();
        topoOrder.forEach(id => {
            const layer = layers[id];
            if (!layerBucketsMap.has(layer)) layerBucketsMap.set(layer, []);
            layerBucketsMap.get(layer).push(id);
        });

        const layerKeys = [...layerBucketsMap.keys()].sort((a, b) => a - b);
        const fallbackOrderById = Object.fromEntries(orderedIds.map((id, index) => [id, index]));
        const getOrderIndexById = () => {
            const orderIndexById = {};
            layerKeys.forEach(layer => {
                (layerBucketsMap.get(layer) || []).forEach((id, index) => {
                    orderIndexById[id] = index;
                });
            });
            return orderIndexById;
        };
        const sortLayerBucketByScore = (layer, relatedIdsByNode) => {
            const orderIndexById = getOrderIndexById();
            const bucket = [...(layerBucketsMap.get(layer) || [])];
            bucket.sort((a, b) => {
                const relatedA = relatedIdsByNode[a] || [];
                const relatedB = relatedIdsByNode[b] || [];
                const scoreA = relatedA.length
                    ? relatedA.reduce((sum, id) => sum + (Number.isFinite(orderIndexById[id]) ? orderIndexById[id] : fallbackOrderById[id]), 0) / relatedA.length
                    : fallbackOrderById[a];
                const scoreB = relatedB.length
                    ? relatedB.reduce((sum, id) => sum + (Number.isFinite(orderIndexById[id]) ? orderIndexById[id] : fallbackOrderById[id]), 0) / relatedB.length
                    : fallbackOrderById[b];
                if (Math.abs(scoreA - scoreB) > 0.001) return scoreA - scoreB;
                return fallbackOrderById[a] - fallbackOrderById[b];
            });
            layerBucketsMap.set(layer, bucket);
        };

        for (let iteration = 0; iteration < 4; iteration += 1) {
            layerKeys.slice(1).forEach(layer => sortLayerBucketByScore(layer, reverseAdjacency));
            [...layerKeys].reverse().slice(1).forEach(layer => sortLayerBucketByScore(layer, adjacency));
        }

        const componentMetrics = componentIds.map(id => metricsById[id]);
        const medianWidth = getMedianMetricSize(componentMetrics, 'width');
        const medianHeight = getMedianMetricSize(componentMetrics, 'height');
        const columnGap = Math.max(150, Math.min(300, Math.round(medianWidth * 0.7 + 56)));
        const rowGap = Math.max(90, Math.min(180, Math.round(medianHeight * 0.6 + 38)));
        const layerHeights = {};
        const layerWidths = {};
        let componentHeight = 0;

        layerKeys.forEach(layer => {
            const bucket = layerBucketsMap.get(layer) || [];
            layerWidths[layer] = Math.max(...bucket.map(id => metricsById[id].width));
            layerHeights[layer] = bucket.reduce((sum, id) => sum + metricsById[id].height, 0) + rowGap * Math.max(0, bucket.length - 1);
            componentHeight = Math.max(componentHeight, layerHeights[layer]);
        });

        const localPositions = {};
        const layerById = {};
        const layerBuckets = {};
        let currentX = 0;
        layerKeys.forEach(layer => {
            const bucket = layerBucketsMap.get(layer) || [];
            layerBuckets[layer] = [...bucket];
            let currentY = (componentHeight - layerHeights[layer]) / 2;

            bucket.forEach(id => {
                localPositions[id] = {
                    x: currentX + (layerWidths[layer] - metricsById[id].width) / 2,
                    y: currentY
                };
                layerById[id] = layer;
                currentY += metricsById[id].height + rowGap;
            });

            currentX += layerWidths[layer] + columnGap;
        });

        resolveTidyConnectionOverlaps(componentIds, localPositions, metricsById, layerById, layerBuckets, rowGap);

        const normalizedBounds = getNodeBounds(componentIds.map(id => ({
            id,
            x: localPositions[id].x,
            y: localPositions[id].y,
            width: metricsById[id].width,
            height: metricsById[id].height
        })));
        const normalizedPositions = {};
        componentIds.forEach(id => {
            normalizedPositions[id] = {
                x: localPositions[id].x - normalizedBounds.left,
                y: localPositions[id].y - normalizedBounds.top
            };
        });

        return {
            positions: normalizedPositions,
            width: normalizedBounds.width,
            height: normalizedBounds.height
        };
    }

    function runVisualTidyLayout() {
        const selectedIds = getSelectedVisibleNodeIds();
        const nodeIds = selectedIds.length > 1 ? selectedIds : getVisibleNodeIds();
        if (nodeIds.length < 2) return;

        const metrics = getNodeMetrics(nodeIds);
        const metricsById = Object.fromEntries(metrics.map(metric => [metric.id, metric]));
        const bounds = getNodeBounds(metrics);
        const packWidth = Math.max(bounds.width, Math.min(viewport.clientWidth / zoom, 1400));
        const componentGapX = 140;
        const componentGapY = 110;
        const components = buildConnectedComponents(nodeIds).map(componentIds => {
            const componentLayout = buildTidyComponentLayout(componentIds, metricsById);
            const componentMetrics = componentIds.map(id => metricsById[id]);

            return {
                ids: componentIds,
                positions: componentLayout.positions,
                width: componentLayout.width,
                height: componentLayout.height,
                top: Math.min(...componentMetrics.map(metric => metric.y)),
                left: Math.min(...componentMetrics.map(metric => metric.x))
            };
        }).sort((a, b) => (a.top - b.top) || (a.left - b.left));

        const positionMap = {};
        let currentX = bounds.left;
        let currentY = bounds.top;
        let rowHeight = 0;

        components.forEach(component => {
            if (currentX > bounds.left && currentX + component.width > bounds.left + packWidth) {
                currentX = bounds.left;
                currentY += rowHeight + componentGapY;
                rowHeight = 0;
            }

            component.ids.forEach((id, index) => {
                const localPosition = component.positions[id];
                positionMap[id] = {
                    x: currentX + localPosition.x,
                    y: currentY + localPosition.y
                };
            });

            currentX += component.width + componentGapX;
            rowHeight = Math.max(rowHeight, component.height);
        });

        applyNodePositions(positionMap);
        showToast(`Tidy layout: ${nodeIds.length} nodes`, 'success', 2200);
    }
