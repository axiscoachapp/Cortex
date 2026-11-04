#!/usr/bin/env node
// Write the synthetic staging batch (no real data) for loader development.
// Usage: node scripts/personalmed/make-synthetic-batch.mjs [outDir]
// Default outDir: scripts/personalmed/fixtures/synthetic-batch

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORT_DATE, USAGE_SINCE, agenda, alerts, charts, clinical, cohortFlags, issuedDocuments, persons, plans, templates } from './fixtures/synthetic-legacy.mjs';
import { buildAgenda, buildChartClinical, buildHealthPlanCards, buildLegacyAlert, buildPerson, buildTemplate, writeBatch } from './staging.mjs';
import { splitHistory, templateChunks, templateUsage, wallClockToUtc } from './transforms.mjs';
import { antimicrobialsIn, controlledSubstancesIn } from '../../supabase/functions/_shared/regulatedMedications.ts';

export function syntheticBatch() {
  const ctx = { sourceInstance: 'pm-synthetic', batchId: 'pm-synthetic-01', exportDate: EXPORT_DATE, importDate: '2026-11-03', usageSince: USAGE_SINCE };
  const envelopes = [];
  const chartIds = new Map();
  for (const p of persons) {
    const list = buildPerson(ctx, p, charts.filter((c) => c.pcod === p.PCod), plans[p.PCod] ?? [], cohortFlags[p.PCod]);
    for (const e of list) if (e.sourceEntity === 'chart') chartIds.set(`${p.PCod}|${e.payload.ownerLegacyDoctor}`, e.targetId);
    envelopes.push(...list);
  }
  for (const [pcod, cards] of Object.entries(plans)) envelopes.push(...buildHealthPlanCards(ctx, Number(pcod), cards));
  for (const [key, c] of Object.entries(clinical)) {
    const [pcod, user] = key.split('|').map(Number);
    const encounters = new Map(
      c.encounters.map((e) => [e.day, { ...e, appointmentStart: e.appointmentKey ? wallClockToUtc(e.appointmentKey.date, e.appointmentKey.start) : null }]),
    );
    const history = c.historyText ? splitHistory(c.historyText, { exportDate: ctx.exportDate }) : null;
    envelopes.push(...buildChartClinical(ctx, { pcod, user, patientTargetId: chartIds.get(key) }, { ...c, encounters, history }));
  }
  envelopes.push(...buildAgenda(ctx, agenda, chartIds));
  for (const a of alerts) {
    const own = charts.filter((c) => c.pcod === a.pcod).map((c) => ({ user: c.user, patientTargetId: chartIds.get(`${c.pcod}|${c.user}`) }));
    const e = buildLegacyAlert(ctx, a, own);
    if (e) envelopes.push(e);
  }
  const usage = templateUsage(
    templates.map((t) => ({ key: `${t.table}:${t.modelNumber}`, chunks: templateChunks(t.text) })),
    issuedDocuments,
    { since: USAGE_SINCE },
  );
  for (const t of templates) {
    const regulated = { antimicrobial: [...new Set(antimicrobialsIn(t.text))], controlled: [...new Set(controlledSubstancesIn(t.text))] };
    envelopes.push(buildTemplate(ctx, t, usage.get(`${t.table}:${t.modelNumber}`), regulated));
  }
  return { ctx, envelopes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'synthetic-batch');
  const { ctx, envelopes } = syntheticBatch();
  const manifest = writeBatch(out, envelopes, { sourceSystem: 'personalmed', sourceInstance: ctx.sourceInstance, batchId: ctx.batchId, exportDate: ctx.exportDate, synthetic: true });
  console.log(JSON.stringify({ out, counts: Object.fromEntries(Object.entries(manifest.counts).map(([k, v]) => [k, v.byStatus])) }, null, 2));
}
