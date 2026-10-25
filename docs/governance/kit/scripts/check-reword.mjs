import {chromium} from '/app/node_modules/playwright/index.mjs';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {collapsedWording} from '../src/collapsed-wording.js';
import {inspect} from './browser-checks.mjs';
import {portableName} from './portable-path.mjs';

// Compare with PR #726's pre-reword portable (10b7b22bc), extracted locally.
const reference=process.env.REWORD_REFERENCE ?? '.cache/reword-reference.html';
const affected={annotate:['ann-ui','ann-comments','ann-h2a'],
 ontologies:['onto-graph','onto-skills','onto-layout','onto-bpmn'],
 memory:['mem-core','mem-time','mem-pipeline','mem-live','mem-h2a'],
 traceability:['trace-1-2','trace-3-4','trace-5-6','trace-7','trace-loop']};
const browser=await chromium.launch({args:['--no-sandbox']});
const report={pairs:0,occurrences:0,strings:[],errors:[]};
const snapshot=svg=>svg.evaluate(svg=>({
 geometry:[svg.getAttribute('viewBox'),...Array.from(svg.querySelectorAll('rect,path,line'),e=>
  ['x','y','width','height','rx','d','x1','x2','y1','y2'].map(a=>e.getAttribute(a)))],
 groups:Array.from(svg.querySelectorAll('[data-group]'),g=>({id:g.dataset.group,
  title:g.querySelector('.service-name')?.textContent,
  subtitle:g.querySelector('.card-summary')?.textContent,
  kicker:g.querySelector('.card-code')?.textContent,
  texts:Array.from(g.querySelectorAll('text'),t=>t.textContent),
  styles:Array.from(g.querySelectorAll('.card-code,.service-name,.card-summary'),e=>{
   const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight];
  })})),
 leaves:Array.from(svg.querySelectorAll('[data-node]'),n=>n.textContent),
}));
try {
 for(const language of ['fr','en']) {
  assert.deepEqual(Object.keys(collapsedWording[language]).sort(),Object.values(affected).flat().sort());
  const pages=[];
  for(const artifact of [reference,`dist/${portableName}`]) {
   const page=await browser.newPage({viewport:{width:1920,height:1080},offline:true});
   page.on('pageerror',e=>report.errors.push(e.message));
   page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
   await page.goto(`file://${process.cwd()}/${artifact}`);
   if(language==='en')await page.getByRole('button',{name:'English',exact:true}).click();
   await page.evaluate(()=>document.fonts.ready);
   pages.push(page);
  }
  for(const scene of ['central',...Object.keys(affected)]) {
   const snapshots=[];
   for(const [index,page] of pages.entries()) {
    await page.locator(`[data-gigogne-id="${scene}"]`).click();
    const figure=page.locator('.architecture-figure').first();
    const svg=figure.locator('.diagram-scroll svg').first();
    if(index===1)await inspect(svg,`${language}/${scene}/reworded`);
    const collapsed=await snapshot(svg);
    await figure.getByRole('button',{name:language==='fr'?'Tout déplier':'Expand all',exact:true}).click({timeout:1800});
    await page.waitForFunction(()=>document.querySelector('.architecture-figure').getAttribute('aria-busy')==='false',null,{timeout:1800});
    snapshots.push({collapsed,expanded:await snapshot(svg)});
   }
   const [before,after]=snapshots;
   assert.deepEqual(after.expanded,before.expanded,`${language}/${scene}: expanded content and layout unchanged`);
   const expected=structuredClone(before.collapsed);
   for(const group of expected.groups) {
    const copy=collapsedWording[language][group.id];
    if(!copy)continue;
    assert(affected[scene]?.includes(group.id));
    for(const [slot,newText] of Object.entries(copy)) {
     assert(!/…|\.\.\./.test(newText));
     report.strings.push({language,scene,id:group.id,slot,old:group[slot],new:newText});
     group[slot]=newText;
    }
    report.occurrences++;
   }
   assert.deepEqual(after.collapsed,expected,`${language}/${scene}: only approved strings change`);
   report.pairs++;
  }
  for(const page of pages)await page.close();
 }
 assert.equal(report.occurrences,34);
 assert.deepEqual(report.errors,[]);
 report.status='passed';
} finally {
 writeFileSync('.cache/reword-review.json',JSON.stringify(report,null,2)+'\n');
 await browser.close();
}
console.log(JSON.stringify({status:report.status,pairs:report.pairs,occurrences:report.occurrences,strings:report.strings.length}));
