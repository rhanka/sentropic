<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { Chart, registerables } from 'chart.js';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import { dev } from '$app/environment';

  export let useCases: any[] = [];
  export let matrix: MatrixConfig | null = null;
  export let roiStats: { count: number; avgValue: number; avgComplexity: number } = { count: 0, avgValue: 0, avgComplexity: 0 };
  export let showROIQuadrant: boolean = false;
  export let valueThreshold: number | null = null; // Seuil personnalisé pour la valeur (null = utiliser médiane)
  export let complexityThreshold: number | null = null; // Seuil personnalisé pour la complexité (null = utiliser médiane)
  export let medianValue: number = 0; // Médiane calculée (bindable)
  export let medianComplexity: number = 0; // Médiane calculée (bindable)

  let chartContainer: HTMLCanvasElement;
  let chartInstance: Chart | null = null;
  
  // Utiliser les seuils passés en props ou les médianes
  $: effectiveValueThreshold = valueThreshold !== null ? valueThreshold : computedMedianValue;
  $: effectiveComplexityThreshold = complexityThreshold !== null ? complexityThreshold : computedMedianComplexity;

  // --- Helpers pour placement personnalisé des labels ---
  const LABEL_FONT = '9px "Inter", "DM Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const MAX_LABEL_WIDTH = 140;
  const LABEL_PADDING_X = 3;
  const LABEL_PADDING_TOP = 3;
  const LABEL_PADDING_BOTTOM = 0;
  const LINE_HEIGHT = 14;
  const LABEL_ANCHOR_PADDING = 4;
  const BASE_LABEL_OFFSET = 16;
  const MIN_INITIAL_OFFSET = 4;
  const MOVE_MAGNITUDE_FACTOR = 2;
  const MOVE_MIN_SHIFT = 4;
  const CLIQUE_SWAP_PROBABILITY = 0.25;
  const POINT_OVERLAP_WEIGHT = 1000;
  const TRAIT_LABEL_COST = 500;
  const TRAIT_POINT_COST = 200;
  const TRAIT_TRAIT_COST = 100;
  const QUADRANT_LABEL_COST = 300; // Coût d'évitement des boîtes de quadrant fixes
  const CLIQUE_JITTER_RATIO = 0.50;
  const MAX_CLIQUE_ATTEMPTS = 20;
  const ANNEALING_RUNS = 20;
  const ANNEALING_ITERATIONS = 40;
  const INITIAL_TEMPERATURE = 40;
  const MIN_TEMPERATURE = 5;
  const TEMPERATURE_DECAY = 1;
  
  // Couleurs du thème
  const THEME_BLUE = '#475569'; // Bleu-gris foncé pour cadres, traits et points
  const THEME_BLUE_RGB = '71, 85, 105'; // RGB pour rgba()
  const THEME_TEXT_DARK = '#0f172a'; // Gris foncé pour le texte (valeur/complexité)

  type LabelPlacement = 'left' | 'right' | 'top' | 'bottom';

  type LabelLayout = {
    lines: string[];
    width: number;
    height: number;
  };

  type LabelBox = {
    left: number;
    top: number;
    width: number;
    height: number;
    textLines: string[];
    point: { x: number; y: number };
    pointKey: string;
    pointId?: string | number;
    pointLabel?: string;
    isLeft: boolean;
    color: string;
    placement: LabelPlacement;
    alternates: LabelLayout[];
  };

  type CollisionIssue =
    | { type: 'selfPoint'; weight: number; vector: { x: number; y: number } }
    | { type: 'label'; targetIndex: number; weight: number; vector: { x: number; y: number } }
    | { type: 'point'; targetIndex?: number; weight: number; vector: { x: number; y: number } }
    | { type: 'lineLabel'; targetIndex: number; weight: number; vector: { x: number; y: number } }
    | { type: 'linePoint'; targetIndex?: number; weight: number; vector: { x: number; y: number } }
    | { type: 'lineLine'; targetIndex: number; weight: number; vector: { x: number; y: number } }
    | { type: 'quadrant'; weight: number; vector: { x: number; y: number } };

  type PerLabelStats = {
    index: number;
    cost: number;
    edges: Map<number, number>;
    issues: CollisionIssue[];
  };

  const STATUS_COLORS: Record<string, string> = {
    completed: '34, 197, 94',
    generating: '251, 191, 36',
    detailing: '59, 130, 246',
    default: '100, 116, 139'
  };

  const ENABLE_LAYOUT_DEBUG = false;

  function getStatusColorInfo(status?: string) {
    const rgb = STATUS_COLORS[status ?? 'default'] ?? STATUS_COLORS.default;
    return {
      rgb,
      solid: `rgb(${rgb})`,
      withAlpha: (alpha: number) => `rgba(${rgb}, ${alpha})`
    };
  }

  function logLabelAction(box: LabelBox, message: string, extra?: any) {
    if (!ENABLE_LAYOUT_DEBUG) return;
    const name = box.textLines[0] ?? 'Label';
    if (extra) {
      console.debug(`[Labels][${name}] ${message}`, extra);
    } else {
      console.debug(`[Labels][${name}] ${message}`);
    }
  }

  function getPointKey(raw: any, fallbackIndex: number) {
    if (raw?.id) return `id:${raw.id}`;
    if (raw?.label) return `label:${raw.label}`;
    return `idx:${fallbackIndex}`;
  }

  function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    words.forEach((word) => {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const { width } = ctx.measureText(testLine);
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });
    if (currentLine) {
      lines.push(currentLine);
    }
    return lines;
  }

  function computeBalanceScore(lines: string[]) {
    if (lines.length <= 1) return 0;
    const lengths = lines.map((line) => Math.max(line.trim().length, 1));
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);
    return (maxLen - minLen) / maxLen;
  }

  function findBalancedVariant(
    text: string,
    ctx: CanvasRenderingContext2D,
    expectedLines: number,
    widthCandidates: number[]
  ): string[] | null {
    let bestLines: string[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestWidth = Number.POSITIVE_INFINITY;
    widthCandidates.forEach((candidate) => {
      const lines = wrapText(ctx, text, candidate);
      if (lines.length !== expectedLines) return;
      const score = computeBalanceScore(lines);
      const actualWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 0);
      if (
        score < bestScore - 0.05 ||
        (Math.abs(score - bestScore) < 0.05 && actualWidth < bestWidth)
      ) {
        bestLines = lines;
        bestScore = score;
        bestWidth = actualWidth;
      }
    });
    return bestLines;
  }

  function createLayout(lines: string[], ctx: CanvasRenderingContext2D): LabelLayout {
    const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 0);
    const width = textWidth + LABEL_PADDING_X * 2;
    const height = lines.length * LINE_HEIGHT + LABEL_PADDING_TOP + LABEL_PADDING_BOTTOM;
    return { lines, width, height };
  }

  function cloneLayout(layout: LabelLayout): LabelLayout {
    return {
      lines: [...layout.lines],
      width: layout.width,
      height: layout.height
    };
  }

  function shuffleArray<T>(items: T[]): T[] {
    const array = [...items];
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function snapshotBox(box: LabelBox) {
    return {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      textLines: [...box.textLines],
      alternates: box.alternates.map((layout) => cloneLayout(layout)),
      placement: box.placement,
      isLeft: box.isLeft
    };
  }

  function restoreBox(target: LabelBox, snapshot: ReturnType<typeof snapshotBox>) {
    target.left = snapshot.left;
    target.top = snapshot.top;
    target.width = snapshot.width;
    target.height = snapshot.height;
    target.textLines = [...snapshot.textLines];
    target.alternates = snapshot.alternates.map((layout) => cloneLayout(layout));
    target.placement = snapshot.placement;
    target.isLeft = snapshot.isLeft;
  }

  function buildLabelLayouts(text: string, ctx: CanvasRenderingContext2D): LabelLayout[] {
    const layouts: LabelLayout[] = [];
    const singleWidth = ctx.measureText(text).width + LABEL_PADDING_X * 2;
    if (singleWidth <= MAX_LABEL_WIDTH && text.length <= 25) {
      layouts.push(createLayout([text], ctx));
    } else {
      const twoLineWidths = [80, 90, 100, 110, 120, 130, MAX_LABEL_WIDTH];
      const twoLines = findBalancedVariant(text, ctx, 2, twoLineWidths);
      if (twoLines) {
        layouts.push(createLayout(twoLines, ctx));
      }

      const threeLineWidths = [70, 80, 90, 100, 110, MAX_LABEL_WIDTH];
      const threeLines = findBalancedVariant(text, ctx, 3, threeLineWidths);
      if (threeLines) {
        layouts.push(createLayout(threeLines, ctx));
      }
    }

    const fallback = wrapText(ctx, text, MAX_LABEL_WIDTH);
    layouts.push(createLayout(fallback, ctx));

    return layouts;
  }

  function boxesOverlap(a: LabelBox, b: LabelBox) {
    return !(
      a.left + a.width < b.left ||
      a.left > b.left + b.width ||
      a.top + a.height < b.top ||
      a.top > b.top + b.height
    );
  }

  function rectsOverlap(a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }) {
    return !(
      a.left + a.width < b.left ||
      a.left > b.left + b.width ||
      a.top + a.height < b.top ||
      a.top > b.top + b.height
    );
  }

  function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  function getLabelAnchorPoint(box: LabelBox) {
    const safeLeft = box.left + LABEL_ANCHOR_PADDING;
    const safeRight = box.left + box.width - LABEL_ANCHOR_PADDING;
    const safeTop = box.top + LABEL_ANCHOR_PADDING;
    const safeBottom = box.top + box.height - LABEL_ANCHOR_PADDING;
    switch (box.placement) {
      case 'left':
        return {
          x: box.left + box.width,
          y: clamp(box.point.y, safeTop, safeBottom)
        };
      case 'right':
        return {
          x: box.left,
          y: clamp(box.point.y, safeTop, safeBottom)
        };
      case 'top':
        return {
          x: clamp(box.point.x, safeLeft, safeRight),
          y: box.top + box.height
        };
      case 'bottom':
        return {
          x: clamp(box.point.x, safeLeft, safeRight),
          y: box.top
        };
      default:
        return {
          x: box.isLeft ? box.left + box.width : box.left,
          y: clamp(box.point.y, safeTop, safeBottom)
        };
    }
  }

  function pointInRect(px: number, py: number, rect: { left: number; top: number; width: number; height: number }) {
    return px >= rect.left && px <= rect.left + rect.width && py >= rect.top && py <= rect.top + rect.height;
  }

  function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
    const val = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
    if (Math.abs(val) < 1e-6) return 0;
    return val > 0 ? 1 : 2;
  }

  function onSegment(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
    return (
      cx >= Math.min(ax, bx) - 1e-6 &&
      cx <= Math.max(ax, bx) + 1e-6 &&
      cy >= Math.min(ay, by) - 1e-6 &&
      cy <= Math.max(ay, by) + 1e-6
    );
  }

  function segmentsIntersect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    x4: number,
    y4: number
  ) {
    const o1 = orientation(x1, y1, x2, y2, x3, y3);
    const o2 = orientation(x1, y1, x2, y2, x4, y4);
    const o3 = orientation(x3, y3, x4, y4, x1, y1);
    const o4 = orientation(x3, y3, x4, y4, x2, y2);

    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(x1, y1, x2, y2, x3, y3)) return true;
    if (o2 === 0 && onSegment(x1, y1, x2, y2, x4, y4)) return true;
    if (o3 === 0 && onSegment(x3, y3, x4, y4, x1, y1)) return true;
    if (o4 === 0 && onSegment(x3, y3, x4, y4, x2, y2)) return true;
    return false;
  }

  function segmentIntersectsRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    rect: { left: number; top: number; width: number; height: number }
  ) {
    if (pointInRect(x1, y1, rect) || pointInRect(x2, y2, rect)) return true;
    const edges = [
      [rect.left, rect.top, rect.left + rect.width, rect.top],
      [rect.left + rect.width, rect.top, rect.left + rect.width, rect.top + rect.height],
      [rect.left + rect.width, rect.top + rect.height, rect.left, rect.top + rect.height],
      [rect.left, rect.top + rect.height, rect.left, rect.top]
    ] as const;
    return edges.some(([ex1, ey1, ex2, ey2]) => segmentsIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2));
  }

  function distancePointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
      return Math.hypot(px - x1, py - y1);
    }
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function resolveVerticalOverlaps(boxes: LabelBox[], chartArea: any) {
    if (boxes.length === 0) return;
    const spacing = 6;
    boxes.sort((a, b) => a.top - b.top);

    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1];
      const current = boxes[i];
      const overlap = prev.top + prev.height + spacing - current.top;
      if (overlap > 0) {
        current.top += overlap;
      }
    }

    for (let i = boxes.length - 2; i >= 0; i--) {
      const next = boxes[i + 1];
      const current = boxes[i];
      const overlap = current.top + current.height + spacing - next.top;
      if (overlap > 0) {
        current.top -= overlap;
      }
    }

    const minTop = chartArea.top + 4;
    const maxBottom = chartArea.bottom - 4;
    const currentMinTop = Math.min(...boxes.map((box) => box.top));
    const currentMaxBottom = Math.max(...boxes.map((box) => box.top + box.height));

    if (currentMinTop < minTop) {
      const shift = minTop - currentMinTop;
      boxes.forEach((box) => (box.top += shift));
    }
    if (currentMaxBottom > maxBottom) {
      const shift = currentMaxBottom - maxBottom;
      boxes.forEach((box) => (box.top -= shift));
    }
  }

  function updateBoxPlacement(box: LabelBox) {
    if (!box.point) return;
    const boxCenterX = box.left + box.width / 2;
    const boxCenterY = box.top + box.height / 2;
    const dx = box.point.x - boxCenterX;
    const dy = box.point.y - boxCenterY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx > absDy) {
      box.placement = dx >= 0 ? 'left' : 'right';
    } else {
      box.placement = dy >= 0 ? 'top' : 'bottom';
    }
  }

  function clampLabelBox(box: LabelBox, chartArea: any) {
    box.left = clamp(box.left, chartArea.left + 4, chartArea.right - box.width - 4);
    box.top = clamp(box.top, chartArea.top + 4, chartArea.bottom - box.height - 4);
    updateBoxPlacement(box);
  }

  function getQuadrantBoxes(chartArea: any, medianX: number, medianY: number, xScale: any, yScale: any) {
    if (!xScale || !yScale) return [];
    const labelPadding = 8;
    const labelHeight = 24;
    const labelOffset = 8;
    
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return [];
    ctx.font = 'bold 11px "Inter", "DM Sans", system-ui, sans-serif';
    
    const boxes = [];
    
    // "Gains rapide" (haut gauche)
    const gainsRapideText = 'Gains rapide';
    const gainsRapideWidth = ctx.measureText(gainsRapideText).width + labelPadding * 2;
    boxes.push({
      left: chartArea.left + labelOffset,
      top: chartArea.top + labelOffset,
      width: gainsRapideWidth,
      height: labelHeight,
      label: 'Gains rapide'
    });
    
    // "Projets majeurs" (haut droite)
    const projetsMajeursText = 'Projets majeurs';
    const projetsMajeursWidth = ctx.measureText(projetsMajeursText).width + labelPadding * 2;
    boxes.push({
      left: chartArea.right - labelOffset - projetsMajeursWidth,
      top: chartArea.top + labelOffset,
      width: projetsMajeursWidth,
      height: labelHeight,
      label: 'Projets majeurs'
    });
    
    // "Attendre" (bas gauche)
    const attendreText = 'Attendre';
    const attendreWidth = ctx.measureText(attendreText).width + labelPadding * 2;
    boxes.push({
      left: chartArea.left + labelOffset,
      top: chartArea.bottom - labelOffset - labelHeight,
      width: attendreWidth,
      height: labelHeight,
      label: 'Attendre'
    });
    
    // "Ne pas faire" (bas droite)
    const nePasFaireText = 'Ne pas faire';
    const nePasFaireWidth = ctx.measureText(nePasFaireText).width + labelPadding * 2;
    boxes.push({
      left: chartArea.right - labelOffset - nePasFaireWidth,
      top: chartArea.bottom - labelOffset - labelHeight,
      width: nePasFaireWidth,
      height: labelHeight,
      label: 'Ne pas faire'
    });
    
    return boxes;
  }

  function computeLabelStats(boxes: LabelBox[], points: any[], chartArea?: any, medianX?: number, medianY?: number, xScale?: any, yScale?: any) {
    let cost = 0;
    let labelCollisions = 0;
    let pointCollisions = 0;
    let lineLabelCollisions = 0;
    let linePointCollisions = 0;
    let lineCrossCollisions = 0;
    let quadrantCollisions = 0;
    const labelCollisionPairs: string[] = [];
    const pointCollisionsList: string[] = [];
    const lineLabelPairs: string[] = [];
    const linePointPairs: string[] = [];
    const lineCrossPairs: string[] = [];
    const quadrantCollisionPairs: string[] = [];
    const perLabel: PerLabelStats[] = boxes.map((_, index) => ({
      index,
      cost: 0,
      edges: new Map(),
      issues: []
    }));

    const pointOwnerMap = new Map<string, number>();
    boxes.forEach((box, index) => {
      pointOwnerMap.set(box.pointKey, index);
    });

    const ensureVector = (vx: number, vy: number) => {
      if (Math.abs(vx) < 1e-3 && Math.abs(vy) < 1e-3) {
        return { x: (Math.random() - 0.5) * 0.1, y: (Math.random() - 0.5) * 0.1 };
      }
      return { x: vx, y: vy };
    };

    const addEdge = (from: number, to: number, weight: number) => {
      if (from === to || weight <= 0) return;
      const current = perLabel[from].edges.get(to) ?? 0;
      perLabel[from].edges.set(to, current + weight);
    };

    const anchors = boxes.map((box) => getLabelAnchorPoint(box));

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!boxesOverlap(boxes[i], boxes[j])) continue;
        const overlapWidth =
          Math.min(boxes[i].left + boxes[i].width, boxes[j].left + boxes[j].width) -
          Math.max(boxes[i].left, boxes[j].left);
        const overlapHeight =
          Math.min(boxes[i].top + boxes[i].height, boxes[j].top + boxes[j].height) -
          Math.max(boxes[i].top, boxes[j].top);
        const overlapArea = Math.max(overlapWidth, 0) * Math.max(overlapHeight, 0);
        if (overlapArea <= 0) continue;
        cost += overlapArea;
        labelCollisions++;
        labelCollisionPairs.push(`${boxes[i].textLines[0] ?? 'Label'} ↔ ${boxes[j].textLines[0] ?? 'Label'}`);

        const centerIX = boxes[i].left + boxes[i].width / 2;
        const centerIY = boxes[i].top + boxes[i].height / 2;
        const centerJX = boxes[j].left + boxes[j].width / 2;
        const centerJY = boxes[j].top + boxes[j].height / 2;
        const vecIJ = ensureVector(centerIX - centerJX, centerIY - centerJY);
        const vecJI = ensureVector(centerJX - centerIX, centerJY - centerIY);

        perLabel[i].cost += overlapArea;
        perLabel[j].cost += overlapArea;
        perLabel[i].issues.push({ type: 'label', targetIndex: j, weight: overlapArea, vector: vecIJ });
        perLabel[j].issues.push({ type: 'label', targetIndex: i, weight: overlapArea, vector: vecJI });
        addEdge(i, j, overlapArea);
        addEdge(j, i, overlapArea);
      }
    }

    boxes.forEach((box, index) => {
      const boxCenterX = box.left + box.width / 2;
      const boxCenterY = box.top + box.height / 2;
      const anchor = anchors[index];
      points.forEach((pointData: any, pointIdx: number) => {
        if (!pointData.element) return;
        const pointX = pointData.element.x;
        const pointY = pointData.element.y;
        const baseRadius = pointData.element.options?.radius ?? 5;
        const radius = baseRadius * 1.3;
        const overlapWidth =
          Math.min(pointX + radius, box.left + box.width) - Math.max(pointX - radius, box.left);
        const overlapHeight =
          Math.min(pointY + radius, box.top + box.height) - Math.max(pointY - radius, box.top);
        if (overlapWidth <= 0 || overlapHeight <= 0) return;
        const overlapArea = overlapWidth * overlapHeight;
        const circleBoundingArea = (radius * 2) * (radius * 2);
        const coverageRatio = Math.min(overlapArea / circleBoundingArea, 1);
        const weight = POINT_OVERLAP_WEIGHT * coverageRatio;
        cost += weight;
        pointCollisions++;
        pointCollisionsList.push(
          `${box.textLines[0] ?? 'Label'} ↔ ${pointData.raw?.label ?? pointIdx} (${(coverageRatio * 100).toFixed(0)}%)`
        );

        const pointKey = getPointKey(pointData.raw, pointIdx);
        const ownerIndex = pointOwnerMap.get(pointKey);
        const vector = ensureVector(boxCenterX - pointX, boxCenterY - pointY);
        perLabel[index].cost += weight;

        if (ownerIndex !== undefined && ownerIndex !== index) {
          perLabel[index].issues.push({ type: 'point', targetIndex: ownerIndex, weight, vector });
          addEdge(index, ownerIndex, weight);
        } else {
          perLabel[index].issues.push({ type: 'selfPoint', weight, vector });
        }
      });
    });

    boxes.forEach((box, index) => {
      const anchor = anchors[index];
      const startX = box.point.x;
      const startY = box.point.y;
      const centerX = box.left + box.width / 2;
      const centerY = box.top + box.height / 2;

      boxes.forEach((other, otherIndex) => {
        if (index === otherIndex) return;
        if (
          segmentIntersectsRect(startX, startY, anchor.x, anchor.y, {
            left: other.left,
            top: other.top,
            width: other.width,
            height: other.height
          })
        ) {
          cost += TRAIT_LABEL_COST;
          lineLabelCollisions++;
          lineLabelPairs.push(`${box.textLines[0] ?? 'Label'} ↔ ${other.textLines[0] ?? 'Label'}`);
          const vector = ensureVector(centerX - (other.left + other.width / 2), centerY - (other.top + other.height / 2));
          perLabel[index].cost += TRAIT_LABEL_COST;
          perLabel[index].issues.push({ type: 'lineLabel', targetIndex: otherIndex, weight: TRAIT_LABEL_COST, vector });
          addEdge(index, otherIndex, TRAIT_LABEL_COST);
        }
      });

      points.forEach((pointData: any, pointIdx: number) => {
        if (!pointData.element) return;
        const pointKey = getPointKey(pointData.raw, pointIdx);
        if (pointKey === box.pointKey) return;
        const px = pointData.element.x;
        const py = pointData.element.y;
        const radius = (pointData.element.options?.radius ?? 5) * 1.3;
        const distance = distancePointToSegment(px, py, startX, startY, anchor.x, anchor.y);
        if (distance > radius) return;
        cost += TRAIT_POINT_COST;
        linePointCollisions++;
        linePointPairs.push(`${box.textLines[0] ?? 'Label'} ↔ trait(${pointData.raw?.label ?? pointIdx})`);
        const vector = ensureVector(centerX - px, centerY - py);
        perLabel[index].cost += TRAIT_POINT_COST;
        perLabel[index].issues.push({
          type: 'linePoint',
          targetIndex: pointOwnerMap.get(pointKey),
          weight: TRAIT_POINT_COST,
          vector
        });
        const ownerIndex = pointOwnerMap.get(pointKey);
        if (ownerIndex !== undefined) {
          addEdge(index, ownerIndex, TRAIT_POINT_COST);
        }
      });
    });

    for (let i = 0; i < boxes.length; i++) {
      const startX = boxes[i].point.x;
      const startY = boxes[i].point.y;
      const anchorI = anchors[i];
      const centerIX = boxes[i].left + boxes[i].width / 2;
      const centerIY = boxes[i].top + boxes[i].height / 2;
      for (let j = i + 1; j < boxes.length; j++) {
        const startXJ = boxes[j].point.x;
        const startYJ = boxes[j].point.y;
        const anchorJ = anchors[j];
        if (
          segmentsIntersect(startX, startY, anchorI.x, anchorI.y, startXJ, startYJ, anchorJ.x, anchorJ.y)
        ) {
          cost += TRAIT_TRAIT_COST;
          lineCrossCollisions++;
          lineCrossPairs.push(`${boxes[i].textLines[0] ?? 'Label'} ↔ trait(${boxes[j].textLines[0] ?? 'Label'})`);
          const vecIJ = ensureVector(centerIX - (boxes[j].left + boxes[j].width / 2), centerIY - (boxes[j].top + boxes[j].height / 2));
          const vecJI = ensureVector(-vecIJ.x, -vecIJ.y);
          perLabel[i].cost += TRAIT_TRAIT_COST;
          perLabel[j].cost += TRAIT_TRAIT_COST;
          perLabel[i].issues.push({ type: 'lineLine', targetIndex: j, weight: TRAIT_TRAIT_COST, vector: vecIJ });
          perLabel[j].issues.push({ type: 'lineLine', targetIndex: i, weight: TRAIT_TRAIT_COST, vector: vecJI });
          addEdge(i, j, TRAIT_TRAIT_COST);
          addEdge(j, i, TRAIT_TRAIT_COST);
        }
      }
    }

    // Détection des collisions avec les boîtes de quadrant fixes
    if (chartArea && medianX !== undefined && medianY !== undefined && xScale && yScale) {
      const quadrantBoxes = getQuadrantBoxes(chartArea, medianX, medianY, xScale, yScale);
      boxes.forEach((box, index) => {
        const boxCenterX = box.left + box.width / 2;
        const boxCenterY = box.top + box.height / 2;
        quadrantBoxes.forEach((quadBox) => {
          if (rectsOverlap(box, quadBox)) {
            const overlapWidth =
              Math.min(box.left + box.width, quadBox.left + quadBox.width) -
              Math.max(box.left, quadBox.left);
            const overlapHeight =
              Math.min(box.top + box.height, quadBox.top + quadBox.height) -
              Math.max(box.top, quadBox.top);
            const overlapArea = Math.max(overlapWidth, 0) * Math.max(overlapHeight, 0);
            if (overlapArea <= 0) return;
            const weight = QUADRANT_LABEL_COST * (overlapArea / (box.width * box.height));
            cost += weight;
            quadrantCollisions++;
            quadrantCollisionPairs.push(`${box.textLines[0] ?? 'Label'} ↔ ${quadBox.label}`);
            const vector = ensureVector(
              boxCenterX - (quadBox.left + quadBox.width / 2),
              boxCenterY - (quadBox.top + quadBox.height / 2)
            );
            perLabel[index].cost += weight;
            perLabel[index].issues.push({ type: 'quadrant', weight, vector });
          }
        });
      });
    }

    return {
      cost,
      labelCollisions,
      pointCollisions,
      lineLabelCollisions,
      linePointCollisions,
      lineCrossCollisions,
      quadrantCollisions,
      labelCollisionPairs,
      pointCollisionsList,
      lineLabelPairs,
      linePointPairs,
      lineCrossPairs,
      quadrantCollisionPairs,
      perLabel
    };
  }

  function buildCliques(stats: ReturnType<typeof computeLabelStats>) {
    const cliques: { indices: number[]; cost: number }[] = [];
    const visited = new Array(stats.perLabel.length).fill(false);

    for (let i = 0; i < stats.perLabel.length; i++) {
      const node = stats.perLabel[i];
      if (node.cost <= 0 || visited[i]) continue;
      const indices: number[] = [];
      let cost = 0;
      const queue = [i];
      visited[i] = true;

      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentNode = stats.perLabel[current];
        if (currentNode.cost <= 0) continue;
        indices.push(current);
        cost += currentNode.cost;
        currentNode.edges.forEach((weight, neighbor) => {
          if (weight <= 0) return;
          if (neighbor < 0 || neighbor >= stats.perLabel.length) return;
          if (visited[neighbor]) return;
          if (stats.perLabel[neighbor].cost <= 0) return;
          visited[neighbor] = true;
          queue.push(neighbor);
        });
      }

      if (indices.length > 0) {
        cliques.push({ indices, cost });
      }
    }

    return cliques.sort((a, b) => b.cost - a.cost);
  }

  function attemptCliqueMove(
    clique: { indices: number[]; cost: number },
    boxes: LabelBox[],
    stats: ReturnType<typeof computeLabelStats>,
    chartArea: any,
    temperature: number,
    points: any[],
    medianX?: number,
    medianY?: number,
    xScale?: any,
    yScale?: any
  ) {
    const totalCost = clique.cost || 0;
    if (totalCost <= 0) {
      return { accepted: false };
    }

    const snapshots = clique.indices.map((index) => ({ index, snapshot: snapshotBox(boxes[index]) }));
    const moveMagnitude = Math.max(temperature * MOVE_MAGNITUDE_FACTOR, MOVE_MIN_SHIFT);
    const useSwapStrategy = clique.indices.length >= 2 && Math.random() < CLIQUE_SWAP_PROBABILITY;

    clique.indices.forEach((index) => {
      const box = boxes[index];
      if (!useSwapStrategy && Math.random() < 0.3) {
        tryAlternateLayout(box, chartArea);
      }
    });

    if (useSwapStrategy) {
      const shuffledIndices = shuffleArray(clique.indices);
      const firstIndex = shuffledIndices[0];
      const secondIndex = shuffledIndices[1];
      const firstBox = boxes[firstIndex];
      const secondBox = boxes[secondIndex];
      const tmpTop = firstBox.top;
      firstBox.top = secondBox.top;
      secondBox.top = tmpTop;
      clampLabelBox(firstBox, chartArea);
      clampLabelBox(secondBox, chartArea);
      if (ENABLE_LAYOUT_DEBUG) {
        console.debug(
          `[Labels][clique] tentative swapY ${firstBox.textLines[0] ?? 'Label'} ↔ ${secondBox.textLines[0] ?? 'Label'}`
        );
      }
    } else {
      clique.indices.forEach((index) => {
        const box = boxes[index];
        const node = stats.perLabel[index];
        const targetVector = node.issues.reduce(
          (acc, issue) => {
            const factor = node.cost > 0 ? issue.weight / node.cost : 0;
            acc.x += issue.vector.x * factor;
            acc.y += issue.vector.y * factor;
            return acc;
          },
          { x: 0, y: 0 }
        );
        targetVector.x += (Math.random() - 0.5) * temperature * CLIQUE_JITTER_RATIO;
        targetVector.y += (Math.random() - 0.5) * temperature * CLIQUE_JITTER_RATIO;

        const length = Math.hypot(targetVector.x, targetVector.y) || 1;
        const scale =
          moveMagnitude *
          (node.cost / totalCost) *
          (0.7 + Math.random() * 0.6);
        const dx = (targetVector.x / length) * scale;
        const dy = (targetVector.y / length) * scale;
        box.left += dx;
        box.top += dy;
        clampLabelBox(box, chartArea);
      });
    }

    const newStats = computeLabelStats(boxes, points, chartArea, medianX, medianY, xScale, yScale);
    if (newStats.cost < stats.cost) {
      if (ENABLE_LAYOUT_DEBUG) {
        console.debug(
          `[Labels][clique] amélioration acceptée | Δ=${(stats.cost - newStats.cost).toFixed(2)} | taille=${clique.indices.length}`
        );
      }
      return { accepted: true, stats: newStats };
    }

    snapshots.forEach(({ index, snapshot }) => {
      restoreBox(boxes[index], snapshot);
    });
    return { accepted: false };
  }

  function tryAlternateLayout(box: LabelBox, chartArea: any) {
    if (!box.alternates || box.alternates.length === 0) {
      return false;
    }
    const next = box.alternates.shift()!;
    box.alternates.push({
      lines: [...box.textLines],
      width: box.width,
      height: box.height
    });
    box.textLines = [...next.lines];
    box.width = next.width;
    box.height = next.height;
    clampLabelBox(box, chartArea);
    return true;
  }

  function runLabelAnnealing(initialBoxes: LabelBox[], chartArea: any, points: any[], medianX?: number, medianY?: number, xScale?: any, yScale?: any): LabelBox[] {
    if (initialBoxes.length <= 1) return initialBoxes;

    const runs = ANNEALING_RUNS;
    const iterationsPerRun = ANNEALING_ITERATIONS;
    let bestBoxes = initialBoxes.map((box) => ({ ...box }));
    let bestStats = computeLabelStats(bestBoxes, points, chartArea, medianX, medianY, xScale, yScale);

    for (let run = 0; run < runs; run++) {
      let temperature = INITIAL_TEMPERATURE;
      const boxes = initialBoxes.map((box) => ({
        ...box,
        textLines: [...box.textLines],
        alternates: box.alternates.map((layout) => cloneLayout(layout))
      }));
      let stats = computeLabelStats(boxes, points, chartArea, medianX, medianY, xScale, yScale);
      let currentCost = stats.cost;

      if (ENABLE_LAYOUT_DEBUG) {
        const summary = `labels=${stats.labelCollisions} | points=${stats.pointCollisions} | traitLabels=${stats.lineLabelCollisions} | traitPoints=${stats.linePointCollisions} | traitLines=${stats.lineCrossCollisions} | quadrants=${stats.quadrantCollisions ?? 0}`;
        console.debug(
          `[Labels][run ${run + 1}/${runs}] coût initial=${currentCost.toFixed(2)} | ${summary}`,
          {
            labelCollisions: stats.labelCollisionPairs,
            pointCollisions: stats.pointCollisionsList,
            traitLabelCollisions: stats.lineLabelPairs,
            traitPointCollisions: stats.linePointPairs,
            traitLineCollisions: stats.lineCrossPairs,
            quadrantCollisions: stats.quadrantCollisionPairs ?? []
          }
        );
      }

      for (let iteration = 0; iteration < iterationsPerRun && currentCost > 0; iteration++) {
        let iterationImproved = false;

        while (currentCost > 0) {
          const cliques = buildCliques(stats);
          if (cliques.length === 0) break;

          let cliqueImproved = false;
          for (const clique of cliques) {
            let attemptSucceeded = false;
            for (let attempt = 0; attempt < MAX_CLIQUE_ATTEMPTS; attempt++) {
              const updated = attemptCliqueMove(clique, boxes, stats, chartArea, temperature, points, medianX, medianY, xScale, yScale);
              if (updated.accepted && updated.stats) {
                stats = updated.stats;
                currentCost = stats.cost;
                iterationImproved = true;
                cliqueImproved = true;
                attemptSucceeded = true;
                break;
              }
            }
            if (attemptSucceeded) {
              break;
            }
          }

          if (!cliqueImproved) {
            break;
          }
        }

        temperature = Math.max(MIN_TEMPERATURE, temperature * TEMPERATURE_DECAY);

        if (ENABLE_LAYOUT_DEBUG) {
          const summary = `labels=${stats.labelCollisions} | points=${stats.pointCollisions} | traitLabels=${stats.lineLabelCollisions} | traitPoints=${stats.linePointCollisions} | traitLines=${stats.lineCrossCollisions} | quadrants=${stats.quadrantCollisions ?? 0}`;
          console.debug(
            `[Labels][run ${run + 1}/${runs}] itération ${iteration + 1}/${iterationsPerRun} | coût=${stats.cost.toFixed(2)} | ${summary}`,
            {
              labelCollisions: stats.labelCollisionPairs,
              pointCollisions: stats.pointCollisionsList,
              traitLabelCollisions: stats.lineLabelPairs,
              traitPointCollisions: stats.linePointPairs,
              traitLineCollisions: stats.lineCrossPairs,
              quadrantCollisions: stats.quadrantCollisionPairs ?? []
            }
          );
        }

        if (!iterationImproved) {
          break;
        }
      }

      if (stats.cost < bestStats.cost) {
        bestStats = stats;
        bestBoxes = boxes.map((box) => ({ ...box, textLines: [...box.textLines] }));
      }
    }

    if (ENABLE_LAYOUT_DEBUG) {
      const summary = `labels=${bestStats.labelCollisions} | points=${bestStats.pointCollisions} | traitLabels=${bestStats.lineLabelCollisions} | traitPoints=${bestStats.linePointCollisions} | traitLines=${bestStats.lineCrossCollisions} | quadrants=${bestStats.quadrantCollisions ?? 0}`;
      console.debug(
        `[Labels] meilleur coût=${bestStats.cost.toFixed(2)} | ${summary}`,
        {
          labelCollisions: bestStats.labelCollisionPairs,
          pointCollisions: bestStats.pointCollisionsList,
          traitLabelCollisions: bestStats.lineLabelPairs,
          traitPointCollisions: bestStats.linePointPairs,
          traitLineCollisions: bestStats.lineCrossPairs,
          quadrantCollisions: bestStats.quadrantCollisionPairs ?? []
        }
      );
    }

    return bestBoxes;
  }

  function buildLabelBoxes(points: any[], chartArea: any, ctx: CanvasRenderingContext2D): LabelBox[] {
    const centerX = chartArea.left + chartArea.width / 2;
    const leftEntries: any[] = [];
    const rightEntries: any[] = [];

    points.forEach((pointData) => {
      if (!pointData.element) return;
      if (pointData.element.x < centerX) {
        leftEntries.push(pointData);
      } else {
        rightEntries.push(pointData);
      }
    });

    const createBoxes = (entries: any[], isLeft: boolean) => {
      const boxes: LabelBox[] = [];
      entries.forEach((pointData) => {
        const element = pointData.element;
        const raw = pointData.raw;
        if (!element || !raw?.label) return;

        const colorInfo = getStatusColorInfo(raw.status);
        const pointKey = getPointKey(raw, pointData.index);
        const layouts = buildLabelLayouts(raw.label, ctx);
        const primaryLayout = layouts[0];
        const alternateLayouts = layouts.slice(1);
        const textLines = primaryLayout.lines;
        const boxWidth = primaryLayout.width;
        const boxHeight = primaryLayout.height;

        const computePosition = (placement: string) => {
          switch (placement) {
            case 'left':
              return {
                left: element.x - boxWidth - BASE_LABEL_OFFSET,
                top: element.y - boxHeight / 2
              };
            case 'right':
              return {
                left: element.x + BASE_LABEL_OFFSET,
                top: element.y - boxHeight / 2
              };
            case 'top':
              return {
                left: element.x - boxWidth / 2,
                top: element.y - boxHeight - BASE_LABEL_OFFSET
              };
            case 'bottom':
              return {
                left: element.x - boxWidth / 2,
                top: element.y + BASE_LABEL_OFFSET
              };
            default:
              return {
                left: element.x + BASE_LABEL_OFFSET,
                top: element.y - boxHeight / 2
              };
          }
        };

        const placements = isLeft ? ['left', 'top', 'bottom', 'right'] : ['right', 'top', 'bottom', 'left'];
        let placementUsed = isLeft ? 'left' : 'right';
        let finalLeft = 0;
        let finalTop = 0;
        let placed = false;

        for (const placement of placements) {
          const position = computePosition(placement);
          const tentativeLeft = clamp(position.left, chartArea.left + MIN_INITIAL_OFFSET, chartArea.right - boxWidth - MIN_INITIAL_OFFSET);
          const tentativeTop = clamp(position.top, chartArea.top + MIN_INITIAL_OFFSET, chartArea.bottom - boxHeight - MIN_INITIAL_OFFSET);
          const pointInside =
            element.x >= tentativeLeft &&
            element.x <= tentativeLeft + boxWidth &&
            element.y >= tentativeTop &&
            element.y <= tentativeTop + boxHeight;
          if (!pointInside) {
            finalLeft = tentativeLeft;
            finalTop = tentativeTop;
            placementUsed = placement;
            placed = true;
            break;
          }
        }

        if (!placed) {
          const fallback = computePosition(isLeft ? 'left' : 'right');
          finalLeft = clamp(fallback.left, chartArea.left + MIN_INITIAL_OFFSET, chartArea.right - boxWidth - MIN_INITIAL_OFFSET);
          finalTop = clamp(fallback.top, chartArea.top + MIN_INITIAL_OFFSET, chartArea.bottom - boxHeight - MIN_INITIAL_OFFSET);
          placementUsed = isLeft ? 'left' : 'right';
        }

        boxes.push({
          left: finalLeft,
          top: finalTop,
          width: boxWidth,
          height: boxHeight,
          textLines,
          point: { x: element.x, y: element.y },
          pointKey,
          pointId: raw.id ?? raw.label,
          pointLabel: raw.label,
          isLeft:
            placementUsed === 'left'
              ? true
              : placementUsed === 'right'
              ? false
              : element.x < chartArea.left + chartArea.width / 2,
          color: colorInfo.solid,
          placement: placementUsed as LabelPlacement,
          alternates: alternateLayouts
        });
      });

      resolveVerticalOverlaps(boxes, chartArea);
      return boxes;
    };

    const leftBoxes = createBoxes(leftEntries, true);
    const rightBoxes = createBoxes(rightEntries, false);

    return [...leftBoxes, ...rightBoxes];
  }

  let cachedLabelBoxes: LabelBox[] = [];
  let cachedLabelSignature = '';
  let layoutRandomSeed = Math.random().toString(36).slice(2, 8); // Seed fixe pour toute la session

  function getLabelSignature(points: any[], chartArea: any) {
    const dims = `${chartArea.left.toFixed(1)}-${chartArea.top.toFixed(1)}-${chartArea.right.toFixed(
      1
    )}-${chartArea.bottom.toFixed(1)}`;
    // Utiliser raw.x/y au lieu de element.x/y pour éviter les changements au hover
    const dataSig = points
      .map((point) => `${point.raw?.id ?? point.index}-${point.raw?.x?.toFixed(2) ?? '0'}-${point.raw?.y?.toFixed(2) ?? '0'}`)
      .join('|');
    return `${dims}|${dataSig}|${layoutRandomSeed}`;
  }

  // Stocker les seuils dans un objet mutable accessible au plugin
  const thresholdState = {
    value: 0,
    complexity: 0
  };
  
  // Mettre à jour les seuils de manière réactive et forcer la mise à jour du graphique
  $: {
    const newValue = effectiveValueThreshold;
    const newComplexity = effectiveComplexityThreshold;
    // Toujours mettre à jour thresholdState
    if (thresholdState.value !== newValue || thresholdState.complexity !== newComplexity) {
      thresholdState.value = newValue;
      thresholdState.complexity = newComplexity;
      // Forcer la mise à jour du graphique immédiatement avec un redraw complet
      if (chartInstance) {
        // Invalider le cache pour forcer un recalcul complet
        // cachedLabelSignature = '';
        // Utiliser requestAnimationFrame pour s'assurer que le redraw se fait après la mise à jour de thresholdState
        requestAnimationFrame(() => {
          if (chartInstance) {
            // Forcer un redraw complet en appelant update puis draw
            chartInstance.update('active');
            chartInstance.draw();
          }
        });
      }
    }
  }

  const useCaseLabelPlugin = {
    id: 'useCaseLabels',
    beforeDatasetsDraw(chart: Chart) {
      const dataset = chart.getDatasetMeta(0);
      if (!dataset || !dataset.data || dataset.data.length === 0) {
        return;
      }

      const ctx = chart.ctx;
      ctx.save();
      ctx.font = LABEL_FONT;
      ctx.textBaseline = 'top';
      const chartArea = chart.chartArea;
      const points = dataset.data
        .map((element: any, index: number) => ({
          element,
          index,
          raw: element?.$context?.raw
        }))
        .filter((item: { raw?: { label?: string } }) => Boolean(item.raw?.label));

      // Lire les seuils depuis les options du chart (toujours à jour)
      const pluginOptions = (chart.options.plugins as any)?.useCaseLabels || {};
      const thresholdValue = pluginOptions.valueThreshold ?? thresholdState.value ?? 0;
      const thresholdComplexity = pluginOptions.complexityThreshold ?? thresholdState.complexity ?? 0;
      const showROIQuadrant = points.length > 2;

      // Convertir les seuils en coordonnées pixels
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      

      
      const thresholdX = xScale.getPixelForValue(thresholdComplexity);
      const thresholdY = yScale.getPixelForValue(thresholdValue);
      
      // Layer 0: Quadrants (juste au-dessus de la grille, en dessous des traits)
      if (showROIQuadrant && xScale && yScale) {
        // Quadrant ROI (top-left) : haute valeur, faible complexité - Vert
        ctx.fillStyle = 'rgba(34, 197, 94, 0.15)'; // Vert avec 15% d'opacité
        ctx.fillRect(
          chartArea.left,
          chartArea.top,
          thresholdX - chartArea.left,
          thresholdY - chartArea.top
        );

        // Quadrant bottom-right : faible valeur, haute complexité - Orange
        ctx.fillStyle = 'rgba(251, 146, 60, 0.15)'; // Orange avec 15% d'opacité
        ctx.fillRect(
          thresholdX,
          thresholdY,
          chartArea.right - thresholdX,
          chartArea.bottom - thresholdY
        );

        // Lignes de référence pour les seuils
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        
        // Ligne verticale (seuil complexité)
        ctx.beginPath();
        ctx.moveTo(thresholdX, chartArea.top);
        ctx.lineTo(thresholdX, chartArea.bottom);
        ctx.stroke();
        
        // Ligne horizontale (seuil valeur)
        ctx.beginPath();
        ctx.moveTo(chartArea.left, thresholdY);
        ctx.lineTo(chartArea.right, thresholdY);
        ctx.stroke();
        
        ctx.setLineDash([]);

        // Labels de quadrant (en gras, sur fond blanc, aux extrémités de chaque quadrant)
        ctx.font = 'bold 11px "Inter", "DM Sans", system-ui, sans-serif';
        ctx.textBaseline = 'top';
        
        const labelPadding = 8;
        const labelHeight = 24;
        const labelOffset = 8; // Distance depuis les bords
        
        // "Gains rapide" (haut gauche du quadrant top-left)
        ctx.textAlign = 'left';
        const gainsRapideText = 'Gains rapide';
        const gainsRapideWidth = ctx.measureText(gainsRapideText).width + labelPadding * 2;
        const gainsRapideX = chartArea.left + labelOffset;
        const gainsRapideY = chartArea.top + labelOffset;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(gainsRapideX, gainsRapideY, gainsRapideWidth, labelHeight);
        ctx.strokeStyle = THEME_BLUE;
        ctx.lineWidth = 1;
        ctx.strokeRect(gainsRapideX, gainsRapideY, gainsRapideWidth, labelHeight);
        ctx.fillStyle = THEME_BLUE;
        ctx.fillText(gainsRapideText, gainsRapideX + labelPadding, gainsRapideY + (labelHeight - 11) / 2);
        
        // "Projets majeurs" (haut droite du quadrant top-right)
        ctx.textAlign = 'right';
        const projetsMajeursText = 'Projets majeurs';
        const projetsMajeursWidth = ctx.measureText(projetsMajeursText).width + labelPadding * 2;
        const projetsMajeursX = chartArea.right - labelOffset - projetsMajeursWidth;
        const projetsMajeursY = chartArea.top + labelOffset;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(projetsMajeursX, projetsMajeursY, projetsMajeursWidth, labelHeight);
        ctx.strokeStyle = THEME_BLUE;
        ctx.lineWidth = 1;
        ctx.strokeRect(projetsMajeursX, projetsMajeursY, projetsMajeursWidth, labelHeight);
        ctx.fillStyle = THEME_BLUE;
        ctx.fillText(projetsMajeursText, projetsMajeursX + projetsMajeursWidth - labelPadding, projetsMajeursY + (labelHeight - 11) / 2);
        
        // "Attendre" (bas gauche du quadrant bottom-left)
        ctx.textAlign = 'left';
        const attendreText = 'Attendre';
        const attendreWidth = ctx.measureText(attendreText).width + labelPadding * 2;
        const attendreX = chartArea.left + labelOffset;
        const attendreY = chartArea.bottom - labelOffset - labelHeight;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(attendreX, attendreY, attendreWidth, labelHeight);
        ctx.strokeStyle = THEME_BLUE;
        ctx.lineWidth = 1;
        ctx.strokeRect(attendreX, attendreY, attendreWidth, labelHeight);
        ctx.fillStyle = THEME_BLUE;
        ctx.fillText(attendreText, attendreX + labelPadding, attendreY + (labelHeight - 11) / 2);
        
        // "Ne pas faire" (bas droite du quadrant bottom-right)
        ctx.textAlign = 'right';
        const nePasFaireText = 'Ne pas faire';
        const nePasFaireWidth = ctx.measureText(nePasFaireText).width + labelPadding * 2;
        const nePasFaireX = chartArea.right - labelOffset - nePasFaireWidth;
        const nePasFaireY = chartArea.bottom - labelOffset - labelHeight;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(nePasFaireX, nePasFaireY, nePasFaireWidth, labelHeight);
        ctx.strokeStyle = THEME_BLUE;
        ctx.lineWidth = 1;
        ctx.strokeRect(nePasFaireX, nePasFaireY, nePasFaireWidth, labelHeight);
        ctx.fillStyle = THEME_BLUE;
        ctx.fillText(nePasFaireText, nePasFaireX + nePasFaireWidth - labelPadding, nePasFaireY + (labelHeight - 11) / 2);
        
        // Réinitialiser pour les autres layers
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = LABEL_FONT;
      }

      // Pour le recuit, on utilise toujours les médianes pour positionner les boîtes fixes
      const medianX = xScale.getPixelForValue(computedMedianComplexity);
      const medianY = yScale.getPixelForValue(computedMedianValue);
      
      const signature = getLabelSignature(points, chartArea);
      if (signature !== cachedLabelSignature) {
        const rawBoxes = buildLabelBoxes(points, chartArea, ctx);
        const annealed = runLabelAnnealing(rawBoxes, chartArea, points, medianX, medianY, xScale, yScale);
        cachedLabelBoxes = annealed;
        cachedLabelSignature = signature;
      }

      // Layer 1: Traits (au-dessus des quadrants, en dessous des labels)
      cachedLabelBoxes.forEach((box) => {
        const anchor = getLabelAnchorPoint(box);
        const anchorX = anchor.x;
        const anchorY = anchor.y;

        ctx.strokeStyle = THEME_BLUE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(box.point.x, box.point.y);
        ctx.lineTo(anchorX, anchorY);
        ctx.stroke();
      });

      // Layer 2: Labels (fond semi-transparent à 30%, au-dessus des traits, en dessous des points)
      cachedLabelBoxes.forEach((box) => {
        // Fond blanc semi-transparent à 30% - devrait masquer les quadrants si vraiment au-dessus
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.strokeStyle = THEME_BLUE;
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, box.left, box.top, box.width, box.height, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = THEME_BLUE;
        box.textLines.forEach((line, lineIndex) => {
          ctx.fillText(
            line,
            box.left + LABEL_PADDING_X,
            box.top + LABEL_PADDING_TOP + lineIndex * LINE_HEIGHT
          );
        });
      });

      ctx.restore();
    }
  };

  // Enregistrer Chart.js + plugin custom
  Chart.register(...registerables, useCaseLabelPlugin);

  // Fonction pour décaler les points superposés
  function offsetOverlappingPoints(data: any[]): any[] {
    const offsetData = [...data];
    const positionMap = new Map<string, number[]>();
    
    // Grouper les points par position (avec une tolérance de 0.1)
    offsetData.forEach((point, index) => {
      const roundedX = Math.round(point.x * 10) / 10;
      const roundedY = Math.round(point.y * 10) / 10;
      const key = `${roundedX},${roundedY}`;
      if (!positionMap.has(key)) {
        positionMap.set(key, []);
      }
      positionMap.get(key)!.push(index);
    });
    
    // Décaler les points superposés
    positionMap.forEach((indices) => {
      if (indices.length > 1) {
        indices.forEach((index, offsetIndex) => {
          const point = offsetData[index];
          const offset = (offsetIndex + 1) * 0.3; // Décalage plus petit pour éviter de sortir des limites
          
          if (offsetIndex % 2 === 0) {
            // Décaler sur l'axe X (complexité) - vers la droite
            point.x = Math.min(point.x + offset, 100);
          } else {
            // Décaler sur l'axe Y (valeur) - vers le haut
            point.y = Math.min(point.y + offset, 100);
          }
          
          // Marquer le point comme décalé pour un style différent si nécessaire
          point.isOffset = true;
        });
      }
    });
    
    return offsetData;
  }

  // Fonction pour calculer la médiane
  function calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  // Calculer les scores pour chaque cas d'usage
  $: rawData = useCases
    .filter(uc => uc.valueScores && uc.complexityScores && matrix)
    .map(uc => {
      const scores = calculateUseCaseScores(matrix!, uc.valueScores, uc.complexityScores);
      const colorInfo = getStatusColorInfo(uc.status);
      return {
        x: scores.finalComplexityScore, // Complexité Fibonacci (0-100)
        y: scores.finalValueScore,      // Valeur Fibonacci (0-100)
        label: uc.name,
        description: uc.description || '',
        status: uc.status,
        id: uc.id,
        valueStars: scores.valueStars,      // Valeur normalisée (1-5)
        complexityStars: scores.complexityStars, // Complexité normalisée (1-5)
        colorRgb: colorInfo.rgb,
        color: colorInfo.solid
      };
    });

  // Calculer les médianes pour le quadrant ROI
  $: valueScores = rawData.map(point => point.y);
  $: complexityScores = rawData.map(point => point.x);
  $: computedMedianValue = calculateMedian(valueScores);
  $: computedMedianComplexity = calculateMedian(complexityScores);
  
  // Exposer les médianes calculées
  $: medianValue = computedMedianValue;
  $: medianComplexity = computedMedianComplexity;
  
  // Initialiser thresholdState dès que les valeurs effectives sont disponibles
  $: if (effectiveValueThreshold > 0 && effectiveComplexityThreshold > 0) {
    thresholdState.value = effectiveValueThreshold;
    thresholdState.complexity = effectiveComplexityThreshold;
  }

  // Identifier les use cases dans le quadrant ROI (valeur >= seuil ET complexité <= seuil)
  // Le quadrant ROI est en haut à gauche : haute valeur (y élevé) et faible complexité (x faible)
  $: {
    showROIQuadrant = rawData.length > 2;
    if (showROIQuadrant && effectiveValueThreshold > 0 && effectiveComplexityThreshold > 0) {
      // Quadrant ROI : y >= seuil_valeur (haute valeur) ET x <= seuil_complexité (faible complexité)
      const roiUseCases = rawData.filter(point => 
        point.y >= effectiveValueThreshold && point.x <= effectiveComplexityThreshold
      );
      
      if (roiUseCases.length > 0) {
        const roiValues = roiUseCases.map(p => p.y);
        const roiComplexities = roiUseCases.map(p => p.x);
        roiStats = {
          count: roiUseCases.length,
          avgValue: calculateMedian(roiValues),
          avgComplexity: calculateMedian(roiComplexities)
        };
      } else {
        roiStats = { count: 0, avgValue: 0, avgComplexity: 0 };
      }
    } else {
      roiStats = { count: 0, avgValue: 0, avgComplexity: 0 };
    }
  }

  $: offsetData = offsetOverlappingPoints(rawData);
  $: backgroundColors = offsetData.map(() => `rgba(${THEME_BLUE_RGB}, 0.85)`);
  $: borderColors = offsetData.map(() => `rgb(${THEME_BLUE_RGB})`);

  $: chartData = {
    datasets: [{
      label: 'Cas d\'usage',
      data: offsetData,
      backgroundColor: backgroundColors,
      borderColor: borderColors,
      pointRadius: 5,
      pointHoverRadius: 8,
      pointBorderWidth: 0,
      pointHoverBackgroundColor: borderColors,
      pointHoverBorderColor: borderColors
    }]
  };

  // Calculer les min/max pour le zoom automatique
  $: dataPoints = chartData.datasets[0].data;
  $: xValues = dataPoints.map(point => point.x);
  $: yValues = dataPoints.map(point => point.y);
  
  $: xMin = Math.min(...xValues);
  $: xMax = Math.max(...xValues);
  $: yMin = Math.min(...yValues);
  $: yMax = Math.max(...yValues);
  
  // Ajouter une marge de 10% de chaque côté
  $: xRange = xMax - xMin;
  $: yRange = yMax - yMin;
  $: xMargin = Math.max(xRange * 0.1, 5); // Au minimum 5 points de marge
  $: yMargin = Math.max(yRange * 0.1, 5);
  
  $: xAxisMin = Math.max(0, xMin - xMargin);
  $: xAxisMax = Math.min(100, xMax + xMargin);
  $: yAxisMin = Math.max(0, yMin - yMargin);
  $: yAxisMax = Math.min(100, yMax + yMargin);

  $: chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      // Passer les seuils au plugin via les options
      useCaseLabels: {
        valueThreshold: effectiveValueThreshold,
        complexityThreshold: effectiveComplexityThreshold
      },
      title: {
        display: true,
        text: 'Matrice de priorisation',
        font: {
          size: 16,
          weight: 'bold'
        },
        color: THEME_BLUE
      },
      legend: {
        display: false
      },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (context: any) => {
            if (!context || !context[0] || !context[0].raw) return '';
            return context[0].raw.label || '';
          },
          label: (context: any) => {
            if (!context || !context[0] || !context[0].raw) return [];
            const raw = context[0].raw;
            const lines = [
              raw.description ? `Description: ${raw.description.substring(0, 100)}${raw.description.length > 100 ? '...' : ''}` : '',
              `Valeur: ${raw.y} pts (${raw.valueStars}/5 ⭐)`,
              `Complexité: ${raw.x} pts (${raw.complexityStars}/5 ❌)`
            ];
            return lines.filter(line => line !== '');
          }
        }
      }
    },
    scales: {
      x: {
        type: 'linear',
        title: {
          display: true,
          text: 'Complexité (0-100 pts)',
          font: {
            size: 14,
            weight: 'bold'
          },
          color: THEME_BLUE
        },
        min: xAxisMin,
        max: xAxisMax,
        ticks: {
          stepSize: Math.max(5, Math.round((xAxisMax - xAxisMin) / 8)),
          callback: (value: any) => `${value}`,
          color: THEME_BLUE
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.1)'
        }
      },
      y: {
        type: 'linear',
        title: {
          display: true,
          text: 'Valeur (0-100 pts)',
          font: {
            size: 14,
            weight: 'bold'
          },
          color: THEME_BLUE
        },
        min: yAxisMin,
        max: yAxisMax,
        ticks: {
          stepSize: Math.max(5, Math.round((yAxisMax - yAxisMin) / 8)),
          callback: (value: any) => `${value}`,
          color: THEME_BLUE
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.1)'
        }
      }
    },
    onClick: (event: any, elements: any) => {
      if (elements.length > 0) {
        const dataIndex = elements[0].index;
        const useCase = chartData.datasets[0].data[dataIndex];
        
        // Rediriger vers le cas d'usage
        if (useCase.id) {
          goto(`/cas-usage/${useCase.id}`);
        }
      }
    }
  };


  function createChart() {
    if (chartContainer && chartData.datasets[0].data.length > 0) {
      chartInstance = new Chart(chartContainer, {
        type: 'scatter',
        data: chartData,
        options: chartOptions
      });
    }
  }

  function updateChart() {
    if (chartInstance) {
      chartInstance.data = chartData;
      chartInstance.update();
    } else {
      createChart();
    }
  }

  onMount(() => {
    createChart();
  });

  onDestroy(() => {
    if (chartInstance) {
      chartInstance.destroy();
    }
  });

  // Mettre à jour le graphique quand les données ou les options changent
  $: if (chartInstance) {
    updateChart();
    // Mettre à jour les options du chart pour que le plugin ait accès aux nouveaux seuils
    if (chartInstance.options.plugins) {
      (chartInstance.options.plugins as any).useCaseLabels = {
        valueThreshold: effectiveValueThreshold,
        complexityThreshold: effectiveComplexityThreshold
      };
    }
  }
  
</script>

<div class="w-full max-w-[640px] mx-auto">
  <div class="relative w-full aspect-square bg-white rounded-lg shadow-sm border border-slate-200 p-4">
    {#if useCases.length === 0}
      <div class="absolute inset-0 flex items-center justify-center text-slate-500">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
          </svg>
          <p class="text-sm">Aucun cas d'usage à afficher</p>
        </div>
      </div>
    {:else if !matrix}
      <div class="absolute inset-0 flex items-center justify-center text-slate-500">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
          </svg>
          <p class="text-sm">Chargement de la matrice...</p>
        </div>
      </div>
    {:else}
      <canvas bind:this={chartContainer} class="absolute inset-0 w-full h-full cursor-pointer"></canvas>
    {/if}
  </div>
  
  <!-- Indication de clic -->
  <div class="mt-4 flex justify-center">
    <div class="flex items-center gap-2 text-slate-500 text-sm">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path>
      </svg>
      <span>Cliquez sur un point pour voir le détail</span>
    </div>
  </div>
</div>
