#!/usr/bin/env node
// Write the synthetic staging batch (no real data) for loader development.
// Usage: node scripts/personalmed/make-synthetic-batch.mjs [outDir]
// Default outDir: scripts/personalmed/fixtures/synthetic-batch

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORT_DATE, agenda, charts, clinical, cohortFlags, persons, plans } from './fixtures/synthetic-legacy.mjs';
import { buildAgenda, buildChartClinical, buildPerson, writeBatch } from './staging.mjs';
import { splitHistory, wallClockToUtc } from './transforms.mjs';

export function syntheticBatch() {
  const ctx = { sourceInstance: 'pm-synthetic', batchId: 'pm-synthetic-01', exportDate: EXPORT_DATE, importDate: '2026-11-03' };
  const envelopes = [];
  const chartIds = new Map();
  for (const p of persons) {
    const list = buildPerson(ctx, p, charts.filter((c) => c.pcod === p.PCod), plans[p.PCod] ?? [], cohortFlags[p.PCod]);
    for (const e of list) if (e.sourceEntity === 'chart') chartIds.set(`${p.PCod}|${e.payload.ownerLegacyDoctor}`, e.targetId);
    envelopes.push(...list);
  }
  for (const [key, c] of Object.entries(clinical)) {
    const [pcod, user] = key.split('|').map(Number);
    const encounters = new Map(
      c.encounters.map((e) => [e.day, { ...e, appointmentStart: e.appointmentKey ? wallClockToUtc(e.appointmentKey.date, e.appointmentKey.start) : null }]),
    );
    const history = c.historyText ? splitHistory(c.historyText, { exportDate: ctx.exportDate }) : null;
    envelopes.push(...buildChartClinical(ctx, { pcod, user, patientTargetId: chartIds.get(key) }, { ...c, encounters, history }));
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
