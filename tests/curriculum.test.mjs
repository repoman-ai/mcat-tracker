import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { assignmentTasks, withDailyTask } from '../js/daily.js';
import { normalizeState, createBackup, validateBackup } from '../js/storage.js';
const data=JSON.parse(await fs.readFile(new URL('../data/site-data.json',import.meta.url),'utf8'));
const byDate=new Map(data.schedule.map(r=>[r.date,r]));
const exposure=new Map(data.chapterMap.map(c=>[c.chapter_id,c.first_exposure]));
test('all chapters have ordered prerequisites, dated recall and introduced-topic practice',()=>{
 assert.equal(data.chapterMap.length,83);
 assert.equal(new Set(data.chapterMap.map(c=>c.chapter_id)).size,83);
 for(const c of data.chapterMap) {
  assert.ok(c.retrieval_dates.length>=4,c.chapter_id);
  assert.ok(c.practice_dates.length,c.chapter_id);
  assert.match(c.link_rationale,/\d+\.\d+/);
  for(const p of c.prerequisites) if(!data.plan.prior_chapter_ids.includes(p)) assert.ok(exposure.get(p)<=c.first_exposure,`${p} before ${c.chapter_id}`);
  for(const d of c.retrieval_dates) {
   const row=byDate.get(d);assert.ok(!row.isRest&&!row.isExam&&!row.isFullLengthReview);
   assert.ok(row.retrievalIds.includes(c.chapter_id));
  }
 }
 for(const r of data.schedule) {
  assert.ok(r.retrievalIds.length<=5);
  for(const c of r.practiceChapterIds) if(!data.plan.prior_chapter_ids.includes(c)) assert.ok(exposure.get(c)<=r.date,`${r.date} practice ${c}`);
 }
 assert.equal(exposure.get('OC01'),'2026-09-24');
 assert.equal(data.plan.first_pass_end,'2026-12-21');
 assert.ok(data.schedule.filter(r=>r.chapterIds.length).every(r=>r.date<data.exams[1].plannedDate));
 assert.equal(data.schedule.reduce((n,r)=>n+r.carsPassages,0),167);
 assert.equal(data.plan.additional_completed_chapter_to_identify,0);
 assert.deepEqual(data.plan.confirmed_chapter_completions,{GC04:'2026-09-22'});
});
test('preview and recall steps do not erase saved history',()=>{
 const r=byDate.get('2026-09-28');
 assert.ok(assignmentTasks(r).some(t=>t.id==='preview:scheduled'));
 assert.ok(!r.chapterIds.includes('BCH01'));
 const state=normalizeState({daily:{'2026-09-01':{status:'complete',notes:'Old plan'},[r.id]:{notes:'Keep',actualQuestions:7}},exams:{'exam-03':{total:520}},mastery:{sample:{confidence:2}}});
 const before=JSON.stringify(state);
 const next=withDailyTask(state,r,'preview:scheduled',true);
 assert.equal(JSON.stringify(state),before);
 assert.equal(next.daily[r.id].notes,'Keep');assert.equal(next.daily[r.id].actualQuestions,7);
 assert.deepEqual(next.daily['2026-09-01'],state.daily['2026-09-01']);
 assert.deepEqual(next.exams,state.exams);assert.deepEqual(next.mastery,state.mastery);
 assert.equal(validateBackup(createBackup(next),data.schedule).state.daily[r.id].completedTasks['preview:scheduled'],true);
});
