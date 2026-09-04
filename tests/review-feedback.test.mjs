import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { loadSiteData, isMasteryEvidence } from '../js/data.js';
import { normalizeState, createBackup, validateBackup } from '../js/storage.js';
import { bindEditorDrafts, clearEditorDrafts, draftConflicts } from '../js/editor-drafts.js';
import { bindExams } from '../js/views/exams.js';
import { bindLog, renderLog } from '../js/views/log.js';
import { renderPlan } from '../js/views/plan.js';
import { renderToday } from '../js/views/today.js';
const raw = JSON.parse(await fs.readFile(new URL('../data/site-data.json',import.meta.url),'utf8'));
globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(raw)});
globalThis.window={location:{search:'?today=2026-09-03',hash:'#today'}};
const data=await loadSiteData();

function withFormData(run) {
  const original=globalThis.FormData;
  globalThis.FormData=class {constructor(form){this.form=form;} *[Symbol.iterator](){yield* Object.entries(this.form.values);} forEach(fn){for(const [key,value] of this) fn(value,key);}};
  try {run();} finally {globalThis.FormData=original;}
}

test('reminders are excluded from mastery evidence with both explicit IDs and legacy matches',()=>{
  const topic=data.workbook.mastery.topics[0];
  for(const relation of [{masteryTopicId:topic.id},{topic:topic.topic},{tags:[topic.topic]}]){
    assert.equal(Boolean(isMasteryEvidence({...relation,captureStatus:'needs-review'},topic)),false);
    assert.equal(Boolean(isMasteryEvidence({...relation,captureStatus:'reviewed'},topic)),true);
  }
  const state=normalizeState({mistakes:[{id:'r',masteryTopicId:topic.id,captureStatus:'needs-review'}]});
  assert.doesNotMatch(renderLog({data,state},{detail:'mastery'}),/1 related mistake/);
});

test('draft conflicts require a saved field change, not merely another field edit',()=>{
  const draft={values:{notes:'my edit'},bases:{notes:'old'}};
  assert.deepEqual(draftConflicts(draft,new Map([['notes','old'],['actualQuestions','12']])),[]);
  assert.deepEqual(draftConflicts(draft,new Map([['notes','remote edit']])),['notes']);
  assert.deepEqual(draftConflicts(draft,new Map([['notes','my edit']])),[]);
  assert.deepEqual(draftConflicts({values:{notes:'legacy'},bases:{}},new Map([['notes','saved']])),['notes']);
});

test('recovered conflicting drafts block submit before the save handler',()=>{
  clearEditorDrafts();
  const mount=(value)=>{
    const field={name:'notes',type:'textarea',value,dataset:{}};const listeners={};
    const form={dataset:{draftForm:'day-conflict'},querySelectorAll(){return[field];},addEventListener(name,fn,capture){listeners[name]={fn,capture};}};
    bindEditorDrafts({querySelectorAll(){return[form];}});return{field,listeners};
  };
  const first=mount('original');first.field.value='my edit';first.listeners.input.fn({target:first.field});
  const second=mount('new saved note');assert.equal(second.field.value,'my edit');
  const event={preventDefault(){this.blocked=true;},stopImmediatePropagation(){this.stopped=true;}};
  second.listeners.submit.fn(event);assert.equal(second.listeners.submit.capture,true);assert.equal(event.blocked,true);assert.equal(event.stopped,true);
  clearEditorDrafts();
});

test('focus backup accepts fractional minutes but rejects corrupt quantities and dates',()=>{
  const session={id:'f',minutes:0.02,startedAt:'2026-09-03T10:00:00Z',endedAt:'2026-09-03T10:00:01Z'};
  const restored=validateBackup(createBackup(normalizeState({focusSessions:[session]}))).state;
  assert.deepEqual(restored.focusSessions,[session]);
  for(const minutes of [-1,26,Infinity,NaN,'25',true,null]) assert.throws(()=>validateBackup(createBackup(normalizeState({focusSessions:[{...session,minutes}]}))));
  assert.throws(()=>validateBackup(createBackup(normalizeState({focusSessions:[{...session,startedAt:'nonsense'}]}))));
});

test('Plan orders current week first, retains all others in chronological order, and uses QBank totals',()=>{
  const state=normalizeState({});
  window.location.search='?today=2026-10-20';
  const html=renderPlan({data,state},{});
  const weeks=[...html.matchAll(/id="week-(\d+)"/g)].map(match=>Number(match[1]));
  assert.deepEqual(weeks,[8,...Array.from({length:20},(_,i)=>i+1).filter(w=>w!==8)]);
  assert.match(html,/<strong>50<\/strong> QBank questions/);
  window.location.search='?today=2026-09-03';
  assert.match(renderToday({data,state}),/data-view-key="today-milestone"/);
});

test('exam submit rejects mismatch and preserves diagnostic/scaled separation',()=>withFormData(()=>{
  const submit=(exam,values,existing={})=>{
    let callback,saved;const error={textContent:''};
    const form={values,dataset:{examForm:exam.id},elements:{completed:{checked:true},unfinishedSection:{checked:false},completeScheduledDay:{checked:true}},querySelectorAll(){return[];},querySelector(){return error;},addEventListener(_,fn){callback=fn;}};
    const context={data,state:normalizeState({exams:{[exam.id]:existing}}),updateState(next){saved=next;}};
    bindExams({querySelector(){return null;},querySelectorAll(s){return s==='[data-exam-form]'?[form]:[];}},context);
    callback({preventDefault(){}});return{saved,error:error.textContent};
  };
  const scaled=data.exams.find(e=>!e.diagnostic), diagnostic=data.exams.find(e=>e.diagnostic);
  const values={cp:'128',cars:'127',bb:'130',ps:'129',total:'515'};
  assert.match(submit(scaled,values).error,/Total must equal/);
  assert.equal(submit(scaled,values).saved,undefined);
  assert.match(submit(scaled,{...values,cp:'117'}).error,/score ranges|Total must equal/);
  assert.equal(submit(scaled,{...values,total:''}).saved.exams[scaled.id].total,514);
  const result=submit(diagnostic,{percent_cp:'0',percent_cars:'72.5',percent_bb:'',percent_ps:'80'},{cp:128,total:512});
  assert.deepEqual(result.saved.exams[diagnostic.id].diagnosticPercent,{cp:0,cars:72.5,bb:'',ps:80});
  assert.equal(result.saved.exams[diagnostic.id].total,512); // Preserve legacy data, never relabel it.
  assert.equal(result.saved.daily[diagnostic.plannedDate].status,'complete');
  assert.equal(result.saved.daily[diagnostic.reviewAssignmentIds[0]],undefined);
}));

test('capture-only submit relaxes review requirements, completed review enforces them',()=>withFormData(()=>{
  const names=['date','source','result','section','topic','questionRef','errorType','whyMissed','takeaway','fix'];
  const values={...Object.fromEntries(names.map(name=>[name,''])),date:'2026-09-03',source:'UWorld QBank',result:'Incorrect',questionRef:'Q12'};
  const elements=Object.fromEntries(names.map(name=>[name,{value:values[name]||'',required:true,focus(){}}]));
  const listeners={};const error={textContent:''};const review={open:false};let saved;
  const form={values,elements,isConnected:true,addEventListener(name,fn){listeners[name]=fn;},querySelector(s){return s==='[data-capture-error]'?error:s==='.capture-review'?review:null;},checkValidity(){return !elements.whyMissed.required;},reportValidity(){}};
  bindLog({querySelector(s){return s==='[data-mistake-form]'?form:null;},querySelectorAll(){return[];}},{data,state:normalizeState({}),updateState(next){saved=next;}},{});
  listeners.submit({preventDefault(){},submitter:{hasAttribute(){return true;}}});
  assert.equal(saved.mistakes[0].captureStatus,'needs-review');assert.equal(elements.whyMissed.required,false);
  saved=undefined;
  listeners.submit({preventDefault(){},submitter:{hasAttribute(){return false;}}});
  assert.equal(elements.whyMissed.required,true);assert.equal(saved,undefined);assert.equal(review.open,true);
}));

test('retest outcome starts unselected and cannot save until explicitly chosen',()=>withFormData(()=>{
  let click,dialog,submit,saved;const error={textContent:''};
  const form={values:{retestResult:'Synthetic attempt',retestStatus:''},addEventListener(_,fn){submit=fn;}};
  const context={data,state:normalizeState({mistakes:[{id:'r',topic:'Test',retestDate:'2026-09-03'}]}),openDialog(options){dialog=options;},updateState(next){saved=next;}};
  bindLog({querySelector(){return null;},querySelectorAll(s){return s==='[data-retest-entry]'?[{dataset:{retestEntry:'r'},addEventListener(_,fn){click=fn;}}]:[];}},context,{});
  click();assert.match(dialog.body,/<select name="retestStatus" required><option value="">Choose an outcome/);
  dialog.onMount({querySelector(s){return s==='[data-retest-form]'?form:error;}});
  submit({preventDefault(){},currentTarget:form});assert.equal(saved,undefined);assert.match(error.textContent,/Choose a retest outcome/);
  form.values.retestStatus='Resolved';submit({preventDefault(){},currentTarget:form});assert.equal(saved.mistakes[0].retestStatus,'Resolved');
}));

test('View all retests survives a save but resets on route entry',()=>{
  const state=normalizeState({mistakes:Array.from({length:7},(_,i)=>({id:`due-${i}`,topic:`Due ${i}`,retestDate:'2026-09-03'}))});
  let click,html;
  const context={data,state,rerender(){html=renderLog(context,{detail:'repair'});}};
  bindLog({querySelector(s){return s==='[data-show-all-retests]'?{addEventListener(_,fn){click=fn;}}:null;},querySelectorAll(){return[];}},context,{});
  click();assert.equal((html.match(/data-retest-entry=/g)||[]).length,7);
  const entered=renderLog(context,{detail:'repair'},{isRouteChange:true});
  assert.equal((entered.match(/data-retest-entry=/g)||[]).length,6);
  assert.match(entered,/View all due retests/);
});
