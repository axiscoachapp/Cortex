import assert from 'node:assert/strict';
import test from 'node:test';
import { startClinicFixture } from './clinic-review-api.mjs';

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
