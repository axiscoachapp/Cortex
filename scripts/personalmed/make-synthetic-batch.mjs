#!/usr/bin/env node
// Write the synthetic staging batch (no real data) for loader development.
// Usage: node scripts/personalmed/make-synthetic-batch.mjs [outDir]
// Default outDir: scripts/personalmed/fixtures/synthetic-batch

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORT_DATE, agenda, charts, persons, plans } from './fixtures/synthetic-legacy.mjs';
import { buildAgenda, buildPerson, writeBatch } from './staging.mjs';

export function syntheticBatch() {
  const ctx = { sourceInstance: 'pm-synthetic', batchId: 'pm-synthetic-01', exportDate: EXPORT_DATE };
  const envelopes = [];
  const chartIds = new Map();
  for (const p of persons) {
    const list = buildPerson(ctx, p, charts.filter((c) => c.pcod === p.PCod), plans[p.PCod] ?? []);
    for (const e of list) if (e.sourceEntity === 'chart') chartIds.set(`${p.PCod}|${e.payload.ownerLegacyDoctor}`, e.targetId);
    envelopes.push(...list);
  }
  envelopes.push(...buildAgenda(ctx, agenda, chartIds));
  return { ctx, envelopes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'synthetic-batch');
  const { ctx, envelopes } = syntheticBatch();
  const manifest = writeBatch(out, envelopes, { sourceSystem: 'personalmed', sourceInstance: ctx.sourceInstance, batchId: ctx.batchId, exportDate: ctx.exportDate, synthetic: true });
  console.log(JSON.stringify({ out, counts: Object.fromEntries(Object.entries(manifest.counts).map(([k, v]) => [k, v.byStatus])) }, null, 2));
}
