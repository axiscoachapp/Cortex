import assert from 'node:assert/strict';
import test from 'node:test';
import { startClinicFixture } from './clinic-review-api.mjs';

// Run explicitly with node --test; keep this outside Vitest's .test discovery.

test('MFA cancellation requires the isolated enrollment fixture', async () => {
  for (const options of [{ mfaCancellationReview: true }, { mfaReview: true, mfaCancellationReview: true }]) {
    let api;
    try { await assert.rejects(async () => { api = await startClinicFixture(options); }, /cancellation/); }
    finally { if (api) await api.close(); }
  }
});

test('synthetic cancellation removes only the newly enrolled pending setup and protects verification', async () => {
  const api = await startClinicFixture({ mfaReview: true, mfaEnrollmentReview: true, mfaCancellationReview: true });
  try {
    const original = structuredClone(api.mfaFactors);
    const remove = id => fetch(api.origin + '/auth/v1/factors/' + id, { method: 'DELETE' });
    assert.equal((await remove(original[2].id)).status, 200);
    const created = await fetch(api.origin + '/auth/v1/factors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ friendly_name: 'Setup sintético cancelável', factor_type: 'totp', issuer: 'Haddad Nicola' }) });
    const dto = await created.json(); assert.equal(created.status, 200);
    assert.equal((await remove(dto.id)).status, 200);
    assert.deepEqual(api.mfaFactors, original.slice(0, 2));
    assert.deepEqual(api.metrics.mfaEnrollmentCalls.map(call => [call.kind, call.factorId]), [['remove', original[2].id], ['enroll', dto.id], ['remove', dto.id]]);
    assert.equal((await remove(dto.id)).status, 409);
    assert.equal((await remove(original[0].id)).status, 403);
    assert.equal((await fetch(api.origin + '/auth/v1/factors/' + dto.id + '/challenge', { method: 'POST' })).status, 403);
    assert.deepEqual(api.mfaFactors, original.slice(0, 2));
    api.resetMfaEnrollment(); assert.deepEqual(api.mfaFactors, original);
  } finally { await api.close(); }
});

test('MFA enrollment requires isolated reads and excludes cleanup-denial mode', async () => {
  for (const options of [{ mfaEnrollmentReview: true }, { mfaReview: true, mfaCleanupReview: true, mfaEnrollmentReview: true }]) {
    let api;
    try { await assert.rejects(async () => { api = await startClinicFixture(options); }, /enrollment/); }
    finally { if (api) await api.close(); }
  }
});

test('synthetic enrollment validates input, cleans the stale setup, protects active factors and resets', async () => {
  const api = await startClinicFixture({ mfaReview: true, mfaEnrollmentReview: true });
  try {
    const before = structuredClone(api.mfaFactors), pending = before[2];
    const input = { friendly_name: 'Autenticador sintético novo', factor_type: 'totp', issuer: 'Haddad Nicola' };
    const enroll = body => fetch(api.origin + '/auth/v1/factors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const bad = await enroll({ ...input, actorId: before[0].id }); assert.equal(bad.status, 400);
    const early = await enroll(input); assert.equal(early.status, 409); assert.deepEqual(api.mfaFactors, before);
    const removed = await fetch(api.origin + '/auth/v1/factors/' + pending.id, { method: 'DELETE' }); assert.equal(removed.status, 200);
    const created = await enroll(input); assert.equal(created.status, 200); const dto = await created.json();
    assert.equal(dto.type, 'totp'); assert.match(dto.totp.qr_code, /svg/); assert.equal(dto.totp.secret, 'SYNTHETIC-NOT-A-REAL-SECRET');
    assert.deepEqual(api.mfaFactors.slice(0, 2), before.slice(0, 2)); assert.equal(api.mfaFactors[2].id, dto.id); assert.equal(api.mfaFactors[2].status, 'unverified');
    assert.deepEqual(api.metrics.mfaEnrollmentCalls.map(call => call.kind), ['remove', 'enroll']);
    for (const [method, path] of [['DELETE', '/auth/v1/factors/' + before[0].id], ['DELETE', '/auth/v1/factors/' + dto.id], ['POST', '/auth/v1/factors/' + dto.id + '/challenge']]) {
      const denied = await fetch(api.origin + path, { method }); assert.equal(denied.status, 403);
    }
    api.resetMfaEnrollment(); assert.deepEqual(api.mfaFactors, before);
  } finally { await api.close(); }
});

test('MFA cleanup denial requires its read fixture, denies only the pending DELETE and never enrolls', async () => {
  let invalid;
  try { await assert.rejects(async () => { invalid = await startClinicFixture({ mfaCleanupReview: true }); }, /requires/); }
  finally { if (invalid) await invalid.close(); }
  const api = await startClinicFixture({ mfaReview: true, mfaCleanupReview: true });
  try {
    const before = structuredClone(api.mfaFactors), pending = before.find(factor => factor.status === 'unverified');
    const response = await fetch(api.origin + '/auth/v1/factors/' + pending.id, { method: 'DELETE' });
    assert.equal(response.status, 403); assert.equal((await response.json()).code, 'insufficient_aal');
    assert.deepEqual(api.metrics.mfaCleanupCalls, [{ factorId: pending.id, status: 403 }]);
    assert.deepEqual(api.metrics.mfaUnexpected, []);
    for (const [method, path] of [['POST', '/auth/v1/factors'], ['DELETE', '/auth/v1/factors/' + before[0].id]]) {
      const denied = await fetch(api.origin + path, { method }); assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'TEST_UNEXPECTED_RESOURCE');
    }
    assert.deepEqual(api.mfaFactors, before); assert.equal(api.metrics.mfaUnexpected.length, 2);
  } finally { await api.close(); }
});

test('MFA review is isolated from other fixtures and leaves the default user unchanged', async () => {
  let mixed;
  try { await assert.rejects(async () => { mixed = await startClinicFixture({ mfaReview: true, delegationPermissions: true }); }, /isolated/); }
  finally { if (mixed) await mixed.close(); }
  const normal = await startClinicFixture();
  try { assert.deepEqual((await (await fetch(normal.origin + '/auth/v1/user')).json()).factors, []); }
  finally { await normal.close(); }
});

test('MFA review exposes only synthetic factor reads and refuses enrollment, challenge and removal', async () => {
  const api = await startClinicFixture({ mfaReview: true });
  try {
    assert.equal(api.mfaFactors.length, 3); const before = structuredClone(api.mfaFactors);
    const response = await fetch(api.origin + '/auth/v1/user'); assert.equal(response.status, 200); assert.deepEqual((await response.json()).factors, before);
    assert.deepEqual(before.map(factor => factor.status), ['verified', 'verified', 'unverified']);
    for (const [method, path] of [['POST', '/auth/v1/factors'], ['POST', '/auth/v1/factors/' + before[0].id + '/challenge'], ['DELETE', '/auth/v1/factors/' + before[0].id]]) {
      const denied = await fetch(api.origin + path, { method }); assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'TEST_UNEXPECTED_RESOURCE');
    }
    assert.equal(api.metrics.mfaUnexpected.length, 3); assert.deepEqual(api.mfaFactors, before);
    assert.equal('delegationWrites' in api.metrics, false);
  } finally { await api.close(); }
});

test('reply replay requires explicit decision and permissions options; arming validates the pending UUID', async () => {
  for (const options of [{ delegationReplay: true }, { delegationPermissions: true, delegationReplay: true }]) {
    let api;
    try { await assert.rejects(async () => { api = await startClinicFixture(options); }, /decision/); }
    finally { if (api) await api.close(); }
  }
  const normal = await startClinicFixture({ delegationPermissions: true, delegationDecisions: true });
  const replay = await startClinicFixture({ delegationPermissions: true, delegationDecisions: true, delegationReplay: true });
  try {
    assert.throws(() => normal.armDelegationLostReply(normal.delegationRows[0].id), /not enabled/);
    const before = structuredClone(replay.delegationRows);
    assert.throws(() => replay.armDelegationLostReply('invalid'));
    assert.throws(() => replay.armDelegationLostReply('00000000-0000-4000-8000-000000000000'), /pending/);
    assert.throws(() => replay.armDelegationLostReply(before[1].id), /pending/);
    assert.deepEqual(replay.delegationRows, before);
  } finally { await normal.close(); await replay.close(); }
});

test('a truncated reply follows one write; an identical retry replays while changed bindings conflict', async () => {
  const api = await startClinicFixture({ delegationPermissions: true, delegationDecisions: true, delegationReplay: true });
  try {
    const before = structuredClone(api.delegationRows), id = before[0].id;
    const path = '/rest/v1/rpc/reception_decide_delegation';
    const args = { p_request: id, p_revision: 1, p_operation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_decision: 'approve' };
    const send = (body = args, endpoint = path) => fetch(api.origin + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    api.armDelegationLostReply(id);
    const broken = await send(); assert.equal(broken.status, 200); await assert.rejects(() => broken.json());
    const expected = { id, state: 'approved', revision: 2, capabilityVersion: 'clinic_reception_v1' };
    assert.equal(api.metrics.delegationWrites.length, 1); assert.deepEqual(api.metrics.delegationWrites[0].snapshot, expected);
    assert.deepEqual(api.delegationRows, [{ ...before[0], ...expected, effective: true, canDecide: false, canRevoke: true }, ...before.slice(1)]);
    const retry = await send(); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), expected);
    assert.equal(api.metrics.delegationWrites.length, 1); assert.deepEqual(api.metrics.delegationReplies.map(reply => reply.kind), ['truncated', 'replay']);
    for (const changed of [{ ...args, p_revision: 2 }, { ...args, p_request: before[1].id }, { ...args, p_operation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]) {
      const response = await send(changed); assert.equal(response.status, 409); assert.equal((await response.json()).code, '40001');
    }
    const crossEndpoint = await send({ p_request: id, p_revision: 2, p_operation: args.p_operation }, '/rest/v1/rpc/reception_revoke_delegation');
    assert.equal(crossEndpoint.status, 409); assert.equal((await crossEndpoint.json()).code, '40001');
    assert.equal(api.metrics.delegationWrites.length, 1); assert.deepEqual(api.delegationRows.slice(1), before.slice(1));
  } finally { await api.close(); }
});

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
