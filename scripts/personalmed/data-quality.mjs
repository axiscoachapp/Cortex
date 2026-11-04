#!/usr/bin/env node
// PersonalMed 2005 -> Cortex: registration quality (CPF, phone, CEP/address,
// sex, birth date) and prescription-template analysis.
//
// PRIVACY: prints counts, rates and masked shapes only. Never prints names,
// CPFs, phones, addresses, dates of individuals or document text.
//
// Usage:
//   node scripts/personalmed/data-quality.mjs <exportDir> [--active-from 2025-01-01] [--json <out>]

import { readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ParadoxTable, toCalendarDate } from './paradox-reader.mjs';
import { Mdf } from './mssql2000-reader.mjs';
import { rtfToText } from './rtf-to-text.mjs';
import { antimicrobialsIn, controlledSubstancesIn } from '../../supabase/functions/_shared/regulatedMedications.ts';

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) throw new Error('usage: data-quality.mjs <exportDir> [--active-from YYYY-MM-DD] [--json out]');
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ACTIVE_FROM = opt('--active-from') ?? '2025-01-01';
const TODAY = new Date().toISOString().slice(0, 10);
const mdf = new Mdf(readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(dir, f))[0]);

function px(name) {
  const f = readdirSync(dir).find((x) => extname(x).toLowerCase() === '.db' && basename(x, extname(x)).toLowerCase() === name.toLowerCase());
  if (!f) throw new Error(`missing table ${name}`);
  return new ParadoxTable(join(dir, f));
}
function* rows(table, fields, blobs = 'none') {
  const idx = fields.map((n) => {
    const f = table.fields.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!f) throw new Error(`field ${n} not in ${table.name}`);
    return f.index;
  });
  for (const r of table.records({ fields, blobs })) {
    const o = {};
    fields.forEach((n, i) => {
      o[n] = r[idx[i]];
    });
    yield o;
  }
}

const iso = (v) => {
  const d = toCalendarDate(v)?.iso ?? null;
  return d && d > '1900-01-01' ? d : null; // Delphi zero date 1899-12-30 = null
};
const inc = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const sorted = (m) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const digits = (v) => str(v).replace(/\D/g, '');
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const plain = (v) => (typeof v === 'string' && v.trim() ? (v.trimStart().startsWith('{\\rtf') ? rtfToText(v).text : v) : '');

function cpfValid(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len) => {
    let s = 0;
    for (let i = 0; i < len; i += 1) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

// Brazilian area codes (DDD).
const DDD = new Set(
  [
    [11, 19], [21, 22], [24, 24], [27, 28], [31, 35], [37, 38], [41, 49], [51, 51], [53, 55], [61, 69], [71, 71],
    [73, 75], [77, 77], [79, 79], [81, 89], [91, 99],
  ].flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)),
);
// CEP ranges per UF (Correios).
const CEP_UF = [
  ['SP', 1000, 19999], ['RJ', 20000, 28999], ['ES', 29000, 29999], ['MG', 30000, 39999], ['BA', 40000, 48999],
  ['SE', 49000, 49999], ['PE', 50000, 56999], ['AL', 57000, 57999], ['PB', 58000, 58999], ['RN', 59000, 59999],
  ['CE', 60000, 63999], ['PI', 64000, 64999], ['MA', 65000, 65999], ['PA', 66000, 68899], ['AP', 68900, 68999],
  ['AM', 69000, 69299], ['RR', 69300, 69399], ['AM', 69400, 69899], ['AC', 69900, 69999], ['DF', 70000, 72799],
  ['GO', 72800, 72999], ['DF', 73000, 73699], ['GO', 73700, 76799], ['RO', 76800, 76999], ['TO', 77000, 77999],
  ['MT', 78000, 78899], ['MS', 79000, 79999], ['PR', 80000, 87999], ['SC', 88000, 89999], ['RS', 90000, 99999],
];
const ufOfCep = (d) => CEP_UF.find(([, a, b]) => Number(d.slice(0, 5)) >= a && Number(d.slice(0, 5)) <= b)?.[0] ?? null;
const UF_NAMES = {
  AC: 'acre', AL: 'alagoas', AP: 'amapa', AM: 'amazonas', BA: 'bahia', CE: 'ceara', DF: 'distrito federal', ES: 'espirito santo',
  GO: 'goias', MA: 'maranhao', MT: 'mato grosso', MS: 'mato grosso do sul', MG: 'minas gerais', PA: 'para', PB: 'paraiba',
  PR: 'parana', PE: 'pernambuco', PI: 'piaui', RJ: 'rio de janeiro', RN: 'rio grande do norte', RS: 'rio grande do sul',
  RO: 'rondonia', RR: 'roraima', SC: 'santa catarina', SP: 'sao paulo', SE: 'sergipe', TO: 'tocantins',
};
function ufOf(state) {
  const n = norm(state);
  if (!n) return null;
  const up = n.toUpperCase();
  if (UF_NAMES[up]) return up;
  return Object.entries(UF_NAMES).find(([, name]) => name === n)?.[0] ?? 'invalida';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CPF_FORMAT = /^\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s/]?\d{2}$/;
const PHONE_FORMAT = /\(\s*\d{2}\s*\)|\d{4,5}\s*-\s*\d{4}\s*$/;

/** Classify what a free-form registration field actually holds. */
function classify(raw) {
  const s = str(raw);
  if (!s) return 'vazio';
  if (s.includes('@')) return EMAIL_RE.test(s) ? 'email' : 'email_malformado';
  const d = s.replace(/\D/g, '');
  const letters = /[A-Za-zÀ-ÿ]/.test(s);
  if (letters) return d.length >= 8 ? 'texto_com_numero' : 'texto';
  if (d.length === 11) {
    const cpf = cpfValid(d);
    const mobile = DDD.has(Number(d.slice(0, 2))) && d[2] === '9';
    if (cpf && mobile) {
      if (PHONE_FORMAT.test(s)) return 'celular_com_ddd';
      if (/[.]/.test(s) || /^\d{3}\s\d{3}\s\d{3}\s\d{2}$/.test(s)) return 'cpf';
      return 'cpf_ou_celular';
    }
    if (cpf) return 'cpf';
    if (mobile) return 'celular_com_ddd';
    return CPF_FORMAT.test(s) && !PHONE_FORMAT.test(s) ? 'cpf_digito_invalido' : '11_digitos_outro';
  }
  if (d.length === 10) return DDD.has(Number(d.slice(0, 2))) ? 'fixo_com_ddd' : '10_digitos_outro';
  if (d.length === 9) return d[0] === '9' ? 'celular_sem_ddd' : '9_digitos_outro';
  if (d.length === 8) return /^[2-5]/.test(d) ? 'fixo_sem_ddd' : /^[6-9]/.test(d) ? 'celular_8dig_sem_nono' : '8_digitos_outro';
  if (d.length > 11) return 'varios_numeros';
  return 'curto_outro';
}

/** Normalise one phone fragment to Cortex's rule (10-15 digits). Returns {status, assumed}. */
function phoneFix(fragment, ddd = null) {
  let d = fragment.replace(/\D/g, '');
  if (d.startsWith('0') && d.length >= 11) d = d.replace(/^0+/, ''); // 0 41 ... trunk prefix
  if (d.length === 10 || d.length === 11) return DDD.has(Number(d.slice(0, 2))) ? { status: 'ok' } : { status: 'invalido' };
  const area = ddd && DDD.has(Number(ddd)) ? ddd : null;
  if (d.length === 9 && d[0] === '9') return { status: area ? 'ok' : 'falta_ddd' };
  if (d.length === 8 && /^[2-5]/.test(d)) return { status: area ? 'ok' : 'falta_ddd' };
  if (d.length === 8 && /^[6-9]/.test(d)) return { status: 'falta_ddd_e_nono' };
  return { status: 'invalido' };
}
const splitPhones = (s) => str(s).split(/\s*(?:\/|,|;|\be\b|\bou\b)\s*/i).filter((p) => /\d{8}/.test(p.replace(/\D/g, '')));

// ---------------------------------------------------------------------------
// Activity: last and first contact per patient

const first = new Map();
const last = new Map();
const futureAppt = new Set();
function seen(pcod, d) {
  if (pcod == null || !d || d > TODAY) return;
  if (!first.has(pcod) || d < first.get(pcod)) first.set(pcod, d);
  if (!last.has(pcod) || d > last.get(pcod)) last.set(pcod, d);
}
const doctorsOf = new Map(); // PCod -> Set(UserNumber)
for (const r of rows(mdf.table('Clini_02'), ['PCod', 'UserNumber', 'FirstMedAdvice', 'LastMedAdvice'])) {
  seen(r.PCod, iso(r.FirstMedAdvice));
  seen(r.PCod, iso(r.LastMedAdvice));
  if (!doctorsOf.has(r.PCod)) doctorsOf.set(r.PCod, new Set());
  doctorsOf.get(r.PCod).add(r.UserNumber);
}
for (const r of rows(px('Age04'), ['PCod', 'UserNumber', 'Data', 'Estado'])) {
  const d = iso(r.Data);
  if (r.PCod == null || !d) continue;
  if (d > TODAY && str(r.Estado) !== 'C') futureAppt.add(r.PCod);
  if (['T', 'A', 'E'].includes(str(r.Estado))) seen(r.PCod, d);
}
for (const r of rows(px('Co28'), ['PCod', 'DataInsert'])) seen(r.PCod, iso(r.DataInsert));

// Issued documents: activity + prescriptions kept for the template analysis.
const issued = []; // { pcod, user, year, text } for prescriptions (type 1)
const issuedByYear = new Map();
for (const r of rows(px('Clini_06'), ['PCod', 'UserNumber', 'DateInsert', 'ModelType', 'Contents'], 'text')) {
  const d = iso(r.DateInsert);
  seen(r.PCod, d);
  if (r.ModelType !== 1) continue;
  inc(issuedByYear, d ? d.slice(0, 4) : '(sem data)');
  issued.push({ user: r.UserNumber, date: d, text: norm(plain(r.Contents)) });
}

const eraOf = (pcod) => {
  const y = Number((first.get(pcod) ?? '').slice(0, 4));
  if (!y) return 'sem_data';
  if (y <= 2006) return '<=2006';
  if (y <= 2010) return '2007-2010';
  if (y <= 2015) return '2011-2015';
  if (y <= 2020) return '2016-2020';
  return '2021-2026';
};

// ---------------------------------------------------------------------------
// Registration (Clini_01)

const out = { activeFrom: ACTIVE_FROM, today: TODAY };
const groups = { todos: new Map(), ativos: new Map() };
const byEra = new Map(); // era -> Map(category -> n)
const cpfOwners = new Map(); // cpf -> [{name, birth}]
const counters = {};
const c = (group, key, by = 1) => {
  if (!counters[group]) counters[group] = new Map();
  inc(counters[group], key, by);
};

for (const p of rows(
  mdf.table('Clini_01'),
  ['PCod', 'Name', 'BirthDate', 'Sex', 'Phone', 'Cellular', 'DDDCellular', 'FAX', 'ID', 'EMail', 'Address', 'District', 'City', 'Zip', 'State', 'Mother', 'HomeBorn'],
)) {
  const active = (last.get(p.PCod) ?? '') >= ACTIVE_FROM || futureAppt.has(p.PCod);
  const scopes = active ? ['todos', 'ativos'] : ['todos'];
  const era = eraOf(p.PCod);
  const both = (key, by = 1) => scopes.forEach((s) => c(s, key, by));
  both('pacientes');
  if (futureAppt.has(p.PCod)) both('com_agendamento_futuro');

  // --- What each free-form field holds
  const cls = {
    FAX: classify(p.FAX),
    EMail: classify(p.EMail),
    ID: classify(p.ID),
    Phone: classify(p.Phone),
    Cellular: classify(str(p.DDDCellular) + str(p.Cellular)),
  };
  for (const [f, k] of Object.entries(cls)) if (f !== 'ID') both(`campo.${f}.${k}`); // RG numbers look like phones; only CPF-in-RG matters
  if (!byEra.has(era)) byEra.set(era, new Map());
  inc(byEra.get(era), 'pacientes');
  inc(byEra.get(era), `FAX.${cls.FAX}`);

  // --- Best CPF: first valid CPF found in any field, CPF-format first
  let cpf = null;
  let cpfSource = null;
  for (const f of ['FAX', 'ID', 'EMail', 'Phone', 'Cellular']) {
    const raw = f === 'Cellular' ? str(p.DDDCellular) + str(p.Cellular) : p[f];
    if (cls[f] === 'cpf' || (cls[f] === 'cpf_ou_celular' && (f === 'FAX' || f === 'ID'))) {
      cpf = digits(raw);
      cpfSource = f;
      break;
    }
  }
  both(cpf ? `cpf.valido.em_${cpfSource}` : 'cpf.ausente');
  inc(byEra.get(era), cpf ? 'cpf_valido' : 'cpf_ausente');
  if (cpf) {
    if (!cpfOwners.has(cpf)) cpfOwners.set(cpf, []);
    cpfOwners.get(cpf).push({ name: norm(str(p.Name)), birth: iso(p.BirthDate), active });
  }

  // --- Phone against Cortex's rule (10-15 digits)
  const naivePhone = digits(p.Phone);
  const naiveOk = !str(p.Phone) || (/^[+0-9\s().-]+$/.test(str(p.Phone)) && naivePhone.length >= 10 && naivePhone.length <= 15);
  both(naiveOk ? 'telefone.regra_cortex_sem_tratamento.passa' : 'telefone.regra_cortex_sem_tratamento.recusado');
  const candidates = [
    ...splitPhones(p.Phone).map((f) => phoneFix(f)),
    ...(str(p.Cellular) ? [phoneFix(str(p.Cellular), str(p.DDDCellular))] : []),
    ...(['celular_com_ddd', 'fixo_com_ddd', 'celular_sem_ddd', 'fixo_sem_ddd'].includes(cls.FAX) ? [phoneFix(str(p.FAX))] : []),
  ];
  const best = candidates.some((x) => x.status === 'ok')
    ? 'com_ddd'
    : candidates.some((x) => x.status === 'falta_ddd')
      ? 'falta_ddd'
      : candidates.some((x) => x.status === 'falta_ddd_e_nono')
        ? 'falta_ddd_e_nono_digito'
        : candidates.length
          ? 'invalido'
          : 'sem_telefone';
  both(`telefone.melhor.${best}`);
  if (best === 'falta_ddd' || best === 'falta_ddd_e_nono_digito') {
    // DDD 41 covers Curitiba and its metropolitan region (CEP 80000-83999).
    const z = Number(digits(p.Zip).slice(0, 5));
    const curitibaLike = /^(curitiba|ctba|cwb|curitba|sao jose dos pinhais|colombo|pinhais|araucaria|almirante tamandare|campo largo|fazenda rio grande|piraquara|campina grande do sul|quatro barras)$/.test(norm(str(p.City)));
    const area41 = (digits(p.Zip).length === 8 && z >= 80000 && z <= 83999) || curitibaLike;
    both(`telefone.sem_ddd.${area41 ? 'mora_na_area_41' : digits(p.Zip).length === 8 || str(p.City) ? 'mora_fora_da_area_41' : 'endereco_desconhecido'}`);
  }
  if (splitPhones(p.Phone).length > 1) both('telefone.varios_no_mesmo_campo');

  // --- CEP and address
  const zip = digits(p.Zip);
  const zipClass = !zip ? 'vazio' : zip.length === 8 ? (ufOfCep(zip) ? (zip.endsWith('000') ? 'generico_final_000' : 'valido') : 'fora_das_faixas') : zip.length === 5 ? 'antigo_5_digitos' : 'outro';
  both(`cep.${zipClass}`);
  const uf = ufOf(p.State);
  both(`uf.${uf === null ? 'vazia' : uf === 'invalida' ? 'invalida' : uf === 'PR' ? 'PR' : 'outra'}`);
  if (str(p.State) && uf && uf !== 'invalida' && str(p.State).length !== 2) both('uf.escrita_por_extenso');
  const cepUf = zip.length === 8 ? ufOfCep(zip) : null;
  if (uf === null) both(cepUf ? 'uf_vazia.deduzivel_pelo_cep' : /^(curitiba|ctba|cwb)$/.test(norm(str(p.City))) ? 'uf_vazia.deduzivel_pela_cidade' : 'uf_vazia.nao_deduzivel');
  if (cepUf && uf && uf !== 'invalida') both(cepUf === uf ? 'cep_x_uf.coerente' : 'cep_x_uf.divergente');
  const city = norm(str(p.City));
  const isCuritiba = /^(curitiba|ctba|cwb|curitba|curitiaba|curitibs)$/.test(city);
  if (city) both(isCuritiba ? 'cidade.curitiba' : 'cidade.outra');
  if (isCuritiba && city !== 'curitiba') both('cidade.curitiba_grafia_variante');
  if (isCuritiba && zip.length === 8 && !(Number(zip.slice(0, 5)) >= 80000 && Number(zip.slice(0, 5)) <= 82999)) both('cep_x_cidade.curitiba_com_cep_de_fora');
  const addr = str(p.Address);
  const addrNumber = /\d/.test(addr) || /\bs\s*\/?\s*n\b/i.test(addr);
  if (!addr) both('endereco.vazio');
  else both(addrNumber ? 'endereco.com_numero' : 'endereco.sem_numero');
  const fullAddress = addr && addrNumber && str(p.District) && city && uf && uf !== 'invalida' && zipClass === 'valido';
  both(fullAddress ? 'endereco_completo.sim' : 'endereco_completo.nao');
  const addressForControlled = addr && addrNumber && city;
  both(addressForControlled ? 'endereco_rua_numero_cidade.sim' : 'endereco_rua_numero_cidade.nao');

  // --- Sex, birth date, name
  const sex = str(p.Sex).toUpperCase();
  both(`sexo.${sex === 'F' ? 'F' : sex === 'M' ? 'M' : sex ? 'outro' : 'vazio'}`);
  const docs = doctorsOf.get(p.PCod) ?? new Set();
  if (docs.size > 1) both('prontuarios.mais_de_um_medico'); // same registration copied into several charts
  if (!sex) both(docs.has(9) ? 'sexo_vazio.com_urologista' : 'sexo_vazio.so_ginecologia');
  const birth = iso(p.BirthDate);
  both(birth ? 'nascimento.presente' : 'nascimento.vazio');
  if (/\d/.test(str(p.Name))) both('nome.com_numeros_ou_anotacoes');

  // --- E-mail against Cortex's rule
  const email = str(p.EMail);
  both(!email ? 'email.vazio' : EMAIL_RE.test(email) ? 'email.valido' : 'email.recusado_pela_regra_cortex');

  // --- Readiness per document (requirements and sources in the report)
  const hasSex = sex === 'F' || sex === 'M';
  if (addressForControlled) both('pronto.receita_comum_nome_endereco'); // Lei 5.991/73 art. 35 II
  if (birth && hasSex) both('pronto.antimicrobiano_nome_idade_sexo'); // RDC 471/2021
  if (cpf) both('pronto.controle_especial_nome_cpf'); // Portaria 344/98 as amended by RDC 1.000/2025
  const mother = str(p.Mother);
  const homeBorn = str(p.HomeBorn);
  both(mother ? 'prontuario.nome_da_mae.presente' : 'prontuario.nome_da_mae.vazio');
  both(homeBorn ? 'prontuario.naturalidade.presente' : 'prontuario.naturalidade.vazia');
  // CFM 1.638/2002 art. 5 I a: name, birth date, sex, mother, place of birth, full address with CEP.
  if (birth && hasSex && mother && homeBorn && fullAddress) both('pronto.identificacao_prontuario_cfm_1638');
  if (cpf && birth && hasSex && best === 'com_ddd' && fullAddress) both('pronto.cadastro_completo');
  if (cpf && birth && hasSex && (best === 'com_ddd' || best === 'falta_ddd') && fullAddress) both('pronto.cadastro_completo_se_ddd_41_for_aceito');
  // After the automatic fixes: UF taken from the CEP or from "Curitiba", DDD 41
  // added only for patients who live in the 41 area.
  const ufAuto = (uf && uf !== 'invalida') || cepUf || /^(curitiba|ctba|cwb)$/.test(city);
  const addrAuto = addr && addrNumber && str(p.District) && city && ufAuto && zipClass === 'valido';
  const z5 = Number(zip.slice(0, 5));
  const lives41 = (zip.length === 8 && z5 >= 80000 && z5 <= 83999) || isCuritiba;
  const phoneAuto = best === 'com_ddd' || ((best === 'falta_ddd' || best === 'falta_ddd_e_nono_digito') && lives41);
  const gaps = { cpf: !cpf, nascimento: !birth, sexo: !hasSex, telefone: !phoneAuto, endereco: !addrAuto };
  for (const [k, v] of Object.entries(gaps)) if (v) both(`apos_correcao_automatica.falta.${k}`);
  const missing = Object.values(gaps).filter(Boolean).length;
  both(`apos_correcao_automatica.itens_faltando.${missing}`);
  if (missing && futureAppt.has(p.PCod)) both('apos_correcao_automatica.incompletos_com_consulta_marcada');
  if (!addrAuto && addr && addrNumber && city) both('apos_correcao_automatica.endereco_so_falta_cep_ou_bairro');
}

// What the e-mail field holds when it is not an e-mail. Values are printed
// only when shared by at least 50 patients (categories, never a person).
const carrierNames = new Set();
for (const r of rows(px('Carrier'), ['Name', 'Description'])) {
  carrierNames.add(norm(str(r.Name)));
  carrierNames.add(norm(str(r.Description)));
}
const emailUse = new Map();
const emailValues = new Map();
for (const p of rows(mdf.table('Clini_01'), ['EMail', 'Occupation', 'IndicatedBy', 'HomeBorn', 'City', 'Mother', 'Father'])) {
  if (classify(p.EMail) !== 'texto') continue;
  const e = norm(str(p.EMail));
  inc(emailValues, e);
  const same = (v) => norm(str(v)) === e;
  const carrier = carrierNames.has(e) || [...carrierNames].some((cn) => cn.length >= 4 && e.length >= 4 && (cn.includes(e) || e.includes(cn)));
  inc(emailUse, carrier ? 'parece_convenio' : same(p.Occupation) ? 'igual_a_profissao' : same(p.IndicatedBy) ? 'igual_a_indicado_por' : same(p.HomeBorn) ? 'igual_a_naturalidade' : same(p.City) ? 'igual_a_cidade' : same(p.Mother) || same(p.Father) ? 'igual_a_pai_ou_mae' : 'outro');
}
out.campoEmailSemArroba = {
  usos: sorted(emailUse),
  valoresDistintos: emailValues.size,
  categoriasComMaisDe50: Object.fromEntries([...emailValues.entries()].filter(([, n]) => n >= 50).sort((a, b) => b[1] - a[1])),
};

// CPF shared by more than one registration
const dup = { grupos: 0, cadastros: 0, mesmo_nome_e_nascimento: 0, nomes_diferentes: 0, grupos_com_ativo: 0 };
for (const owners of cpfOwners.values()) {
  if (owners.length < 2) continue;
  dup.grupos += 1;
  dup.cadastros += owners.length;
  if (owners.some((o) => o.active)) dup.grupos_com_ativo += 1;
  const sameNameBirth = new Set(owners.map((o) => `${o.name}|${o.birth}`)).size === 1;
  if (sameNameBirth) dup.mesmo_nome_e_nascimento += 1;
  else if (new Set(owners.map((o) => o.name)).size > 1) dup.nomes_diferentes += 1;
}

out.registro = Object.fromEntries(Object.entries(counters).map(([k, m]) => [k, Object.fromEntries([...m.entries()].sort())]));
out.cpfCompartilhado = dup;
out.faxPorEpoca = Object.fromEntries([...byEra.entries()].sort().map(([e, m]) => [e, sorted(m)]));

// ---------------------------------------------------------------------------
// Health plans (Clini_05)

// Carrier names are companies (health plans), not people.
const carrierName = new Map();
for (const r of rows(px('Carrier'), ['CarrierCod', 'Name', 'IsPrivate'])) carrierName.set(r.CarrierCod, `${str(r.Name)}${r.IsPrivate ? ' [particular]' : ''}`);
const plans = new Map(); // PCod -> Set(carrier)
let cardsWithNumber = 0;
const cardsPerCarrier = new Map();
for (const r of rows(px('Clini_05'), ['PCod', 'CarrierCod', 'Registration'])) {
  if (!plans.has(r.PCod)) plans.set(r.PCod, new Set());
  plans.get(r.PCod).add(r.CarrierCod);
  if (str(r.Registration)) cardsWithNumber += 1;
  inc(cardsPerCarrier, carrierName.get(r.CarrierCod) ?? `#${r.CarrierCod}`);
}
const planCount = new Map();
const combos = new Map();
for (const s of plans.values()) {
  inc(planCount, s.size >= 3 ? '3+' : String(s.size));
  inc(combos, [...s].sort((a, b) => a - b).map((k) => carrierName.get(k) ?? k).join(' + '));
}
out.convenios = {
  pacientesComCarteira: plans.size,
  carteirasComNumero: cardsWithNumber,
  conveniosPorPaciente: sorted(planCount),
  carteirasPorConvenio: sorted(cardsPerCarrier),
  combinacoesMaisComuns: Object.fromEntries([...combos.entries()].filter(([, n]) => n >= 50).sort((a, b) => b[1] - a[1]).slice(0, 8)),
};

// ---------------------------------------------------------------------------
// Prescription templates (Us05, Gintxt, Pedtxt)

const ROUTES = /\buso (oral|topico|vaginal|externo|ext|interno|int|intramuscular|im|endovenoso|intravenoso|subcutaneo|sublingual|retal|nasal|oftalmico|otologico|local|continuo|cont)\b/;
const POSOLOGY = /(\d+\s*\/\s*\d+\s*h|de\s+\d+\s+em\s+\d+\s+horas|\d+\s*x\s*(ao|por)\s*dia|vezes ao dia|ao dia|por dia|a noite|ao deitar|em jejum|dose unica|tome|tomar|aplicar|aplique|usar|use)/;
const QUANTITY = /\b(caixa|caixas|cx|comprimidos?|cps?|capsulas?|frasco|frascos|tubo|tubos|ampolas?|bisnaga|envelopes?|unidades?)\b/;
// PersonalMed fills these at print time (@nome, @endereco, @data ...). The
// look-behind skips e-mail addresses typed into template text.
const MERGE_FIELD = /(?<![A-Za-z0-9._%+-])@[a-z_]+/gi;
const templates = [];
for (const t of ['Us05', 'Gintxt', 'Pedtxt']) {
  for (const r of rows(px(t), ['UserNumber', 'ModelNumber', 'ModelName', 'ModelType', 'Contents'], 'text')) {
    const raw = typeof r.Contents === 'string' ? r.Contents : '';
    const text = plain(raw);
    // Fixed text between merge fields, normalised; used to recognise the template in issued documents.
    // Line by line, so a single edited dose does not hide the whole template.
    const chunks = text.split(MERGE_FIELD).flatMap((s) => s.split(/\n+/)).map(norm).filter((s) => s.length >= 8);
    templates.push({ table: t, type: r.ModelType, name: str(r.ModelName), raw, text, chunks, fields: new Set((text.match(MERGE_FIELD) ?? []).map((m) => m.toLowerCase())) });
  }
}
const tpl = { porTabelaETipo: new Map(), nomesCom20Caracteres: 0, nomesRepetidos: 0, camposAutomaticos: {} };
const feat = new Map();
const names = new Map();
const mergeByType = new Map(); // type -> Map(field -> templates)
const itemsPerRx = [];
for (const t of templates) {
  inc(tpl.porTabelaETipo, `${t.table}.tipo${t.type}`);
  if (t.name.length === 20) tpl.nomesCom20Caracteres += 1;
  inc(names, norm(t.name));
  const typeKey = `tipo${t.type}`;
  if (!mergeByType.has(typeKey)) mergeByType.set(typeKey, new Map());
  for (const m of t.fields) inc(mergeByType.get(typeKey), m);
  if (t.table !== 'Us05' || t.type !== 1) continue;
  const f = (k) => inc(feat, k);
  const n = norm(t.text);
  f('receitas');
  if (antimicrobialsIn(t.text).length) f('cita_antimicrobiano');
  if (controlledSubstancesIn(t.text).length) f('cita_controlado');
  if (ROUTES.test(n)) f('tem_cabecalho_de_uso_int_ext_cont');
  if (POSOLOGY.test(n)) f('tem_instrucao_de_uso');
  if (QUANTITY.test(n)) f('tem_quantidade');
  if (/_{3,}/.test(t.text)) f('tem_linha_ate_quantidade');
  if (t.fields.has('@endereco') || t.fields.has('@bairro') || t.fields.has('@cidade') || t.fields.has('@cep')) f('imprime_endereco_do_paciente');
  if (/\\b\b|\\b\d/.test(t.raw)) f('rtf_negrito');
  if (/\\ul\b/.test(t.raw)) f('rtf_sublinhado');
  if (/\\trowd/.test(t.raw)) f('rtf_tabela');
  const items = (t.text.match(/^\s*(?:[-•*]|\d{1,2}\s*[).\-–])\s*\S/gm) ?? []).length;
  itemsPerRx.push(items);
  f(items === 0 ? 'itens.0' : items === 1 ? 'itens.1' : items <= 3 ? 'itens.2-3' : 'itens.4+');
}
tpl.nomesRepetidos = [...names.values()].filter((n) => n > 1).reduce((s, n) => s + n, 0);
tpl.porTabelaETipo = Object.fromEntries(tpl.porTabelaETipo);
// Fields used by a single template are left out: they can be a social-media handle typed into the text.
tpl.camposAutomaticos = Object.fromEntries([...mergeByType.entries()].map(([k, m]) => [k, sorted(new Map([...m].filter(([, n]) => n >= 2)))]));
tpl.receitas = Object.fromEntries([...feat.entries()].sort());
itemsPerRx.sort((a, b) => a - b);
tpl.receitas.itens_mediana = itemsPerRx[Math.floor(itemsPerRx.length / 2)] ?? 0;
out.modelos = tpl;

// ---------------------------------------------------------------------------
// Issued prescriptions: template reuse and regulated drugs

// A template is "used" when every fixed chunk of it appears in the issued text.
const rxTemplates = templates.filter((t) => t.table === 'Us05' && t.type === 1 && t.chunks.length && t.chunks.join('').length >= 40);
const recent = issued.filter((r) => r.date && r.date >= ACTIVE_FROM);
const use = { emitidas_periodo: recent.length, sem_alteracao: 0, modelo_com_acrescimos: 0, mais_de_um_modelo: 0, modelo_editado_80: 0, modelo_editado_50: 0, sem_modelo_reconhecido: 0, modelos_usados: 0, antimicrobiano: 0, controlado: 0 };
const usedTemplates = new Map();
const perDoctor = new Map(); // UserNumber -> { emitidas, com_modelo }
const substances = { controlado: new Map(), antimicrobiano: new Map() };
for (const r of recent) {
  if (antimicrobialsIn(r.text).length) use.antimicrobiano += 1;
  if (controlledSubstancesIn(r.text).length) use.controlado += 1;
  for (const s of new Set(controlledSubstancesIn(r.text))) inc(substances.controlado, s);
  for (const s of new Set(antimicrobialsIn(r.text))) inc(substances.antimicrobiano, s);
  const doc = perDoctor.get(r.user) ?? { emitidas: 0, com_modelo: 0 };
  doc.emitidas += 1;
  perDoctor.set(r.user, doc);
  const hits = rxTemplates.filter((t) => t.chunks.every((ch) => r.text.includes(ch)));
  if (!hits.length) {
    // Edited template: share of the best template's fixed text still present.
    let best = 0;
    for (const t of rxTemplates) {
      const total = t.chunks.reduce((s, ch) => s + ch.length, 0);
      const kept = t.chunks.reduce((s, ch) => s + (r.text.includes(ch) ? ch.length : 0), 0);
      if (kept / total > best) best = kept / total;
    }
    if (best >= 0.8) use.modelo_editado_80 += 1;
    else if (best >= 0.5) use.modelo_editado_50 += 1;
    else use.sem_modelo_reconhecido += 1;
    if (best >= 0.5) doc.com_modelo += 1;
    continue;
  }
  doc.com_modelo += 1;
  for (const h of hits) inc(usedTemplates, h);
  if (hits.length > 1) {
    use.mais_de_um_modelo += 1;
    continue;
  }
  // What is left after removing the template's fixed text: patient name, address, date ...
  let rest = r.text;
  for (const ch of hits[0].chunks) rest = rest.replace(ch, ' ');
  const leftover = rest.split(/\s+/).filter(Boolean).length;
  if (leftover <= 25) use.sem_alteracao += 1;
  else use.modelo_com_acrescimos += 1;
}
use.modelos_usados = usedTemplates.size;
const usage = [...usedTemplates.values()].sort((a, b) => b - a);
const topShare = (k) => usage.slice(0, k).reduce((s, n) => s + n, 0);
const totalHits = usage.reduce((s, n) => s + n, 0);
use.concentracao = { usos_reconhecidos: totalHits, top10: topShare(10), top50: topShare(50), top100: topShare(100), modelos_nunca_usados_no_periodo: rxTemplates.length - usage.length };
use.porMedico = Object.fromEntries([...perDoctor.entries()].sort((a, b) => a[0] - b[0]));
use.substancias = { controlado: sorted(substances.controlado), antimicrobiano: sorted(substances.antimicrobiano) };
let allAnti = 0;
let allCtrl = 0;
for (const r of issued) {
  if (antimicrobialsIn(r.text).length) allAnti += 1;
  if (controlledSubstancesIn(r.text).length) allCtrl += 1;
}
out.receitasEmitidas = { porAno: Object.fromEntries([...issuedByYear.entries()].sort()), periodo: use, todas: { total: issued.length, antimicrobiano: allAnti, controlado: allCtrl } };

// ---------------------------------------------------------------------------

const json = JSON.stringify(out, null, 2);
if (opt('--json')) writeFileSync(opt('--json'), json);
console.log(json);
