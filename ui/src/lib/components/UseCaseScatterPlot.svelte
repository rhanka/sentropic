<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { Chart, registerables } from 'chart.js';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';

  export let useCases: any[] = [];
  export let matrix: MatrixConfig | null = null;

  let chartContainer: HTMLCanvasElement;
  let chartInstance: Chart | null = null;

  // --- Helpers pour placement personnalisé des labels ---
  const LABEL_FONT = '9px "Inter", "DM Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const MAX_LABEL_WIDTH = 140;
  const LABEL_PADDING = 6;
  const LINE_HEIGHT = 14;

  type LabelBox = {
    left: number;
    top: number;
    width: number;
    height: number;
    textLines: string[];
    point: { x: number; y: number };
    isLeft: boolean;
  };

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

  function boxesOverlap(a: LabelBox, b: LabelBox) {
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

        const textLines = wrapText(ctx, raw.label, MAX_LABEL_WIDTH);
        const textWidth = Math.max(...textLines.map((line: string) => ctx.measureText(line).width), 0);
        const boxWidth = textWidth + LABEL_PADDING * 2;
        const boxHeight = textLines.length * LINE_HEIGHT + LABEL_PADDING * 2;
        const baseLeft = isLeft ? element.x - boxWidth - 16 : element.x + 16;
        let left = clamp(baseLeft, chartArea.left + 4, chartArea.right - boxWidth - 4);
        const top = clamp(element.y - boxHeight / 2, chartArea.top + 4, chartArea.bottom - boxHeight - 4);

        boxes.push({
          left,
          top,
          width: boxWidth,
          height: boxHeight,
          textLines,
          point: { x: element.x, y: element.y },
          isLeft
        });
      });

      resolveVerticalOverlaps(boxes, chartArea);
      return boxes;
    };

    const leftBoxes = createBoxes(leftEntries, true);
    const rightBoxes = createBoxes(rightEntries, false);

    return [...leftBoxes, ...rightBoxes];
  }

  const useCaseLabelPlugin = {
    id: 'useCaseLabels',
    afterDatasetsDraw(chart: Chart) {
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
        .filter((item) => item.raw?.label);

      const labelBoxes = buildLabelBoxes(points, chartArea, ctx);

      labelBoxes.forEach((box) => {
        const anchorX = box.isLeft ? box.left + box.width : box.left;
        const anchorY = clamp(box.point.y, box.top + 4, box.top + box.height - 4);

        ctx.strokeStyle = '#cbd5f5';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(box.point.x, box.point.y);
        ctx.lineTo(anchorX, anchorY);
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, box.left, box.top, box.width, box.height, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#0f172a';
        box.textLines.forEach((line, lineIndex) => {
          ctx.fillText(
            line,
            box.left + LABEL_PADDING,
            box.top + LABEL_PADDING + lineIndex * LINE_HEIGHT
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

  // Calculer les scores pour chaque cas d'usage
  $: rawData = useCases
    .filter(uc => uc.valueScores && uc.complexityScores && matrix)
    .map(uc => {
      const scores = calculateUseCaseScores(matrix!, uc.valueScores, uc.complexityScores);
      return {
        x: scores.finalComplexityScore, // Complexité Fibonacci (0-100)
        y: scores.finalValueScore,      // Valeur Fibonacci (0-100)
        label: uc.name,
        description: uc.description || '',
        status: uc.status,
        id: uc.id,
        valueStars: scores.valueStars,      // Valeur normalisée (1-5)
        complexityStars: scores.complexityStars // Complexité normalisée (1-5)
      };
    });

  $: chartData = {
    datasets: [{
      label: 'Cas d\'usage',
      data: offsetOverlappingPoints(rawData),
      backgroundColor: (context: any) => {
        if (!context || !context.parsed) return 'rgba(107, 114, 128, 0.6)';
        const status = context.parsed.status;
        switch (status) {
          case 'completed': return 'rgba(34, 197, 94, 0.6)'; // Vert
          case 'generating': return 'rgba(251, 191, 36, 0.6)'; // Jaune
          case 'detailing': return 'rgba(59, 130, 246, 0.6)'; // Bleu
          default: return 'rgba(107, 114, 128, 0.6)'; // Gris par défaut
        }
      },
      borderColor: (context: any) => {
        if (!context || !context.parsed) return 'rgba(107, 114, 128, 1)';
        const status = context.parsed.status;
        switch (status) {
          case 'completed': return 'rgba(34, 197, 94, 1)';
          case 'generating': return 'rgba(251, 191, 36, 1)';
          case 'detailing': return 'rgba(59, 130, 246, 1)';
          default: return 'rgba(107, 114, 128, 1)';
        }
      },
      pointRadius: 8,
      pointHoverRadius: 12,
      pointBorderWidth: 2,
      pointHoverBackgroundColor: (context: any) => {
        if (!context || !context.parsed) return 'rgba(107, 114, 128, 0.8)';
        const status = context.parsed.status;
        switch (status) {
          case 'completed': return 'rgba(34, 197, 94, 0.8)';
          case 'generating': return 'rgba(251, 191, 36, 0.8)';
          case 'detailing': return 'rgba(59, 130, 246, 0.8)';
          default: return 'rgba(107, 114, 128, 0.8)';
        }
      }
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
    plugins: {
      title: {
        display: true,
        text: 'Matrice Valeur vs Complexité',
        font: {
          size: 16,
          weight: 'bold'
        }
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
          }
        },
        min: xAxisMin,
        max: xAxisMax,
        ticks: {
          stepSize: Math.max(5, Math.round((xAxisMax - xAxisMin) / 8)),
          callback: (value: any) => `${value}`
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
          }
        },
        min: yAxisMin,
        max: yAxisMax,
        ticks: {
          stepSize: Math.max(5, Math.round((yAxisMax - yAxisMin) / 8)),
          callback: (value: any) => `${value}`
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

  // Mettre à jour le graphique quand les données changent
  $: if (chartInstance) {
    updateChart();
  }
</script>

<div class="w-full max-w-[50%]">
  <div class="w-full h-[600px] bg-white rounded-lg shadow-sm border border-slate-200 p-4">
    {#if useCases.length === 0}
      <div class="flex items-center justify-center h-full text-slate-500">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
          </svg>
          <p class="text-sm">Aucun cas d'usage à afficher</p>
        </div>
      </div>
    {:else if !matrix}
      <div class="flex items-center justify-center h-full text-slate-500">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
          </svg>
          <p class="text-sm">Chargement de la matrice...</p>
        </div>
      </div>
    {:else}
      <canvas bind:this={chartContainer} class="w-full h-full cursor-pointer"></canvas>
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
