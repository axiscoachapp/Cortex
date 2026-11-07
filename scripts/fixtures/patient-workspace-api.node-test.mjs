import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startClinicFixture, patientId, uid } from './clinic-review-api.mjs';

test('patient workspace controls require the isolated synthetic display fixture', async () => {
  await assert.rejects(startClinicFixture({patientWorkspaceReview:true}), /requires workspace display data/);
  const api = await startClinicFixture();
  try { assert.throws(() => api.setPatientWorkspaceDenied(true), /not enabled/); }
  finally { await api.close(); }
});

test('ownership denial is recoverable and workspace mutations stay blocked', async () => {
  const api = await startClinicFixture({workspaceDates:true,patientWorkspaceReview:true});
  const before = structuredClone(api.displayData);
  try {
    const path = '/rest/v1/patients?select=id,name&id=eq.'+patientId+'&user_id=eq.'+uid;
    assert.equal((await fetch(api.origin+path)).status,200);
    api.setPatientWorkspaceDenied(true);
    assert.equal((await fetch(api.origin+path)).status,503);
    api.setPatientWorkspaceDenied(false);
    assert.equal((await fetch(api.origin+path)).status,200);
    assert.equal((await fetch(api.origin+'/rest/v1/clinical_work_items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'done'})})).status,405);
    assert.deepEqual(api.displayData,before);
    assert.equal(api.metrics.workspaceWrites,1);
    assert.equal(api.metrics.patientWorkspaceReads.length,4);
    assert.deepEqual(api.metrics.patientWorkspaceReads[0].query,{select:'id,name',id:'eq.'+patientId,user_id:'eq.'+uid});
    assert.throws(() => api.setPatientWorkspaceDenied('true'), /not enabled/);
  } finally { await api.close(); }
});
