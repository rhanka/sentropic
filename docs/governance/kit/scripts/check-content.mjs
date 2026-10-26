import {chromium} from '/app/node_modules/playwright/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inspect} from './browser-checks.mjs';
import {portableName} from './portable-path.mjs';
const file=process.cwd()+'/dist/'+portableName;
const dossier=JSON.parse(readFileSync(process.cwd()+'/dossier.json','utf8'));
const assert=(ok,why)=>{if(!ok)throw Error(why);};
const report={sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),slides:[],needs:[],errors:[],fitFailures:[]};
const checkFit=async(svg,name)=>{try{await inspect(svg,name);}catch(error){report.fitFailures.push(error.message);}};
const browser=await chromium.launch({args:['--no-sandbox']});
try{
 for(const mobile of [false,true])for(const language of ['fr','en']){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1920,height:1080},isMobile:mobile,hasTouch:mobile,offline:true});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('file://'+file);await page.locator('.architecture-figure svg').first().waitFor();
  if(language==='en')await page.getByRole('button',{name:'English',exact:true}).click();
  assert((await page.locator('.decision-details').textContent()).includes('il faut prevoir les 2'),'H1 remains visible in both languages');
  assert(await page.locator('[data-owner-feedback-annex]').count()===0,'Historical appendix stays in source evidence, outside the decision brief');
  for(const need of await page.locator('[data-need-id]').evaluateAll(bs=>bs.map(b=>b.dataset.needId))){
   await page.locator(`[data-need-id="${need}"]`).click();
   const figure=page.locator('.architecture-figure').first();
   await figure.getByRole('button',{name:language==='fr'?'Tout déplier':'Expand all',exact:true}).click();
   await checkFit(figure.locator('.diagram-scroll svg.architecture-svg'),`${mobile}/${language}/${need}`);
   await figure.getByRole('button',{name:language==='fr'?'Tout replier':'Collapse all',exact:true}).click();
   await checkFit(figure.locator('.diagram-scroll svg.architecture-svg'),`${mobile}/${language}/${need}/collapsed`);
   if(need!=='all')assert(await page.locator('[data-active-route-card]').getAttribute('data-active-route-card')===need,'Route prose matches selection');
   report.needs.push({mobile,language,need});
  }
  for(let slide=0;slide<8;slide++){
   await page.evaluate(()=>document.querySelectorAll('details.supporting-detail').forEach(d=>d.open=true));
   await page.evaluate(()=>document.fonts.ready);
   for(const svg of await page.locator('.diagram-scroll svg.architecture-svg').all())await checkFit(svg,`${mobile}/${language}/slide-${slide}`);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflow '+mobile+'/'+language+'/'+slide);
   if(slide===1)assert(await page.locator('.decision-details tbody tr').count()===14,'All 14 proposed capabilities remain visible');
   if(slide>=5){
    const decision=dossier.decisions[slide-5];
    const remarks=await page.locator('.owner-entry p.verbatim').allTextContents();
    assert(JSON.stringify(remarks)===JSON.stringify(decision.ownerRemarks.map(r=>r.text)),'Decision owner quotes unchanged');
    assert(await page.locator('.option-grid .st-tile--selectable').count()===0,'Settled decisions cannot be changed');
    assert(await page.locator('[data-owner-decision]').count()===1,'Only the settled decision remains');
    await page.locator('textarea').first().fill('viewer note');
    const before=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('focus:'))));
    await page.getByRole('button',{name:language==='fr'?'English':'Français',exact:true}).click();
    await page.getByRole('button',{name:language==='fr'?'Français':'English',exact:true}).click();
    assert(JSON.stringify(before)===JSON.stringify(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('focus:'))))),'Language change preserves decision draft');
    assert(await page.locator('textarea').first().inputValue()==='viewer note','Note preserved');
   }
   report.slides.push({mobile,language,slide,passed:true});
   if(slide<7)await page.locator('.dossier-nav').getByRole('button',{name:language==='fr'?'Suivante':'Next',exact:true}).click();
  }
  await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844},offline:true});
 await context.addInitScript(()=>{
  Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage unavailable','SecurityError');}});
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('file://'+file);await page.locator('.architecture-figure svg').first().waitFor();
 await page.getByRole('button',{name:'English',exact:true}).click();
 assert(await page.locator('html').getAttribute('lang')==='en','Language works when storage is denied');
 await page.getByRole('button',{name:'Français',exact:true}).click();
 assert(await page.locator('html').getAttribute('lang')==='fr','Language switches back without storage');
 report.storageDenied='passed';
 await context.close();
 assert(!report.errors.length,JSON.stringify(report.errors));report.status=report.fitFailures.length?'fit-blocked':'passed';
}finally{writeFileSync(process.cwd()+'/.cache/supplement-review.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({status:report.status,slides:report.slides.length,needs:report.needs.length,storageDenied:report.storageDenied}));
assert(!report.fitFailures.length,`${report.fitFailures.length} strict text-fit failures; see .cache/supplement-review.json`);
