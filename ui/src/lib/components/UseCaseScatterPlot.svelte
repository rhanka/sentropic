<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { Chart, registerables } from 'chart.js';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';
  import ChartDataLabels from 'chartjs-plugin-datalabels';

  export let useCases: any[] = [];
  export let matrix: MatrixConfig | null = null;

  let chartContainer: HTMLCanvasElement;
  let chartInstance: Chart | null = null;

  // Enregistrer tous les composants Chart.js
  Chart.register(...registerables);
  Chart.register(ChartDataLabels);

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
        const status = context.parsed.status;
        switch (status) {
          case 'completed': return 'rgba(34, 197, 94, 0.6)'; // Vert
          case 'generating': return 'rgba(251, 191, 36, 0.6)'; // Jaune
          case 'detailing': return 'rgba(59, 130, 246, 0.6)'; // Bleu
          default: return 'rgba(107, 114, 128, 0.6)'; // Gris par défaut
        }
      },
      borderColor: (context: any) => {
        const status = context.parsed.status;
        switch (status) {
          case 'completed': return 'rgba(34, 197, 94, 1)';
          case 'generating': return 'rgba(251, 191, 36, 1)';
          case 'detailing': return 'rgba(59, 130, 246, 1)';
          default: return 'rgba(107, 114, 128, 1)';
        }
      },
               pointRadius: (context: any) => {
                 return context.raw.isOffset ? 6 : 8; // Points décalés légèrement plus petits
               },
               pointHoverRadius: 12,
               pointBorderWidth: (context: any) => {
                 return context.raw.isOffset ? 3 : 2; // Bordure plus épaisse pour les points décalés
               },
               pointHoverBackgroundColor: (context: any) => {
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

  // Interface pour les positions de labels optimisées
  interface LabelPosition {
    x: number;
    y: number;
    anchor: string;
    align: string;
    offsetX: number;
    offsetY: number;
  }

  // Algorithme de force simulation pour éviter les chevauchements de labels
  function calculateLabelPositions(points: any[]): Map<number, LabelPosition> {
    const positions = new Map<number, LabelPosition>();
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;
    
    // Estimation de la taille d'un label (normalisée)
    const labelWidth = 0.15; // ~15% de la largeur du graphique
    const labelHeight = 0.03; // ~3% de la hauteur du graphique
    const minDistance = Math.max(labelWidth, labelHeight) * 1.2; // Distance minimale entre labels
    
    // Initialiser les positions des labels près des points
    const labelPositions: Array<{ x: number; y: number; index: number; point: any }> = points.map((point, index) => {
      const normalizedX = (point.x - xMin) / xRange;
      const normalizedY = (point.y - yMin) / yRange;
      
      // Position initiale du label (légèrement décalée du point)
      let labelX = normalizedX;
      let labelY = normalizedY;
      let anchor = 'center';
      let align = 'center';
      
      // Position initiale basée sur la position du point
      if (normalizedX > 0.7) {
        labelX = normalizedX - labelWidth / 2;
        anchor = 'right';
      } else if (normalizedX < 0.3) {
        labelX = normalizedX + labelWidth / 2;
        anchor = 'left';
      }
      
      if (normalizedY > 0.7) {
        labelY = normalizedY - labelHeight / 2;
        align = 'bottom';
      } else if (normalizedY < 0.3) {
        labelY = normalizedY + labelHeight / 2;
        align = 'top';
      }
      
      return {
        x: labelX,
        y: labelY,
        index,
        point: { ...point, normalizedX, normalizedY }
      };
    });
    
    // Algorithme de force simulation (itératif)
    const iterations = 50;
    const repulsionForce = 0.02;
    const attractionForce = 0.01;
    const damping = 0.9;
    
    // Vitesses pour chaque label
    const velocities = labelPositions.map(() => ({ vx: 0, vy: 0 }));
    
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < labelPositions.length; i++) {
        const label = labelPositions[i];
        let fx = 0; // Force X
        let fy = 0; // Force Y
        
        // Force d'attraction vers le point d'origine
        const dx = label.point.normalizedX - label.x;
        const dy = label.point.normalizedY - label.y;
        fx += dx * attractionForce;
        fy += dy * attractionForce;
        
        // Force de répulsion entre labels (éviter les collisions)
        for (let j = 0; j < labelPositions.length; j++) {
          if (i === j) continue;
          
          const other = labelPositions[j];
          const dx = label.x - other.x;
          const dy = label.y - other.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < minDistance && distance > 0) {
            // Force de répulsion inversement proportionnelle à la distance
            const force = (minDistance - distance) / distance;
            fx += (dx / distance) * force * repulsionForce;
            fy += (dy / distance) * force * repulsionForce;
          }
        }
        
        // Appliquer les forces avec damping
        velocities[i].vx = (velocities[i].vx + fx) * damping;
        velocities[i].vy = (velocities[i].vy + fy) * damping;
        
        // Mettre à jour la position
        label.x += velocities[i].vx;
        label.y += velocities[i].vy;
        
        // Garder les labels dans les limites du graphique
        label.x = Math.max(0, Math.min(1, label.x));
        label.y = Math.max(0, Math.min(1, label.y));
      }
    }
    
    // Convertir les positions normalisées en positions finales avec anchor/align
    labelPositions.forEach((label) => {
      const point = label.point;
      const dx = label.x - point.normalizedX;
      const dy = label.y - point.normalizedY;
      
      // Déterminer anchor et align basés sur la position finale
      let anchor = 'center';
      let align = 'center';
      
      if (Math.abs(dx) > Math.abs(dy)) {
        // Déplacement principalement horizontal
        anchor = dx > 0 ? 'left' : 'right';
        align = 'center';
      } else {
        // Déplacement principalement vertical
        anchor = 'center';
        align = dy > 0 ? 'top' : 'bottom';
      }
      
      // Calculer les offsets en pixels (approximatif, sera ajusté par Chart.js)
      const offsetX = dx * xRange;
      const offsetY = dy * yRange;
      
      positions.set(label.index, {
        x: label.x,
        y: label.y,
        anchor,
        align,
        offsetX,
        offsetY
      });
    });
    
    return positions;
  }

  // Calculer les positions optimisées des labels
  $: labelPositions = dataPoints.length > 0 ? calculateLabelPositions(dataPoints) : new Map<number, LabelPosition>();

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
        enabled: true, // S'assurer que le tooltip est activé
        callbacks: {
          title: (context: any) => context[0].raw.label,
          label: (context: any) => {
            const lines = [
              context[0].raw.description ? `Description: ${context[0].raw.description.substring(0, 100)}${context[0].raw.description.length > 100 ? '...' : ''}` : '',
              `Valeur: ${context[0].raw.y} pts (${context[0].raw.valueStars}/5 ⭐)`,
              `Complexité: ${context[0].raw.x} pts (${context[0].raw.complexityStars}/5 ❌)`
            ];
            return lines.filter(line => line !== '');
          }
        }
      },
      datalabels: {
        display: true, // Afficher tous les labels maintenant
        anchor: (context: any) => {
          const pos = labelPositions.get(context.dataIndex);
          return pos ? pos.anchor : 'center';
        },
        align: (context: any) => {
          const pos = labelPositions.get(context.dataIndex);
          return pos ? pos.align : 'center';
        },
        offset: (context: any) => {
          const pos = labelPositions.get(context.dataIndex);
          if (!pos) return 8;
          
          // Convertir les offsets normalisés en pixels approximatifs
          // Chart.js utilise des pixels, donc on doit estimer
          // On utilise un offset basé sur la distance calculée
          const distance = Math.sqrt(pos.offsetX * pos.offsetX + pos.offsetY * pos.offsetY);
          return Math.max(8, Math.min(30, distance * 2));
        },
        clamp: false, // Permettre aux labels de sortir légèrement pour éviter les collisions
        clip: false,
        font: {
          size: 8,
          weight: 'normal'
        },
        color: '#374151',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: '#D1D5DB',
        borderRadius: 3,
        borderWidth: 1,
        padding: {
          top: 2,
          bottom: 2,
          left: 4,
          right: 4
        },
        formatter: (value: any, context: any) => {
          const label = context.dataset.data[context.dataIndex].label;
          // Tronquer les labels trop longs
          return label.length > 30 ? label.substring(0, 27) + '...' : label;
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
