import { readFileSync as read, writeFileSync as write, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const d=JSON.parse(read('dossier.json'));
const sha=createHash('sha256');
for(const file of readdirSync('src').sort())sha.update(file+'\0').update(read('src/'+file)).update('\0');
const hash=sha.digest('hex');
if(process.argv.includes('--sync-hash')) {
  d.architectureHash=hash;
  write('dossier.json',JSON.stringify(d,null,2)+'\n');
}
assert.equal(d.architectureHash,hash,'Source and geometry digest');
assert.equal(d.revision,'r11');
assert.equal(d.decisions.length,3);
const evidence=read('../OWNER-DECISIONS-2026-10-19.md','utf8');
for(const [index,quote]of ['G1 = option 1','G2 = option 1','g3 = a ok'].entries()){
  const choice=d.decisions[index];
  assert.equal(choice.key,`G${index+1}`);
  assert.equal(choice.decisionStatus,'accepted');
  assert.equal(choice.ownerChoice,'A');
  assert.equal(choice.decidedAt,'2026-10-19');
  assert.equal(choice.ownerQuote,quote);
  assert(evidence.includes(quote));
  assert.equal(choice.options.length,1,'Superseded alternatives removed');
  assert(read('../study.md','utf8').includes(`« ${quote} »`));
}
assert.equal(d.convergence.ownerFeedbackAnnex.rawText,read('../owner-feedback-diagram/OWNER-FEEDBACK-RAW.md','utf8'));
for(const image of JSON.parse(read('src/owner-feedback-images.json'))){
  assert(Buffer.from(image.src.split(',')[1],'base64').equals(read(`../owner-feedback-diagram/${image.id}.png`)));
}
assert.equal(d.convergence.contractClauses.length,18);
const excluded=new Set(['rawText','ownerReviewNote','ownerRemarks','ownerQuote']);
const texts=[];
function scan(value,key=''){
  if(excluded.has(key))return;
  if(typeof value==='string')texts.push(value);
  else if(Array.isArray(value))value.forEach(x=>scan(x));
  else if(value&&typeof value==='object')Object.entries(value).forEach(([k,v])=>scan(v,k));
}
scan(d);
const brief=JSON.parse(read('src/decision-brief.json'));
scan(brief);
assert.deepEqual(brief.capabilities.rows.map(row=>row[1].toLowerCase()),
  d.convergence.sections.find(section=>section.phase==='capabilities').rows.map(row=>row[2].replace('design-system','Design System').toLowerCase()),
  'Concise capability map preserves every proposed integration owner');
const active=texts.join('\n')+'\n'+read('../study.md','utf8')+'\n'+read('src/architecture-adoption.js','utf8');
assert(!/G[123]-[BC]|G[123] ouvert|soumise au vote propriétaire|conditionnels selon G[123]/i.test(active),'No superseded decision paths');
assert(active.includes('TextQuoteSelector')&&active.includes('targetIds[]'),'Stable anchor boundary');
assert(active.includes('il faut prevoir les 2'),'H1 retained');
const dictionary=JSON.parse(read('src/i18n-en.json'));
const missing=texts.filter(t=>/[àâéèêîôùûçœ]/i.test(t)&&!dictionary[t]&&!/^(OWNER-|DS-POSITION|«)/.test(t));
assert.deepEqual([...new Set(missing)],[],'French dossier prose needs English translations');
const seen=new Set();
for(const section of d.convergence.sections)for(const row of section.rows??[]){
  const id=/^(N\d{2}) ·/.exec(row[0])?.[1];if(id)seen.add(id);
}
assert.equal(seen.size,33,'All 33 need routes retained');
console.log('R11 source: decisions, quotes, 18 clauses, 33 needs, capability owners, translations and geometry digest passed.');
