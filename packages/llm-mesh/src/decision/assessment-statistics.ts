/** One-sided exact 95% Clopper-Pearson upper bound, including zero observed errors. */
export function decisionRiskUpper95(errors: number, denominator: number): number {
  if (!denominator || errors >= denominator) return 1;
  if (errors === 0) return -Math.expm1(Math.log(0.05) / denominator);
  let low = errors / denominator; let high = 1;
  for (let iteration = 0; iteration < 60; iteration++) {
    const p = (low + high) / 2;
    let logChoose = 0; let cdf = 0;
    for (let i = 0; i <= errors; i++) {
      if (i) logChoose += Math.log(denominator - i + 1) - Math.log(i);
      cdf += Math.exp(logChoose + i * Math.log(p) + (denominator - i) * Math.log1p(-p));
    }
    if (cdf > 0.05) low = p; else high = p;
  }
  return high;
}

function ranks(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result: number[] = [];
  for (let i = 0; i < sorted.length;) {
    let end = i + 1;
    while (end < sorted.length && sorted[end].value === sorted[i].value) end++;
    for (let j = i; j < end; j++) result[sorted[j].index] = (i + end - 1) / 2;
    i = end;
  }
  return result;
}
export function decisionSpearman(gold: number[], scores: number[]): number {
  const a = ranks(gold); const b = ranks(scores);
  const mean = (gold.length - 1) / 2;
  let numerator = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i++) {
    numerator += (a[i] - mean) * (b[i] - mean); aa += (a[i] - mean) ** 2; bb += (b[i] - mean) ** 2;
  }
  return aa && bb ? numerator / Math.sqrt(aa * bb) : 0;
}
export function decisionChoiceMetrics(labels: string[], pairs: { gold: string; predicted: string | null }[]) {
  const matrix = labels.map(() => labels.map(() => 0));
  let macroF1 = 0; let minimumRecall = 1;
  for (const pair of pairs) {
    const actual = labels.indexOf(pair.gold); const predicted = labels.indexOf(pair.predicted ?? '');
    if (actual >= 0 && predicted >= 0) matrix[actual][predicted]++;
  }
  for (let i = 0; i < labels.length; i++) {
    const denominator = pairs.filter((p) => p.gold === labels[i]).length;
    const tp = matrix[i][i]; const predicted = matrix.reduce((sum, row) => sum + row[i], 0);
    macroF1 += denominator + predicted ? 2 * tp / (denominator + predicted) / labels.length : 0;
    minimumRecall = Math.min(minimumRecall, denominator ? tp / denominator : 0);
  }
  return { macroF1, minimumRecall, confusionMatrix: matrix };
}
