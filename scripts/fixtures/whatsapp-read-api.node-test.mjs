import assert from 'node:assert/strict';
import test from 'node:test';
import { createWhatsAppReadFixture, whatsappReadIds } from './whatsapp-read-api.mjs';
import { ids, startReceptionFixture } from './reception-api.mjs';
const input = { action: 'conversations', filter: 'open', search: '', limit: 50, before: null };
test('fixture returns only the requested filter and conversation', () => {
  const fixture = createWhatsAppReadFixture(ids);
  assert.equal(fixture.handle(ids.a, input).data.conversations.length, 2);
  assert.deepEqual(fixture.handle(ids.a, { ...input, filter: 'mine' }).data.conversations.map(row => row.id), [whatsappReadIds.first]);
  assert.deepEqual(fixture.handle(ids.a, { ...input, filter: 'unassigned' }).data.conversations.map(row => row.id), [whatsappReadIds.second]);
  assert.deepEqual(fixture.handle(ids.a, { ...input, filter: 'closed' }).data.conversations.map(row => row.id), [whatsappReadIds.closed]);
  assert.equal(fixture.handle(ids.a, { ...input, search: 'absent' }).data.conversations.length, 0);
  assert.equal(fixture.handle(ids.a, { action: 'messages', conversationId: whatsappReadIds.first, before: null }).data.conversation.id, whatsappReadIds.first);
});
test('fixture refuses writes, foreign actors and authority injection', () => {
  const fixture = createWhatsAppReadFixture(ids);
  assert.equal(fixture.handle(ids.doctor, input).status, 403);
  for (const body of [{ action: 'send' }, { action: 'act' }, { ...input, clinicId: ids.clinic }, { ...input, actorId: ids.admin }]) assert.equal(fixture.handle(ids.a, body).status, 400);
});

test('bot session is a scoped read and distinguishes missing path from a refused read',()=>{
  const fixture=createWhatsAppReadFixture(ids),body={action:'botSession',conversationId:whatsappReadIds.first};
  assert.equal(fixture.handle(ids.a,body).data.session.status,'handed_off');
  assert.deepEqual(fixture.handle(ids.a,{...body,conversationId:whatsappReadIds.second}).data,{session:null});
  assert.equal(fixture.handle(ids.a,{...body,conversationId:ids.clinic}).status,404);
  assert.equal(fixture.handle(ids.doctor,body).status,403);
  assert.equal(fixture.handle(ids.a,{...body,clinicId:ids.clinic}).status,400);
  fixture.setFailure('botSession','forbidden');assert.equal(fixture.handle(ids.a,body).status,403);
  fixture.setFailure('botSession',null);assert.equal(fixture.handle(ids.a,body).data.session.path.length,2);
});
test('controlled refusals and malformed DTOs restore without modifying rows', () => {
  const fixture = createWhatsAppReadFixture(ids), original = fixture.handle(ids.a, input);
  fixture.setFailure('conversations', 'forbidden'); assert.equal(fixture.handle(ids.a, input).status, 403);
  fixture.setFailure('conversations', 'invalid'); assert.deepEqual(fixture.handle(ids.a, input).data, { unexpected: true });
  fixture.setFailure('conversations', null); assert.deepEqual(fixture.handle(ids.a, input), original);
});
test('new HTTP fixture remains opt-in and only enables synthetic reads', async () => {
  for (const enabled of [false, true]) {
    const api = await startReceptionFixture({ whatsappReadReview: enabled });
    try {
      const token = 'synthetic.' + Buffer.from(JSON.stringify({ sub: ids.a })).toString('base64url') + '.synthetic';
      const response = await fetch(api.origin + '/functions/v1/whatsapp-api', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      assert.equal(response.status, enabled ? 200 : 503);
      if (enabled) assert.equal((await response.json()).conversations.length, 2);
    } finally { await api.close(); }
  }
});
