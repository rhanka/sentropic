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
        display: true,
        anchor: 'end',
        align: 'top',
        offset: 4,
        font: {
          size: 10,
          weight: 'bold'
        },
        color: '#374151',
        formatter: (value: any, context: any) => {
          return context.dataset.data[context.dataIndex].label;
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

<div class="w-full max-w-[50%] h-[600px] bg-white rounded-lg shadow-sm border border-slate-200 p-4">
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
