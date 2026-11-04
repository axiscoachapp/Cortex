#!/usr/bin/env node
// Runs the AI evaluation end to end with the synthetic candidates:
//   node scripts/ai-eval/cli.mjs demo --out <folder>
// Writes outputs.json, automatic.json, the blind package (review/ and key/)
// and report.md. No network call; real candidates need test accounts and
// decisions D13/D15 before they can be added to CANDIDATES.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBlindPackage, writeBlindPackage } from './blind.mjs';
import { CANDIDATES, loadCases, renderReport, runCandidates, scoreOutputs } from './pipeline.mjs';

const [command, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

if (command !== 'demo' || !opt('--out')) {
  console.error('Uso: node scripts/ai-eval/cli.mjs demo --out <pasta>');
  process.exit(2);
}

const out = opt('--out');
mkdirSync(out, { recursive: true });
const cases = loadCases(new URL('./cases/', import.meta.url));
const outputs = await runCandidates(cases, Object.keys(CANDIDATES).filter((n) => CANDIDATES[n].synthetic));
const automatic = scoreOutputs(cases, outputs);
writeFileSync(join(out, 'outputs.json'), `${JSON.stringify(outputs, null, 2)}\n`);
writeFileSync(join(out, 'automatic.json'), `${JSON.stringify(automatic, null, 2)}\n`);
writeBlindPackage(out, buildBlindPackage(outputs.filter((o) => o.task === 'evolucao'), { seed: `demo-${new Date().toISOString().slice(0, 10)}` }));
writeFileSync(join(out, 'report.md'), renderReport({ automatic, criteria: { maxCriticalErrors: 0, maxTermErrorRate: 0.02, maxMedianEditMinutes: 2 }, title: 'Avaliação de IA — demonstração sintética' }));
console.log(JSON.stringify({ out, cases: cases.length, outputs: outputs.length, files: ['outputs.json', 'automatic.json', 'review/index.html', 'key/key.json', 'report.md'] }, null, 2));
