import assert from 'node:assert/strict';
import test from 'node:test';
import { startReceptionFixture, ids } from './reception-api.mjs';
const token = actor => 'synthetic.' + Buffer.from(JSON.stringify({ sub: actor })).toString('base64url') + '.synthetic';
async function call(api, actor, action, rest = {}) {
  const response = await fetch(api.origin + '/functions/v1/whatsapp-api', { method: 'POST', headers: { Authorization: 'Bearer ' + token(actor), 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...rest }) });
  return { status: response.status, body: await response.json() };
}
test('settings fixture enables only scoped read DTOs when explicitly selected', async () => {
  const api = await startReceptionFixture({ settingsReview: true });
  try {
    const state = await call(api, ids.admin, 'state'); assert.equal(state.status, 200); assert.equal(state.body.canManage, true);
    const templates = await call(api, ids.admin, 'templates'); assert.equal(templates.status, 200); assert.equal(templates.body.templates.length, 1);
    const automations = await call(api, ids.admin, 'automations'); assert.equal(automations.status, 200); assert.deepEqual(automations.body.automations, []);
    assert.equal((await call(api, ids.a, 'automations')).status, 403);
    const staff = await call(api, ids.a, 'state'); assert.equal(staff.status, 200); assert.equal(staff.body.canManage, false);
    for (const action of ['send', 'act', 'connect', 'saveAutomation', 'syncTemplates']) assert.equal((await call(api, ids.admin, action)).status, 400);
    assert.equal((await call(api, ids.admin, 'state', { clinicId: ids.clinic })).status, 400);
  } finally { await api.close(); }
});
test('default fixture continues to block settings function requests', async () => {
  const api = await startReceptionFixture();
  try { assert.equal((await call(api, ids.admin, 'state')).status, 503); }
  finally { await api.close(); }
});

test('flow read is admin-only and never enables a write or authority override',async()=>{
  const api=await startReceptionFixture({settingsReview:true});
  const context={clinicName:'Clínica sintética',doctors:['Médico sintético']};
  try {
    const flow=await call(api,ids.admin,'flow',context);
    assert.equal(flow.status,200);assert.equal(flow.body.revision,0);assert.equal(flow.body.enabled,false);
    assert.equal(flow.body.definition.start,'inicio');
    assert.equal((await call(api,ids.a,'flow',context)).status,403);
    assert.equal((await call(api,ids.admin,'flow',{...context,clinicId:ids.clinic})).status,400);
    assert.equal((await call(api,ids.admin,'flow',{...context,doctors:[{}]})).status,400);
    assert.equal((await call(api,ids.admin,'saveFlow',{revision:0,flow:flow.body})).status,400);
  } finally {await api.close();}
});
