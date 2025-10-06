<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chart, registerables } from 'chart.js';
  import { calculateUseCaseScores } from '$lib/utils/scoring';
  import type { MatrixConfig } from '$lib/types/matrix';

  export let useCases: any[] = [];
  export let matrix: MatrixConfig | null = null;

  let chartContainer: HTMLCanvasElement;
  let chartInstance: Chart | null = null;

  // Enregistrer tous les composants Chart.js
  Chart.register(...registerables);

  // Calculer les scores pour chaque cas d'usage
  $: chartData = {
    datasets: [{
      label: 'Cas d\'usage',
      data: useCases
        .filter(uc => uc.valueScores && uc.complexityScores && matrix)
        .map(uc => {
          const scores = calculateUseCaseScores(matrix!, uc.valueScores, uc.complexityScores);
          return {
            x: scores.finalComplexityScore, // Complexité Fibonacci (0-100)
            y: scores.finalValueScore,      // Valeur Fibonacci (0-100)
            label: uc.name,
            status: uc.status,
            id: uc.id,
            valueStars: scores.valueStars,      // Valeur normalisée (1-5)
            complexityStars: scores.complexityStars // Complexité normalisée (1-5)
          };
        }),
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
      pointRadius: 8,
      pointHoverRadius: 12,
      pointBorderWidth: 2
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
          label: (context: any) => [
            `Valeur: ${context.raw.y} pts (${context.raw.valueStars}/5 ⭐)`,
            `Complexité: ${context.raw.x} pts (${context.raw.complexityStars}/5 ❌)`,
            `Statut: ${getStatusLabel(context.raw.status)}`
          ]
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
        // Émettre un événement pour naviguer vers le cas d'usage
        // ou afficher des détails
        console.log('Clicked use case:', useCase);
      }
    }
  };

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'completed': return 'Terminé';
      case 'generating': return 'Génération...';
      case 'detailing': return 'Détail en cours...';
      default: return 'Inconnu';
    }
  }

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

<div class="w-full h-96 bg-white rounded-lg shadow-sm border border-slate-200 p-4">
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
    <canvas bind:this={chartContainer} class="w-full h-full"></canvas>
  {/if}
</div>

<!-- Légende des statuts -->
<div class="mt-4 flex flex-wrap gap-4 text-sm">
  <div class="flex items-center gap-2">
    <div class="w-3 h-3 rounded-full bg-green-500"></div>
    <span>Terminé</span>
  </div>
  <div class="flex items-center gap-2">
    <div class="w-3 h-3 rounded-full bg-yellow-500"></div>
    <span>Génération...</span>
  </div>
  <div class="flex items-center gap-2">
    <div class="w-3 h-3 rounded-full bg-blue-500"></div>
    <span>Détail en cours...</span>
  </div>
</div>
