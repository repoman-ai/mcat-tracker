import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { normalizeState, mergeStates, createBackup, validateBackup } from '../js/storage.js';
import { withDailyCompletion, withDailyTask, restoredDailyRecord, parseActualCount } from '../js/daily.js';
import { createFocusTimer } from '../js/focus-timer.js';
import { completionFeedback, reducedMotion } from '../js/celebrate.js';
import { bindEditorDrafts, clearEditorDrafts, clearEditorDraft } from '../js/editor-drafts.js';
import { bindTaskChecklist } from '../js/views/shared.js';
import { loadSiteData, dueEntries } from '../js/data.js';
import { renderLog } from '../js/views/log.js';
import { renderExams } from '../js/views/exams.js';
const raw = JSON.parse(await fs.readFile(new URL('../data/site-data.json', import.meta.url), 'utf8'));
globalThis.fetch = async () => ({ok:true,json:async()=>structuredClone(raw)});
globalThis.window = {location:{search:'?today=2026-09-03',hash:'#today'}};
const data = await loadSiteData();
const row = data.index.scheduleByDate.get('2026-09-03');

test('Undo remains newer than the completed record, including absent previous records', () => {
  for (const previous of [null,{status:'in-progress',actualQuestions:0,notes:'Keep me',updatedAt:'2026-09-01T00:00:00Z'}]) {
    const original = normalizeState({daily:previous?{[row.id]:previous}:{}});
    const completed = withDailyCompletion(original,row,true);
    const restored = restoredDailyRecord(previous,completed.daily[row.id],Date.parse(completed.daily[row.id].updatedAt));
    const undone = {...completed,daily:{[row.id]:restored}};
    for (const merged of [mergeStates(undone,completed),mergeStates(completed,undone)]) {
      assert.equal(merged.daily[row.id].status,previous?.status || 'not-started');
      if(previous) {assert.equal(merged.daily[row.id].actualQuestions,0);assert.equal(merged.daily[row.id].notes,'Keep me');}
    }
  }
});

test('task completion and reopening preserve explicit counts rather than fabricate quantities', () => {
  const state = normalizeState({daily:{[row.id]:{actualQuestions:3,actualCars:0}}});
  const done = withDailyCompletion(state,row,true);
  const reopened = withDailyTask(done,row,'practice:0',false);
  assert.equal(reopened.daily[row.id].actualQuestions,3);
  assert.equal(reopened.daily[row.id].actualCars,0);
  assert.equal(withDailyCompletion(normalizeState({}),row,true).daily[row.id].actualQuestions,undefined);
});

test('count validation distinguishes missing from zero and rejects invalid values in backups', () => {
  for(const value of ['',null,undefined]) assert.equal(parseActualCount(value),'');
  assert.equal(parseActualCount('0'),0); assert.equal(parseActualCount('35'),35);
  for(const value of [-5,1.5,Infinity,'oops']) {
    assert.throws(()=>parseActualCount(value));
    assert.throws(()=>validateBackup(createBackup(normalizeState({daily:{[row.id]:{actualQuestions:value}}}))));
  }
});

test('elapsed clock survives background gaps, excludes pauses, and caps at 25 minutes', () => {
  let now=0;const timer=createFocusTimer(()=>now);
  timer.start();now+=61000;assert.equal(timer.remaining,1439);
  timer.pause();now+=600000;assert.equal(timer.remaining,1439);
  timer.start();now+=1500000;assert.equal(timer.remaining,0);assert.equal(timer.elapsed,1500000);
  timer.reset();assert.equal(timer.elapsed,0);assert.equal(timer.remaining,1500);
});

test('celebration eligibility requires a completion edge and correct date, origin, and preview state', () => {
  const incomplete={status:'in-progress'}, complete={status:'complete'};
  assert.deepEqual(completionFeedback(row,incomplete,complete,'today',row.date),{day:true,burst:true});
  for(const origin of ['plan','backlog']) assert.equal(completionFeedback(row,incomplete,complete,origin,row.date).burst,false);
  assert.equal(completionFeedback(row,complete,complete,'today',row.date).day,false);
  assert.equal(completionFeedback(row,complete,incomplete,'today',row.date).day,false);
  assert.equal(completionFeedback(row,incomplete,complete,'today','2026-09-04').burst,false);
  assert.equal(completionFeedback(row,incomplete,complete,'today',row.date,true).burst,false);
  assert.equal(reducedMotion('system',true),true);assert.equal(reducedMotion('on',false),true);
  assert.equal(reducedMotion('off',true),false);assert.equal(reducedMotion('unknown',true),true);
});

test('failed writes do not emit completion effects; repeated binding emits one effect per click', () => {
  let clicks=[]; const button={dataset:{taskAssignment:row.id,toggleTask:'practice:0'},addEventListener(_event,handler){clicks.push(handler);}};
  const root={querySelectorAll(){return[button];}};
  let effects=0;
  const context={data,state:normalizeState({}),updateState(){return false;},showToast(){},celebrate(){effects++;}};
  bindTaskChecklist(root,context);bindTaskChecklist(root,context);assert.equal(clicks.length,1);
  clicks[0]({preventDefault(){}});assert.equal(effects,0);
  context.updateState=function(next){this.state=next;return true;};
  clicks[0]({preventDefault(){}});assert.equal(effects,1);
});

test('dirty editor fields survive remount while untouched fields receive fresh state', () => {
  clearEditorDrafts();
  const mount=(note,count)=>{
    const fields=[{name:'notes',type:'textarea',value:note,dataset:{}},{name:'actualQuestions',type:'number',value:count,dataset:{}}];
    const events={}; const form={dataset:{draftForm:'day-test'},querySelectorAll(){return fields;},addEventListener(name,fn){events[name]=fn;}};
    bindEditorDrafts({querySelectorAll(){return[form];}});return{fields,events};
  };
  const first=mount('saved','8'); first.fields[0].value='unsaved';first.events.input({target:first.fields[0]});
  const second=mount('new remote note','12');assert.equal(second.fields[0].value,'unsaved');assert.equal(second.fields[1].value,'12');
  clearEditorDraft('day-test');assert.equal(mount('committed','12').fields[0].value,'committed');
});

test('new reminder and mastery fields survive backups and incomplete reminders stay out of retests', () => {
  const state=normalizeState({mistakes:[{id:'reminder',topic:'Units',captureStatus:'needs-review',masteryTopicId:'topic-01',retestDate:row.date},{id:'legacy',topic:'Legacy'}]});
  const restored=validateBackup(createBackup(state)).state;
  assert.equal(restored.mistakes[0].captureStatus,'needs-review');assert.equal(restored.mistakes[0].masteryTopicId,'topic-01');
  assert.equal(restored.mistakes[1].captureStatus,'reviewed');assert.equal(dueEntries(restored,row.date).length,0);
  assert.match(renderLog({data,state:restored},{detail:'repair'}),/Needs review · 1/);
});

test('repair overflow has an explicit route to all due entries', () => {
  const state=normalizeState({mistakes:Array.from({length:7},(_,i)=>({id:`m${i}`,topic:`topic ${i}`,retestDate:row.date}))});
  const html=renderLog({data,state},{detail:'repair'});
  assert.match(html,/Showing 6 of 7 due/);assert.match(html,/data-show-all-retests/);
});

test('diagnostic forms use distinct percent fields and never show a scaled total input', () => {
  const html=renderExams({data,state:normalizeState({})});
  const form=html.slice(html.indexOf('<form class="exam-form"'),html.indexOf('</form>',html.indexOf('<form class="exam-form"')));
  assert.match(form,/name="percent_cp"/);assert.doesNotMatch(form,/name="total"/);
  assert.match(form,/name="completeScheduledDay"/);
});

test('weekly counts keep missing distinct from zero and exclude legacy invalid values', async () => {
  const { recordedCounts } = await import('../js/daily.js');
  const rows = [{id:'a'},{id:'b'},{id:'c'}];
  assert.deepEqual(recordedCounts(rows,normalizeState({}),'actualQuestions'),{total:'',days:0});
  const state=normalizeState({daily:{a:{actualQuestions:0},b:{actualQuestions:17},c:{actualQuestions:-5}}});
  assert.deepEqual(recordedCounts(rows,state,'actualQuestions'),{total:17,days:2});
  assert.deepEqual(recordedCounts(rows.slice(0,1),state,'actualQuestions'),{total:0,days:1});
});

test('Guide retains typed whitespace across debounce and searches a trimmed query', async () => {
  const { bindGuide, renderGuide } = await import('../js/views/guide.js');
  const listeners={}; let html;
  const search={value:'sleep ',isConnected:true,addEventListener(name,fn){listeners[name]=fn;}};
  const container={querySelector(selector){return selector==='[data-guide-search]' ? search : null;}};
  bindGuide(container,{rerender(){html=renderGuide({data},{},{isRouteChange:false});}},{});
  listeners.input();
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.match(html,/value="sleep "/);
  assert.match(html,/<mark>sleep<\/mark>/i);
});

test('nested disclosures restore after lazy Plan hydration', async () => {
  const { captureViewState } = await import('../js/view-state.js');
  const day={id:'',dataset:{viewKey:'day-a'},open:true};
  const reference={id:'',dataset:{viewKey:'reference-a'},open:true};
  let details=[day,reference];
  const root={ownerDocument:{activeElement:null,documentElement:{style:{}}},querySelectorAll(selector){return selector==='details'?details:[];},dispatchEvent(){details.push(reference);}};
  const restore=captureViewState(root,{scrollX:0,scrollY:0,scrollTo(){}});
  day.open=false;reference.open=false;details=[day];
  restore();
  assert.equal(day.open,true);assert.equal(reference.open,true);
});

test('legacy mastery tags remain evidence unless an explicit topic link overrides them', () => {
  const topic=data.workbook.mastery.topics[0];
  const state=normalizeState({mistakes:[{id:'tagged',topic:'Different title',tags:[topic.topic]}]});
  const html=renderLog({data,state},{detail:'mastery'});
  assert.match(html,/1 related mistake/);
  state.mistakes[0].masteryTopicId='another-topic';
  assert.doesNotMatch(renderLog({data,state},{detail:'mastery'}),/1 related mistake/);
});
