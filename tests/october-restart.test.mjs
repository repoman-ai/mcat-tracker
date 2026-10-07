import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {test} from 'node:test';
import {taskChecklist} from '../js/views/shared.js';
import {withDailyCompletion} from '../js/daily.js';
import {normalizeState} from '../js/storage.js';
const data=JSON.parse(await fs.readFile(new URL('../data/site-data.json',import.meta.url),'utf8'));
const row=(day)=>data.schedule.find(r=>r.date===day);
test('restart absorbs missed science without changing capacity or protected milestones',()=>{
 assert.equal(data.plan.resume.uworld_science_completed,0);
 assert.equal(data.plan.resume.missed_science_questions_reabsorbed,15);
 assert.deepEqual(row('2026-10-07').chapterIds,['PS03']);
 assert.deepEqual(row('2026-10-08').chapterIds,['PHY01']);
 assert.ok(data.schedule.filter(r=>r.date<'2026-10-07').every(r=>!r.practiceTarget.includes('UWorld science')));
 assert.equal(data.plan.question_targets.uworld_baseline,336);
 assert.equal(data.plan.first_pass_end,'2026-12-21');
 assert.deepEqual(data.plan.placeholder_exam_window,['2027-03-19']);
 for(const w of data.plan.weeks) {
  const expected=w.week<=2?10:data.exams.some(e=>row(e.plannedDate).week===w.week)?20:w.week<=18?17:w.week<=24?13:w.week===25?8:3;
  assert.equal(w.planned_hours,expected);
 }
 for(const w of data.validation.weeklyChecks)assert.ok(w.estimatedHighMinutes<=w.budgetMinutes,`week ${w.week}`);
});
test('September acknowledgement does not hide October recheck or overwrite saved counts',()=>{
 const r=row('2026-10-07');
 const state=normalizeState({daily:{[r.id]:{status:'complete',curriculumRevision:'2026-09-23',updatedAt:'2026-10-01T12:00:00Z',actualQuestions:7,notes:'Keep this note'}}});
 const before=JSON.stringify(state);
 assert.match(taskChecklist(r,state),/revised October 7/);
 assert.equal(JSON.stringify(state),before);
 const saved=withDailyCompletion(state,r,true);
 assert.equal(saved.daily[r.id].actualQuestions,7);
 assert.equal(saved.daily[r.id].notes,'Keep this note');
 assert.doesNotMatch(taskChecklist(r,saved),/Recheck changed assignments/);
});
