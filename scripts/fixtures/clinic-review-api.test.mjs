import assert from 'node:assert/strict';
import test from 'node:test';
import { startClinicFixture } from './clinic-review-api.mjs';

test('a denied read hides the DTO and can recover without mutating requests or allowing decisions', async () => {
  const api = await startClinicFixture({ delegationPermissions: true });
  try {
    const before = structuredClone(api.delegationRows);
    const args = { p_clinic: null, p_after: null, p_after_id: null, p_limit: 50 };
    const list = () => fetch(api.origin + '/rest/v1/rpc/reception_delegation_requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    api.setDelegationReadMode('denied');
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await list(); assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { code: '42501', message: 'Synthetic delegation read denied' });
      assert.deepEqual(api.delegationRows, before);
    }
    api.setDelegationReadMode('valid'); const recovered = await list(); assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), { canManage: false, items: before, nextCursor: null });
    assert.deepEqual(api.metrics.delegationCalls.map(call => call.mode), ['denied', 'denied', 'valid']);
    for (const call of api.metrics.delegationCalls) assert.deepEqual(call.args, args);
    const decision = await fetch(api.origin + '/rest/v1/rpc/reception_decide_delegation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_request: before[0].id, p_revision: 1, p_operation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_decision: 'approve' }) });
    assert.equal(decision.status, 403); assert.equal((await decision.json()).code, 'TEST_UNEXPECTED_RESOURCE');
    assert.equal('delegationWrites' in api.metrics, false); assert.deepEqual(api.delegationRows, before);
  } finally { await api.close(); }
});

test('revision control requires the decision fixture and an existing pending UUID', async () => {
  const read = await startClinicFixture({ delegationPermissions: true });
  const decisions = await startClinicFixture({ delegationPermissions: true, delegationDecisions: true });
  try {
    assert.throws(() => read.advanceDelegationRevision(read.delegationRows[0].id), /not enabled/);
    const before = structuredClone(decisions.delegationRows);
    assert.throws(() => decisions.advanceDelegationRevision('invalid'));
    assert.throws(() => decisions.advanceDelegationRevision('00000000-0000-4000-8000-000000000000'), /pending/);
    assert.throws(() => decisions.advanceDelegationRevision(before[1].id), /pending/);
    assert.deepEqual(decisions.delegationRows, before);
  } finally { await read.close(); await decisions.close(); }
});

test('a stale confirmation conflicts without writing; the fresh revision can be approved explicitly', async () => {
  const api = await startClinicFixture({ delegationPermissions: true, delegationDecisions: true });
  try {
    const before = structuredClone(api.delegationRows), id = before[0].id;
    assert.deepEqual(api.advanceDelegationRevision(id), { requestId: id, beforeRevision: 1, afterRevision: 2 });
    assert.deepEqual(api.delegationRows, [{ ...before[0], revision: 2 }, ...before.slice(1)]);
    const send = async (revision, operation) => {
      const args = { p_request: id, p_revision: revision, p_operation: operation, p_decision: 'approve' };
      const response = await fetch(api.origin + '/rest/v1/rpc/reception_decide_delegation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
      return { args, status: response.status, body: await response.json() };
    };
    const rejected = await send(1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(rejected.status, 409); assert.equal(rejected.body.code, '40001');
    assert.equal(api.metrics.delegationWrites.length, 0);
    assert.deepEqual(api.metrics.delegationAttempts, [{ path: '/rest/v1/rpc/reception_decide_delegation', args: rejected.args, currentRevision: 2, status: 409 }]);
    const approved = await send(2, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    assert.equal(approved.status, 200);
    assert.deepEqual(approved.body, { id, state: 'approved', revision: 3, capabilityVersion: 'clinic_reception_v1' });
    assert.equal(api.metrics.delegationWrites.length, 1);
    assert.deepEqual(api.metrics.delegationAttempts[1], { path: '/rest/v1/rpc/reception_decide_delegation', args: approved.args, currentRevision: 2, status: 200 });
    assert.deepEqual(api.delegationRows.slice(1), before.slice(1));
  } finally { await api.close(); }
});
