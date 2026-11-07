import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptReservationFixture } from './whatsapp-k6-fixture.mjs';

test('historical reservation contract remains byte-for-byte unchanged',()=>{
  const original="select public.whatsapp_automation_begin((select id from rule),'appointment','2099-12-10T16:00Z','phone',null,'Synthetic','{}');";
  assert.equal(adaptReservationFixture(original,false),original);
});
test('revision contract receives the current revision without changing recipient or payload',()=>{
  const original="select public.whatsapp_automation_begin((select id from rule),'appointment','2099-12-10T16:00Z','phone',null,'Synthetic','{}');";
  assert.equal(adaptReservationFixture(original,true),"select public.whatsapp_automation_begin((select id from rule),(select revision from public.whatsapp_automations where id=(select id from rule)),'appointment',(now()+interval '46 hours'),'phone',null,'Synthetic','{}');");
});
test('candidate clock and all appointment controls become eligible relative to the same transaction clock',()=>{
  assert.equal(adaptReservationFixture("'2099-12-08T16:00Z'|'2099-12-10T15:00Z'|'2099-12-10T16:00Z'|'2099-12-10T17:00Z'",true),"now()|(now()+interval '45 hours')|(now()+interval '46 hours')|(now()+interval '47 hours')");
});
test('all thirty-minute appointment intervals keep their matching relative end',()=>{
  for(const [hour,relative] of [[15,45],[16,46],[17,47]]){
    assert.equal(adaptReservationFixture(`'2099-12-10T${hour}:00Z','2099-12-10T${hour}:30Z'`,true),`(now()+interval '${relative} hours'),(now()+interval '${relative} hours 30 minutes')`);
  }
});
