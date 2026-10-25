import {chromium} from '/app/node_modules/playwright/index.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {portableName} from './portable-path.mjs';
import {inspect} from './browser-checks.mjs';
const browser=await chromium.launch({args:['--no-sandbox']});
const report={scenes:[],errors:[],overflows:[],fitFailures:[]};
const artifact=process.env.CONVERGE_ARTIFACT ?? `${process.cwd()}/dist/${portableName}`;
const shots=process.env.CONVERGE_SHOTS ?? `${process.cwd()}/.cache/converge32-shots`;
mkdirSync(shots,{recursive:true});
try {
 for(const language of ['fr','en']) {
  const context=await browser.newContext({viewport:{width:1920,height:1080},offline:true});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto(`file://${artifact}`);
  assert(await page.title(),'Loaded title');
  if(language==='en')await page.getByRole('button',{name:'English',exact:true}).click();
  await page.evaluate(()=>document.fonts.ready);
  for(const id of ['central','annotate','ontologies','memory','traceability']) {
   await page.locator(`[data-gigogne-id="${id}"]`).click();
   const figure=page.locator('.architecture-figure').first();
   await figure.locator('.diagram-scroll svg').first().waitFor({state:'visible',timeout:1800});
   const svg=figure.locator('.diagram-scroll svg').first();
   assert.equal(await figure.getAttribute('data-architecture-scene'),id);
   assert.equal(await svg.locator('[data-node]').count(),0,'Every scene initially collapsed');
   const rootIds=await svg.locator('[data-group]').evaluateAll(gs=>gs.map(g=>g.dataset.group));
   for(const groupId of rootIds) {
    const start=performance.now();
    await svg.locator(`[data-group-toggle="${groupId}"] button`).click({timeout:1800});
    await page.waitForFunction(()=>document.querySelector('.architecture-figure').getAttribute('aria-busy')==='false',null,{timeout:1800});
    assert(performance.now()-start<1800,'Fold budget');
   }
   const expand=figure.getByRole('button',{name:language==='fr'?'Tout déplier':'Expand all',exact:true}).first();
   if(await expand.isEnabled())await expand.click({timeout:1800});
   try { await inspect(svg,`${language}/${id}/expanded`); }
   catch(error) { report.fitFailures.push(error.message); }
   assert.equal(await svg.locator('[data-legend-key]').count(),4,'Legend entries inside wrapping zone');
   const groupIds=await svg.locator('[data-group]').evaluateAll(gs=>gs.map(g=>g.dataset.group));
   await figure.getByRole('button',{name:language==='fr'?'Tout replier':'Collapse all',exact:true}).first().click();
   await page.waitForFunction(()=>document.querySelector('.architecture-figure').getAttribute('aria-busy')==='false',null,{timeout:1800});
   const collapsed=await svg.locator('[data-group]').evaluateAll(gs=>gs.every(g=>{
    const r=g.querySelector('rect').getBBox();
    return r.width===460&&r.height===200&&g.querySelector('.service-node')&&g.querySelector('.st-iconButton--sm');
   }));
   assert(collapsed,'Shared card plus DS IconButton in every scene');
   try { await inspect(svg,`${language}/${id}/collapsed`); }
   catch(error) { report.fitFailures.push(error.message); }
   report.overflows.push({language,id,diagnostics:await figure.locator('[data-diagram-diagnostics]').allTextContents(),
    slots:await svg.locator('[data-card-overflow]').evaluateAll(cards=>cards.map(card=>({entityId:card.closest('[data-group]').dataset.group,slots:card.dataset.cardOverflow})))});
   report.scenes.push({language,id,groups:groupIds.length,roots:rootIds.length});
   if(id==='central') {
    await figure.scrollIntoViewIfNeeded();
    await page.screenshot({path:`${shots}/${language}-overview-collapsed-1920.png`});
    await svg.locator('[data-group-toggle="cluster-mesh"] button').click({timeout:1800});
    await page.waitForFunction(()=>document.querySelector('.architecture-figure').getAttribute('aria-busy')==='false',null,{timeout:1800});
    await figure.scrollIntoViewIfNeeded();
    await page.screenshot({path:`${shots}/${language}-sentropic-expanded-1920.png`});
    if(language==='fr') {
     await page.getByRole('button',{name:'English',exact:true}).click();
     assert.equal(await svg.locator('[data-group="cluster-mesh"]').getAttribute('data-collapsed'),'false','Locale preserves fold state');
     await page.getByRole('button',{name:'Français',exact:true}).click();
    }
   }
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[],'No console errors');
 report.status=report.fitFailures.length ? 'fit-blocked' : 'passed';
} finally {
 writeFileSync('.cache/convergence-review.json',JSON.stringify(report,null,2)+'\n');
 await browser.close();
}
console.log(JSON.stringify({status:report.status,scenes:report.scenes.length,errors:report.errors,fitFailures:report.fitFailures.length}));
assert.equal(report.fitFailures.length,0,'Strict text-fit gate; see .cache/convergence-review.json');
