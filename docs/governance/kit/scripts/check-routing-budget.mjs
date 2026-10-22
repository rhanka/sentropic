import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {collapseGovernanceScene} from '../src/governance-collapse.js';
const presentation=JSON.parse(readFileSync('src/presentation-scenes.json'));
const routes=JSON.parse(readFileSync('src/governance-routes.json'));
const report=[];
// Cold mixed state reached by the fold stress traversal; never use prepared routes.
for(const language of ['fr','en']) {
 const scene={...presentation[language].architectureScenes.central,
  projectionKey:'overview',edges:routes[language].overview};
 const start=performance.now();
 const folded=collapseGovernanceScene(scene,['cm-storage','legend','surfaces','cat-mcp','h2a'],false);
 const ms=performance.now()-start;
 report.push({language,ms,edges:folded.edges.length});
 assert(ms<1800,`Cold mixed fold ${language}: ${ms} ms exceeds 1800 ms`);
 assert(folded.edges.every(e=>e.data.routedPoints.length>=2),'Complete routes');
}
writeFileSync('.cache/routing-budget.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
