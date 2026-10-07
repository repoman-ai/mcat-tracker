import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {test} from 'node:test';
import {assignmentTasks, chapterCompleted, readyChapters, readyPracticeScopes, withDailyTask, taskProgress, CURRICULUM_REVISION} from '../js/daily.js';
import {taskChecklist} from '../js/views/shared.js';
import {normalizeState, createBackup, validateBackup, mergeStates} from '../js/storage.js';

const data=JSON.parse(await fs.readFile(new URL('../data/site-data.json',import.meta.url),'utf8'));
const byDate=new Map(data.schedule.map(row=>[row.date,row]));
const exposure=new Map(data.chapterMap.map(chapter=>[chapter.chapter_id,chapter.first_exposure]));
const known=new Set(data.plan.confirmed_covered_chapter_ids);

test('all unread chapters have future reading dates and missed organic stereochemistry is not archived',()=>{
  assert.equal(data.chapterMap.length,83);
  assert.deepEqual([...known].sort(),['BIO01','CARS01','CARS02','GC01','GC02','GC03','GC04','OC01','OC03','PHY10','PHY11']);
  assert.ok(byDate.get('2026-10-13').chapterIds.includes('OC02'));
  assert.ok(byDate.get('2026-10-14').chapterIds.includes('CARS03'));
  assert.deepEqual(byDate.get('2026-10-08').chapterIds,['PHY01']);
  for(const chapter of data.chapterMap) {
    if(!known.has(chapter.chapter_id)) {
      const readings=data.schedule.filter(row=>row.chapterIds.includes(chapter.chapter_id));
      assert.equal(readings.length,1,chapter.chapter_id);
      assert.ok(readings[0].date>=data.plan.resume.date,chapter.chapter_id);
      assert.equal(readings[0].isHistoricalAssignment,false);
      for(const dep of chapter.prerequisites)assert.ok(known.has(dep)||exposure.get(dep)<chapter.first_exposure,`${dep} before ${chapter.chapter_id}`);
    }
  }
  assert.ok(exposure.get('OC02')<exposure.get('OC04'));
  assert.ok(exposure.get('OC02')<exposure.get('BCH01'));
  assert.ok(exposure.get('PHY01')<exposure.get('PHY02'));
  assert.ok(exposure.get('PHY05')<exposure.get('PHY06'));
  assert.ok(exposure.get('PHY08')<exposure.get('OC11'));
});

test('recall follows reading dates and stays unavailable until reading is actually recorded',()=>{
  const empty=normalizeState({});
  for(const row of data.schedule) {
    for(const chapter of row.retrievalIds)assert.ok(known.has(chapter)||exposure.get(chapter)<row.date,`${row.date}: ${chapter}`);
    const actual=readyChapters(row,empty,row.retrievalIds);
    assert.ok(actual.ready.every(id=>known.has(id)));
  }
  const recallRow=data.schedule.find(row=>row.retrievalIds.includes('OC02'));
  assert.ok(recallRow.date>'2026-10-13');
  assert.ok(!assignmentTasks(recallRow,empty).find(task=>task.id==='retrieval:scheduled')?.label.includes('OC02'));
  assert.match(taskChecklist(recallRow,empty),/Recall waits for reading/);
  const read=withDailyTask(empty,byDate.get('2026-10-13'),'chapter:OC02',true);
  assert.ok(readyChapters(recallRow,read,recallRow.retrievalIds).ready.includes('OC02'));
  assert.ok(assignmentTasks(recallRow,read).find(task=>task.id==='retrieval:scheduled').label.includes('OC02'));
  const stale=normalizeState({daily:{'2026-10-13':{status:'complete',curriculumRevision:'2026-10-07'}}});
  assert.equal(chapterCompleted(recallRow,stale,'OC02'),false);
});

test('science pools stay within their section and only unlock completed chapters',()=>{
  const row=data.schedule.find(row=>row.practiceScopes['P/S Section Bank']);
  const empty=normalizeState({});
  assert.equal(readyPracticeScopes(row,empty)['P/S Section Bank'].ready.length,0);
  const bankTask=assignmentTasks(row,empty).find(task=>task.label.includes('P/S Section Bank'));
  assert.equal(bankTask.blocked,true);
  assert.equal(withDailyTask(empty,row,bankTask.id,true),empty);
  const read=withDailyTask(empty,byDate.get('2026-10-07'),'chapter:PS03',true);
  assert.deepEqual(readyPracticeScopes(row,read)['P/S Section Bank'].ready,['PS03']);
  assert.ok(!assignmentTasks(row,read).find(task=>task.id===bankTask.id).blocked);
  for(const row of data.schedule)for(const [source,ids] of Object.entries(row.practiceScopes)) {
    assert.ok(ids.every(id=>known.has(id)||exposure.get(id)<=row.date));
    if(source==='P/S Section Bank')assert.ok(ids.every(id=>id.startsWith('PS')));
    if(source==='B/B Section Bank')assert.ok(ids.every(id=>/^(BIO|BCH)/.test(id)));
    if(source==='C/P Section Bank')assert.ok(ids.every(id=>/^(GC|OC|PHY)/.test(id)));
    if(source==='UWorld science')assert.ok(ids.length&&ids.every(id=>!id.startsWith('CARS')));
  }
});

test('readiness survives backup and sync without changing actual counts, history, notes or dates',()=>{
  const initial=normalizeState({daily:{'2026-09-01':{status:'complete',notes:'Earlier history'},'2026-10-13':{actualQuestions:0,notes:'Keep'}},exams:{'exam-03':{total:520}},mastery:{sample:{confidence:2}}});
  const before=JSON.stringify(initial);
  const read=withDailyTask(initial,byDate.get('2026-10-13'),'chapter:OC02',true);
  assert.equal(JSON.stringify(initial),before);
  assert.equal(read.daily['2026-10-13'].curriculumRevision,CURRICULUM_REVISION);
  assert.equal(read.daily['2026-10-13'].actualQuestions,0);
  assert.equal(read.daily['2026-10-13'].notes,'Keep');
  assert.deepEqual(read.daily['2026-09-01'],initial.daily['2026-09-01']);
  const recall=data.schedule.find(row=>row.retrievalIds.includes('OC02'));
  for(const restored of [validateBackup(createBackup(read)).state,mergeStates(initial,read),mergeStates(read,initial)])assert.ok(chapterCompleted(recall,restored,'OC02'));
  assert.deepEqual(read.exams,initial.exams);assert.deepEqual(read.mastery,initial.mastery);
});

test('review blocks are spread out while core totals, first pass and original budgets stay intact',()=>{
  assert.equal(data.plan.question_targets.uworld_baseline,336);
  assert.deepEqual(data.plan.weeks.slice(3,6).map(w=>w.uworld_questions),[7,24,28]);
  assert.deepEqual(data.sectionBanks.map(bank=>bank.totalQuestions),[120,120,120]);
  assert.equal(data.plan.first_pass_end,'2026-12-21');
  for(const week of data.validation.weeklyChecks)assert.ok(week.estimatedHighMinutes<=week.budgetMinutes);
  for(const row of data.schedule)if(row.date>=data.plan.resume.date&&!row.isExam&&!row.isFullLengthReview&&!row.isTestWindow)assert.ok(row.estimatedWorkload.highMinutes<=215,`${row.date}: avoid oversized combined reading/practice`);
  assert.equal(data.plan.question_targets.cars_passages_from_restart,139);
});


test('checking recall does not complete topics that become eligible later',()=>{
  const row=data.schedule.find(row=>row.retrievalIds.includes('OC02')&&row.retrievalIds.length>1);
  assert.ok(row);
  const empty=normalizeState({});
  const other=row.retrievalIds.find(id=>id!=='OC02');
  const initiallyRead=withDailyTask(empty,byDate.get(exposure.get(other)),`chapter:${other}`,true);
  const recalled=withDailyTask(initiallyRead,row,'retrieval:scheduled',true);
  const before=taskProgress(row,recalled);
  assert.ok(before.completed>0);
  assert.notEqual(recalled.daily[row.id].status,'complete');
  const read=withDailyTask(recalled,byDate.get('2026-10-13'),'chapter:OC02',true);
  assert.equal(taskProgress(row,read).completed,before.completed-1);
  assert.match(taskChecklist(row,read),/aria-pressed="false" aria-label="Mark done: Recall/);
  const restored=validateBackup(createBackup(read)).state;
  assert.equal(taskProgress(row,restored).completed,before.completed-1);
  const updated=withDailyTask(restored,row,'retrieval:scheduled',true);
  assert.ok(updated.daily[row.id].completedRecallChapterIds.includes('OC02'));
  assert.equal(taskProgress(row,updated).completed,before.completed);
});
