// Sign-document flow (D17) against a fake PSC and an in-memory copy of the
// database state machine (same transitions and checks as
// 20261105100000_digital_signature.sql). Synthetic material only.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AD_RB_V1_1, sha256 } from '../../supabase/functions/_shared/pades';
import { PscAmbiguousError, PscRejectedError, parseKeyList, sealSecret, tokenBinding, type PscCertificate } from '../../supabase/functions/_shared/psc';
import { signDocument, signedPathOf, type SignatureOperation, type SignaturePorts, type SignatureRequest } from '../../supabase/functions/_shared/signatureFlow';
import { RSA, minimalPdf, rawRsaSign, syntheticCertificate } from '../test/syntheticPki';

const USER = '11111111-1111-4111-8111-111111111111';
const RX = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const keyList = parseKeyList(`k1:${Buffer.from(new Uint8Array(32).fill(9)).toString('base64')}`);

let doctorJwk: JsonWebKey;
let doctorCert: Uint8Array;
let caCert: Uint8Array;
let otherCert: Uint8Array;

beforeAll(async () => {
  const ca = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  const doctor = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  doctorJwk = await crypto.subtle.exportKey('jwk', doctor.privateKey);
  caCert = await syntheticCertificate('AC Sintética', 'AC Sintética', ca, ca.privateKey, 1);
  doctorCert = await syntheticCertificate('Médica Sintética:00000000000', 'AC Sintética', doctor, ca.privateKey, 0x2a17);
  otherCert = await syntheticCertificate('Outra Sintética:11111111111', 'AC Sintética', ca, ca.privateKey, 5);
}, 30_000);

const rpcError = (code: string, message = code) => Object.assign(new Error(message), { code });

const ALLOWED = new Set([
  'reserved>prepared', 'reserved>failed', 'reserved>cancelled', 'reserved>cancelled_by_revocation',
  'prepared>psc_requested', 'prepared>failed', 'prepared>cancelled', 'prepared>cancelled_by_revocation',
  'psc_requested>ambiguous', 'psc_requested>stored', 'psc_requested>failed', 'psc_requested>cancelled', 'psc_requested>cancelled_by_revocation',
  'ambiguous>psc_requested', 'ambiguous>failed', 'ambiguous>cancelled', 'ambiguous>cancelled_by_revocation',
  'stored>completed', 'stored>cancelled', 'stored>cancelled_by_revocation',
]);

/** In-memory database: one session, one document, the signature RPCs. */
function fakeDb(original: Uint8Array) {
  const db = {
    session: { active: true, generation: 1, certSha256: '', sealed: null as unknown },
    doc: { status: 'generated', pdfSha256: '', signedPath: null as string | null },
    ops: new Map<string, SignatureOperation & { staged_path: string | null }>(),
    audit: [] as Array<Record<string, unknown>>,
    calls: [] as string[],
    states: [] as string[],
    throwOnce: new Map<string, Error[]>(), // rpc name -> errors to throw before running
    recent: 0,
    cortexLive: true, // the doctor's Cortex session (the fence of signature_session_fence)
    hasObject: (_path: string | null) => true, // storage.objects, wired to the fake Storage
  };
  const out = (o: SignatureOperation & { staged_path: string | null }, keepPath = false) => {
    const { staged_path, ...rest } = structuredClone(o);
    return keepPath ? { ...rest, staged_path } : rest;
  };
  const set = (o: SignatureOperation & { staged_path: string | null }, patch: Partial<SignatureOperation & { staged_path: string | null }>) => {
    const next = { ...o, ...patch };
    if (next.state !== o.state && !ALLOWED.has(`${o.state}>${next.state}`)) throw rpcError('22023', `transition ${o.state} -> ${next.state}`);
    if (o.prepared_pdf_sha256 && (next.prepared_pdf_sha256 !== o.prepared_pdf_sha256 || next.to_be_signed_sha256 !== o.to_be_signed_sha256)) throw rpcError('22023', 'prepared immutable');
    if (next.psc_attempts !== o.psc_attempts && !(next.state === 'psc_requested' && ['prepared', 'ambiguous'].includes(o.state))) throw rpcError('22023', 'attempt');
    if (next.cleanup_pending && !['failed', 'cancelled', 'cancelled_by_revocation'].includes(next.state)) throw rpcError('22023', 'cleanup');
    Object.assign(o, next);
    db.states.push(o.state);
    return o;
  };
  const usable = (o: SignatureOperation) => db.session.active && db.session.generation === o.session_generation;
  const rpc = async (name: string, a: Record<string, unknown>): Promise<unknown> => {
    db.calls.push(name === 'signature_advance' ? `advance:${a.p_to}` : name === 'signature_close' ? `close:${a.p_to}` : name);
    const queued = db.throwOnce.get(name)?.shift();
    if (queued) throw queued;
    const op = db.ops.get(a.p_operation as string);
    switch (name) {
      case 'signature_reserve': {
        if (op) {
          if (['completed', 'failed', 'cancelled', 'cancelled_by_revocation'].includes(op.state)) return out(op); // history, no fence
          if (!db.cortexLive) throw rpcError('P4011');
          return out(op);
        }
        if (!db.session.active) throw rpcError('P4031');
        if (db.doc.status !== 'generated' || db.doc.pdfSha256 !== a.p_shown_sha256) throw rpcError('P4093');
        if ([...db.ops.values()].some((o) => ['reserved', 'prepared', 'psc_requested', 'ambiguous', 'stored'].includes(o.state))) throw rpcError('P4093');
        if (!db.cortexLive) throw rpcError('P4011');
        if (db.recent >= 60) { db.session.active = false; db.session.generation++; return { error: 'rate_limited' }; }
        const created = {
          operation_id: a.p_operation as string, user_id: USER, prescription_id: RX, session_id: SESSION, session_generation: db.session.generation,
          shown_pdf_sha256: a.p_shown_sha256 as string, cert_sha256: db.session.certSha256, signing_time: '2026-11-04T21:00:00+00:00', state: 'reserved' as const,
          prepared_pdf_sha256: null, to_be_signed_sha256: null, policy_oid: null, psc_attempts: 0, staged_path: null, signed_pdf_sha256: null,
          cleanup_pending: false, error_code: null,
        };
        db.ops.set(created.operation_id, created);
        db.states.push('reserved');
        db.recent++;
        return out(created);
      }
      case 'signature_session_token':
        if (!db.session.active || db.session.generation !== a.p_generation) throw rpcError('P4031');
        if (!db.cortexLive) throw rpcError('P4011');
        return db.session.sealed;
      case 'signature_advance': {
        if (!op) throw rpcError('42501');
        const to = a.p_to as string;
        const data = (a.p_data ?? {}) as Record<string, unknown>;
        if (!['prepared', 'psc_requested', 'stored'].includes(to)) throw rpcError('22023', 'not a productive step');
        const ended = ['completed', 'failed', 'cancelled', 'cancelled_by_revocation'];
        // 1. Pertinence first (no effect otherwise), as in the SQL.
        if (to === 'prepared') {
          if (op.state === 'prepared') {
            if (op.prepared_pdf_sha256 !== data.preparedSha256 || op.to_be_signed_sha256 !== data.toBeSignedSha256) throw rpcError('22023', 'prepared immutable');
          } else if (op.state !== 'reserved') return out(op); // no longer pertinent: history
        } else if (to === 'psc_requested') {
          if (op.state === 'stored' || ended.includes(op.state)) return out(op);
          if (op.state === 'psc_requested') throw rpcError('P4093', 'in flight');
          if (op.state === 'ambiguous' && data.humanRetry !== true) throw rpcError('P4093', 'human retry only');
          if (!['prepared', 'ambiguous'].includes(op.state)) throw rpcError('P4093');
          if (data.attempt !== op.psc_attempts) throw rpcError('P4094', 'observed attempt superseded');
          if (op.to_be_signed_sha256 !== data.toBeSignedSha256) throw rpcError('22023');
        } else {
          if (data.attempt !== op.psc_attempts || !['psc_requested', 'stored'].includes(op.state)) throw rpcError('P4094', 'superseded attempt');
          if (op.state === 'stored' && (op.staged_path !== data.stagedPath || op.signed_pdf_sha256 !== data.signedSha256)) throw rpcError('22023', 'stored immutable');
        }
        // 2. Pertinent: the PSC session revoked or expired ends it.
        if (!usable(op)) {
          set(op, { state: 'cancelled_by_revocation', cleanup_pending: to === 'stored' || ['psc_requested', 'ambiguous', 'stored'].includes(op.state) || data.uploaded === true });
          return out(op);
        }
        // 3. The Cortex session, last, before the effect: a pertinent step ends.
        if (!db.cortexLive) {
          set(op, { state: 'cancelled', error_code: 'auth_session_ended', cleanup_pending: op.staged_path !== null || ['psc_requested', 'ambiguous', 'stored'].includes(op.state) || to === 'stored' });
          return out(op);
        }
        if (to === 'prepared') {
          if (op.state === 'reserved') set(op, { state: 'prepared', prepared_pdf_sha256: data.preparedSha256 as string, to_be_signed_sha256: data.toBeSignedSha256 as string, policy_oid: data.policyOid as string });
        } else if (to === 'psc_requested') {
          set(op, { state: 'psc_requested', psc_attempts: op.psc_attempts + 1 });
        } else if (op.state === 'psc_requested') {
          set(op, { state: 'stored', staged_path: data.stagedPath as string, signed_pdf_sha256: data.signedSha256 as string });
        }
        return out(op);
      }
      case 'signature_close': {
        if (!op) throw rpcError('42501');
        const to = a.p_to as string;
        const data = (a.p_data ?? {}) as Record<string, unknown>;
        if (!['ambiguous', 'failed', 'cancelled'].includes(to)) throw rpcError('22023', 'not a closing step');
        // A terminal operation is never rewritten by a late step.
        if (['completed', 'failed', 'cancelled', 'cancelled_by_revocation'].includes(op.state) && (to === 'failed' || to === 'cancelled')) return out(op);
        // Steps after a PSC call name their attempt (P4094 for an older one).
        if (to === 'ambiguous' || (to === 'failed' && ['psc_requested', 'ambiguous'].includes(op.state))) {
          const allowed = op.state === 'psc_requested' || op.state === to || (to === 'failed' && op.state === 'ambiguous');
          if (data.attempt !== op.psc_attempts || !allowed) throw rpcError('P4094', 'superseded attempt');
        }
        if (to === 'ambiguous') set(op, { state: 'ambiguous' });
        else set(op, { state: to as 'failed', error_code: (data.code as string) ?? null, cleanup_pending: op.staged_path !== null || ['psc_requested', 'ambiguous'].includes(op.state) || data.uploaded === true });
        return out(op);
      }
      case 'signature_complete': {
        if (!op) throw rpcError('42501');
        if (['completed', 'failed', 'cancelled', 'cancelled_by_revocation'].includes(op.state)) return out(op, true); // history
        if (op.state !== 'stored') throw rpcError('P4093');
        if (!usable(op)) { set(op, { state: 'cancelled_by_revocation', cleanup_pending: true }); return out(op, true); }
        if (db.doc.status !== 'generated' || db.doc.signedPath || db.doc.pdfSha256 !== op.shown_pdf_sha256) {
          set(op, { state: 'cancelled', error_code: 'document_changed', cleanup_pending: true });
          return out(op, true);
        }
        if (!db.hasObject(op.staged_path)) {
          set(op, { state: 'cancelled', error_code: 'stored_object_missing', cleanup_pending: true });
          return out(op, true);
        }
        if (!db.cortexLive) {
          set(op, { state: 'cancelled', error_code: 'auth_session_ended', cleanup_pending: true });
          return out(op, true);
        }
        db.doc = { ...db.doc, status: 'signed', signedPath: op.staged_path };
        db.audit.push({ operation: op.operation_id, serial: (a.p_cert_serial as string).toLowerCase(), issuer: a.p_cert_issuer, attempts: op.psc_attempts, before: op.shown_pdf_sha256, after: op.signed_pdf_sha256 });
        set(op, { state: 'completed' });
        return out(op, true);
      }
      case 'signature_cleanup_done':
        if (op) op.cleanup_pending = false;
        return null;
      default:
        throw new Error(`unexpected rpc ${name}`);
    }
  };
  return { db, rpc, original };
}

interface World {
  db: ReturnType<typeof fakeDb>['db'];
  storage: Map<string, Uint8Array>;
  pscCalls: number;
  ports: SignaturePorts;
  request: SignatureRequest;
  psc: {
    lose?: boolean; reject?: boolean; corrupt?: boolean; certificates?: PscCertificate[]; onSign?: () => void;
    /** Per call (1, 2, ...): may wait, then sign, lose the answer or refuse. */
    answer?: (call: number) => Promise<'sign' | 'lose' | 'reject'>;
    uploadFails?: () => boolean;
  };
  original: Uint8Array;
  beforeOriginal?: () => Promise<void>;
}

let world: World;
let opSeq = 0;

beforeEach(async () => {
  const original = minimalPdf();
  const { db, rpc } = fakeDb(original);
  db.session.certSha256 = hex(await sha256(doctorCert));
  db.doc.pdfSha256 = hex(await sha256(original));
  db.session.sealed = await sealSecret(keyList, 'synthetic-psc-token', tokenBinding(SESSION, USER, 1));
  const storage = new Map<string, Uint8Array>();
  const w = { db, storage, pscCalls: 0, psc: {}, original } as World;
  db.hasObject = (p) => p !== null && storage.has(p);
  w.ports = {
    rpc,
    downloadOriginal: async () => { await w.beforeOriginal?.(); return w.original; },
    // storage_parent_is_live: a candidate only while its operation stores it or completed.
    uploadSigned: async (path, pdf) => {
      const owner = [...db.ops.values()].find((o) => signedPathOf(o) === path);
      if (!owner || !['psc_requested', 'stored', 'completed'].includes(owner.state)) throw new Error('Storage object requires a live owned parent');
      if (w.psc.uploadFails?.()) throw new Error('connection reset during upload');
      if (storage.has(path)) return 'exists';
      storage.set(path, pdf.slice());
      return 'created';
    },
    downloadSigned: async (path) => storage.get(path) ?? null,
    removeSigned: async (path) => { storage.delete(path); },
    psc: {
      discovery: async (token) => {
        expect(token).toBe('synthetic-psc-token');
        return w.psc.certificates ?? [{ alias: 'vidaas-1', certificate: doctorCert, chain: [caCert] }];
      },
      sign: async (token, p) => {
        expect(token).toBe('synthetic-psc-token');
        expect(p.id).toBe(w.request.operationId);
        const call = ++w.pscCalls;
        w.psc.onSign?.();
        const answer = w.psc.answer ? await w.psc.answer(call) : 'sign';
        if (w.psc.reject || answer === 'reject') throw new PscRejectedError('recusado', 403);
        const raw = rawRsaSign(doctorJwk, p.hash);
        if (w.psc.lose || answer === 'lose') throw new PscAmbiguousError('resposta perdida');
        if (w.psc.corrupt) raw[7] ^= 0xff;
        return raw;
      },
    },
    keys: keyList,
    sleep: async () => {},
  };
  opSeq++;
  w.request = {
    userId: USER,
    operationId: `44444444-4444-4444-8444-${String(opSeq).padStart(12, '0')}`,
    prescriptionId: RX,
    shownPdfSha256: db.doc.pdfSha256,
    policy: { oid: AD_RB_V1_1, hash: new Uint8Array(32).fill(7), uri: 'http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_1.der' },
    health: { crm: '00000', uf: 'PR', specialty: 'Ginecologia e Obstetrícia', documentType: 'prescricao' },
    reason: 'Prescrição médica',
  };
  world = w;
});

const opOf = () => world.db.ops.get(world.request.operationId)!;
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 1000 && !condition(); i++) await new Promise((r) => setTimeout(r, 1));
  expect(condition()).toBe(true);
};
const gate = () => { let open!: () => void; const wait = new Promise<void>((r) => { open = r; }); return { open, wait }; };
const tokenCalls = () => world.db.calls.filter((c) => c === 'signature_session_token').length;
const path = () => signedPathOf({ user_id: USER, prescription_id: RX, operation_id: world.request.operationId });

describe('signDocument: normal path', () => {
  it('reserves, prepares, calls the PSC once, stores, verifies and commits', async () => {
    const outcome = await signDocument(world.ports, world.request);
    expect(outcome).toEqual({ status: 'completed', signedPath: path(), signedSha256: opOf().signed_pdf_sha256 });
    expect(world.db.states).toEqual(['reserved', 'prepared', 'psc_requested', 'stored', 'completed']);
    expect(world.pscCalls).toBe(1);
    const signed = world.storage.get(path())!;
    expect(Buffer.from(signed.subarray(0, world.original.length)).equals(Buffer.from(world.original))).toBe(true); // incremental
    expect(hex(await sha256(signed))).toBe(opOf().signed_pdf_sha256);
    expect(world.db.audit).toEqual([{ operation: world.request.operationId, serial: '2a17', issuer: 'AC Sintética', attempts: 1, before: world.request.shownPdfSha256, after: opOf().signed_pdf_sha256 }]);
    expect(world.db.doc).toMatchObject({ status: 'signed', signedPath: path() });
  });

  it('repeating the same operation id after completion never calls the PSC again', async () => {
    const first = await signDocument(world.ports, world.request);
    expect(await signDocument(world.ports, world.request)).toEqual(first);
    expect(world.pscCalls).toBe(1);
    expect(world.db.audit).toHaveLength(1);
  });

  it('retries a busy database step after the PSC answered instead of signing again', async () => {
    world.db.throwOnce.set('signature_complete', [rpcError('40001'), rpcError('40001')]);
    const outcome = await signDocument(world.ports, world.request);
    expect(outcome.status).toBe('completed');
    expect(world.pscCalls).toBe(1);
    expect(world.db.calls.filter((c) => c === 'signature_complete')).toHaveLength(3);
  });

  it('refuses when over the rate limit', async () => {
    world.db.recent = 60;
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'rate_limited' });
    expect(world.pscCalls).toBe(0);
  });
});

describe('signDocument: lost answers and human retry', () => {
  it('marks a lost PSC answer ambiguous and only a human retry signs again, with the same bytes', async () => {
    world.psc.lose = true;
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'ambiguous' });
    expect(opOf().state).toBe('ambiguous');
    expect(world.storage.size).toBe(0);

    // The same request again (no human action): nothing is sent.
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'ambiguous' });
    expect(world.pscCalls).toBe(1);

    world.psc.lose = false;
    const outcome = await signDocument(world.ports, { ...world.request, humanRetry: true });
    expect(outcome.status).toBe('completed');
    expect(world.pscCalls).toBe(2);
    expect(opOf().psc_attempts).toBe(2);
    expect(world.db.audit).toHaveLength(1);
    expect(world.db.audit[0].attempts).toBe(2);
  });

  it('an attempt still marked in flight is left alone until the doctor retries', async () => {
    // First call: the PSC signs and the file is uploaded, then the database
    // stays busy past the retries, so the operation is left psc_requested.
    const busy = [rpcError('40001'), rpcError('40001'), rpcError('40001'), rpcError('40001')];
    const rpc = world.ports.rpc;
    world.ports.rpc = async (name, a) => {
      if (name === 'signature_advance' && a.p_to === 'stored' && busy.length) throw busy.shift();
      return rpc(name, a);
    };
    await expect(signDocument(world.ports, world.request)).rejects.toMatchObject({ code: '40001' });
    expect(opOf().state).toBe('psc_requested');
    const firstBytes = world.storage.get(path())!;
    expect(firstBytes).toBeDefined();

    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'in_progress' });
    expect(world.pscCalls).toBe(1);

    const outcome = await signDocument(world.ports, { ...world.request, humanRetry: true });
    expect(outcome.status).toBe('completed');
    expect(world.pscCalls).toBe(2);
    // Deterministic RSA: the retry produced exactly the file already stored.
    expect(world.storage.get(path())).toEqual(firstBytes);
    expect(world.db.states).toEqual(['reserved', 'prepared', 'psc_requested', 'ambiguous', 'psc_requested', 'stored', 'completed']);
  });

  it('refuses a different object already at the operation path and removes it', async () => {
    world.storage.set(path(), minimalPdf('outro conteudo'));
    const outcome = await signDocument(world.ports, world.request);
    expect(outcome).toEqual({ status: 'failed', code: 'storage_conflict' });
    expect(world.storage.has(path())).toBe(false);
    expect(opOf().cleanup_pending).toBe(false);
  });
});

describe('signDocument: attempts and resumption (Codex 04/11 19:49)', () => {
  it('resumes a stored answer without the PSC or the session token, and a revocation still wins', async () => {
    world.db.throwOnce.set('signature_complete', [rpcError('40001'), rpcError('40001'), rpcError('40001'), rpcError('40001')]);
    await expect(signDocument(world.ports, world.request)).rejects.toMatchObject({ code: '40001' });
    expect(opOf().state).toBe('stored');
    world.db.session.active = false;
    world.db.session.generation++;
    const before = tokenCalls();
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'cancelled_by_revocation', code: null });
    expect(tokenCalls()).toBe(before);
    expect(world.pscCalls).toBe(1);
    expect(world.storage.size).toBe(0);
    expect(opOf().cleanup_pending).toBe(false);
    expect(world.db.audit).toHaveLength(0);
  });

  it('a stored answer resumed with a valid session completes with the certificate from the stored file', async () => {
    world.db.throwOnce.set('signature_complete', [rpcError('40001'), rpcError('40001'), rpcError('40001'), rpcError('40001')]);
    await expect(signDocument(world.ports, world.request)).rejects.toMatchObject({ code: '40001' });
    const before = tokenCalls();
    const outcome = await signDocument(world.ports, world.request);
    expect(outcome.status).toBe('completed');
    expect(tokenCalls()).toBe(before);
    expect(world.pscCalls).toBe(1);
    expect(world.db.audit[0]).toMatchObject({ serial: '2a17', issuer: 'AC Sintética' });
  });

  it('a stored answer whose file is gone or different is cancelled, never completed', async () => {
    world.db.throwOnce.set('signature_complete', [rpcError('40001'), rpcError('40001'), rpcError('40001'), rpcError('40001')]);
    await expect(signDocument(world.ports, world.request)).rejects.toMatchObject({ code: '40001' });
    world.storage.set(path(), minimalPdf('outro'));
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'cancelled', code: 'stored_object_invalid' });
    expect(world.storage.size).toBe(0);
    expect(world.db.doc.status).toBe('generated');
  });

  it('a late timeout of the older attempt never marks the newer one', async () => {
    const a = gate();
    const b = gate();
    world.psc.answer = async (call) => { await (call === 1 ? a : b).wait; return call === 1 ? 'lose' : 'sign'; };
    const first = signDocument(world.ports, world.request);
    await until(() => world.pscCalls === 1);
    const second = signDocument(world.ports, { ...world.request, humanRetry: true });
    await until(() => world.pscCalls === 2);
    expect(opOf()).toMatchObject({ state: 'psc_requested', psc_attempts: 2 });
    a.open(); // attempt 1 times out while attempt 2 is waiting for the PSC
    expect(await first).toEqual({ status: 'in_progress' });
    expect(opOf()).toMatchObject({ state: 'psc_requested', psc_attempts: 2 });
    b.open();
    expect((await second).status).toBe('completed');
    expect(world.storage.size).toBe(1);
    expect(world.db.audit).toEqual([expect.objectContaining({ attempts: 2 })]);
    expect(world.db.states.slice(-3)).toEqual(['psc_requested', 'stored', 'completed']);
  });

  it('a late answer of the older attempt is not stored over the newer one, and its file is reused only if identical', async () => {
    const a = gate();
    const b = gate();
    world.psc.answer = async (call) => { await (call === 1 ? a : b).wait; return 'sign'; };
    const first = signDocument(world.ports, world.request);
    await until(() => world.pscCalls === 1);
    const second = signDocument(world.ports, { ...world.request, humanRetry: true });
    await until(() => world.pscCalls === 2);
    a.open(); // attempt 1 answers late: it uploads, then its store is refused
    expect(await first).toEqual({ status: 'in_progress' });
    expect(opOf()).toMatchObject({ state: 'psc_requested', psc_attempts: 2 });
    const uploadedByFirst = world.storage.get(path())!;
    b.open();
    expect((await second).status).toBe('completed');
    expect(world.storage.get(path())).toEqual(uploadedByFirst); // same bytes (deterministic RSA)
    expect(opOf().signed_pdf_sha256).toBe(hex(await sha256(uploadedByFirst)));
  });
});

describe('signDocument: late answers and stored files (Codex 04/11 20:55)', () => {
  it('a late answer after the newer attempt failed and was cleaned leaves no file and keeps the failure', async () => {
    const a = gate();
    world.psc.answer = async (call) => { if (call === 1) { await a.wait; return 'sign'; } return 'reject'; };
    const first = signDocument(world.ports, world.request);
    await until(() => world.pscCalls === 1);
    expect(await signDocument(world.ports, { ...world.request, humanRetry: true })).toEqual({ status: 'failed', code: 'psc_rejected' });
    expect(opOf()).toMatchObject({ state: 'failed', cleanup_pending: false });
    a.open(); // attempt 1 answers now: its upload is refused, and it cannot touch the failure
    expect(await first).toEqual({ status: 'in_progress' });
    expect(world.storage.size).toBe(0);
    expect(opOf()).toMatchObject({ state: 'failed', error_code: 'psc_rejected', psc_attempts: 2, cleanup_pending: false });
    expect(world.db.audit).toHaveLength(0);
  });

  it('a late answer while the newer attempt is being prepared stays reconciled, and the newer one completes', async () => {
    const a = gate();
    const b = gate();
    world.psc.answer = async (call) => { if (call === 1) await a.wait; return 'sign'; };
    const first = signDocument(world.ports, world.request);
    await until(() => world.pscCalls === 1);
    world.beforeOriginal = () => b.wait;
    const second = signDocument(world.ports, { ...world.request, humanRetry: true });
    await until(() => opOf().state === 'ambiguous'); // B reconciled attempt 1 and is preparing
    a.open();
    expect(await first).toEqual({ status: 'ambiguous' }); // upload refused: attempt 1 stays without answer
    expect(world.storage.size).toBe(0);
    world.beforeOriginal = undefined;
    b.open();
    expect((await second).status).toBe('completed');
    expect(world.db.audit).toEqual([expect.objectContaining({ attempts: 2 })]);
  });

  it('a late refusal of the older attempt never ends the newer attempt that is without answer', async () => {
    const a = gate();
    world.psc.answer = async (call) => { if (call === 1) { await a.wait; return 'reject'; } return 'lose'; };
    const first = signDocument(world.ports, world.request);
    await until(() => world.pscCalls === 1);
    expect(await signDocument(world.ports, { ...world.request, humanRetry: true })).toEqual({ status: 'ambiguous' });
    expect(opOf()).toMatchObject({ state: 'ambiguous', psc_attempts: 2 });
    a.open();
    expect(await first).toEqual({ status: 'in_progress' });
    expect(opOf()).toMatchObject({ state: 'ambiguous', psc_attempts: 2 }); // still the doctor's to retry
  });

  it('an upload lost in transit leaves the attempt without answer; the doctor retries with the same bytes', async () => {
    let fails = 1;
    world.psc.uploadFails = () => fails-- > 0;
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'ambiguous' });
    expect(opOf()).toMatchObject({ state: 'ambiguous', psc_attempts: 1 });
    expect((await signDocument(world.ports, { ...world.request, humanRetry: true })).status).toBe('completed');
    expect(opOf().psc_attempts).toBe(2);
  });

  it('a reason containing "/ByteRange" does not stop a stored answer from being resumed', async () => {
    world.request = { ...world.request, reason: 'Prescricao /ByteRange medica' };
    world.db.throwOnce.set('signature_complete', [rpcError('40001'), rpcError('40001'), rpcError('40001'), rpcError('40001')]);
    await expect(signDocument(world.ports, world.request)).rejects.toMatchObject({ code: '40001' });
    expect((await signDocument(world.ports, world.request)).status).toBe('completed');
    expect(world.pscCalls).toBe(1);
  });
});

describe('signDocument: the Cortex session (contract v3.1)', () => {
  it('a session ended before the reservation refuses without an operation (P4011 for the handler)', async () => {
    world.db.cortexLive = false;
    await expect(signDocument(world.ports, world.request)).rejects.toMatchObject({ code: 'P4011' });
    expect(world.db.ops.size).toBe(0);
    expect(world.pscCalls).toBe(0);
  });

  it('a session ended after the reservation ends the operation at its next step, returned, without a PSC call', async () => {
    const rpc = world.ports.rpc;
    world.ports.rpc = async (name, a) => {
      if (name === 'signature_advance' && a.p_to === 'prepared') world.db.cortexLive = false;
      return rpc(name, a);
    };
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'cancelled', code: 'auth_session_ended' });
    expect(world.pscCalls).toBe(0);
    expect(opOf()).toMatchObject({ state: 'cancelled', cleanup_pending: false });
  });

  it('a session ended while the PSC signs: the answer is not published and its file is removed', async () => {
    world.psc.onSign = () => { world.db.cortexLive = false; };
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'cancelled', code: 'auth_session_ended' });
    expect(world.pscCalls).toBe(1);
    expect(world.storage.size).toBe(0);
    expect(opOf().cleanup_pending).toBe(false); // cleanup done
    expect(world.db.audit).toHaveLength(0);
    expect(world.db.doc.status).toBe('generated');
  });

  it('a session ended between storing and completing: nothing is published', async () => {
    const rpc = world.ports.rpc;
    world.ports.rpc = async (name, a) => {
      if (name === 'signature_complete') world.db.cortexLive = false;
      return rpc(name, a);
    };
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'cancelled', code: 'auth_session_ended' });
    expect(world.storage.size).toBe(0);
    expect(world.db.doc.status).toBe('generated');
  });

  it('the completed replay works without a live session (history only)', async () => {
    expect((await signDocument(world.ports, world.request)).status).toBe('completed');
    world.db.cortexLive = false;
    expect((await signDocument(world.ports, world.request)).status).toBe('completed');
  });

  it('a stored answer whose object vanished before the commit is cancelled, not published', async () => {
    const rpc = world.ports.rpc;
    world.ports.rpc = async (name, a) => {
      if (name === 'signature_complete') world.storage.clear();
      return rpc(name, a);
    };
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'cancelled', code: 'stored_object_missing' });
    expect(world.db.doc.status).toBe('generated');
  });

  it('the retry names the attempt it observed', async () => {
    world.psc.lose = true;
    await signDocument(world.ports, world.request);
    world.psc.lose = false;
    const sent: unknown[] = [];
    const rpc = world.ports.rpc;
    world.ports.rpc = async (name, a) => { if (name === 'signature_advance' && a.p_to === 'psc_requested') sent.push(a.p_data); return rpc(name, a); };
    expect((await signDocument(world.ports, { ...world.request, humanRetry: true })).status).toBe('completed');
    expect(sent).toEqual([expect.objectContaining({ attempt: 1, humanRetry: true })]);
  });
});

describe('signDocument: a step that no longer applies (Codex 05/11 03:24, R3)', () => {
  it('a late request whose twin completed the same operation gets the history, not an error', async () => {
    const a = gate();
    let first = true;
    world.beforeOriginal = async () => { if (first) { first = false; await a.wait; } };
    const late = signDocument(world.ports, world.request);
    await until(() => !first); // A reserved and is downloading the original
    expect((await signDocument(world.ports, world.request)).status).toBe('completed'); // B, same operation
    a.open();
    expect((await late).status).toBe('completed');
    expect(world.pscCalls).toBe(1);
    expect(world.db.audit).toHaveLength(1);
  });

  it('a late answer of attempt 1 after a PSC revocation never ends attempt 2 (R2)', async () => {
    const a = gate();
    const b = gate();
    world.psc.answer = async (call) => { await (call === 1 ? a : b).wait; return 'sign'; };
    const first = signDocument(world.ports, world.request);
    await until(() => world.pscCalls === 1);
    const second = signDocument(world.ports, { ...world.request, humanRetry: true });
    await until(() => world.pscCalls === 2); // attempt 2 in flight
    world.db.session.active = false; // the doctor revokes the PSC session
    world.db.session.generation++;
    a.open(); // attempt 1 answers late: its upload is allowed (psc_requested), its store is stale
    expect(await first).toEqual({ status: 'in_progress' }); // P4094, attempt 2 untouched
    expect(opOf()).toMatchObject({ state: 'psc_requested', psc_attempts: 2 });
    b.open(); // attempt 2 is pertinent: the revocation ends it
    expect(await second).toEqual({ status: 'cancelled_by_revocation', code: null });
    expect(world.storage.size).toBe(0);
  });
});

describe('signDocument: refusals before anything is published', () => {
  it('a forged PSC answer fails without uploading', async () => {
    world.psc.corrupt = true;
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'failed', code: 'invalid_signature' });
    expect(world.storage.size).toBe(0);
    expect(world.db.audit).toHaveLength(0);
    expect(world.db.doc.status).toBe('generated');
  });

  it('a PSC refusal fails the operation', async () => {
    world.psc.reject = true;
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'failed', code: 'psc_rejected' });
    expect(world.storage.size).toBe(0);
  });

  it('never prepares over bytes other than the ones the doctor saw', async () => {
    world.original = minimalPdf('Receita alterada');
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'failed', code: 'original_changed' });
    expect(world.pscCalls).toBe(0);
  });

  it('needs the certificate fixed in the session', async () => {
    world.psc.certificates = [{ alias: 'outro', certificate: otherCert, chain: [] }];
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'failed', code: 'certificate_changed' });
    expect(world.pscCalls).toBe(0);
  });
});

describe('signDocument: revocation and document changes win', () => {
  it('a session revoked before the PSC call cancels without calling it', async () => {
    const rpc = world.ports.rpc;
    world.ports.rpc = async (name, a) => {
      if (name === 'signature_session_token') { world.db.session.active = false; world.db.session.generation++; }
      return rpc(name, a);
    };
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'cancelled_by_revocation', code: null });
    expect(world.pscCalls).toBe(0);
  });

  it('a revocation while the PSC signs removes the uploaded file and publishes nothing', async () => {
    world.psc.onSign = () => { world.db.session.active = false; world.db.session.generation++; };
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'cancelled_by_revocation', code: null });
    expect(world.storage.size).toBe(0);
    expect(opOf().cleanup_pending).toBe(false); // cleanup done
    expect(world.db.audit).toHaveLength(0);
    expect(world.db.doc.status).toBe('generated');
  });

  it('a document changed before the commit is cancelled and its signed file removed', async () => {
    const rpc = world.ports.rpc;
    world.ports.rpc = async (name, a) => {
      if (name === 'signature_complete') world.db.doc.pdfSha256 = 'f'.repeat(64);
      return rpc(name, a);
    };
    expect(await signDocument(world.ports, world.request)).toEqual({ status: 'cancelled', code: 'document_changed' });
    expect(world.storage.size).toBe(0);
    expect(world.db.audit).toHaveLength(0);
  });

  it('a failed cleanup is left for the reconciliation job', async () => {
    world.psc.onSign = () => { world.db.session.active = false; world.db.session.generation++; };
    const logs: string[] = [];
    world.ports.removeSigned = async () => { throw new Error('storage offline'); };
    world.ports.log = (event) => logs.push(event);
    expect((await signDocument(world.ports, world.request)).status).toBe('cancelled_by_revocation');
    expect(opOf().cleanup_pending).toBe(true);
    expect(logs).toContain('signature_cleanup_deferred');
  });
});
