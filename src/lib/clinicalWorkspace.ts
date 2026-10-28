import { formatDateOnly } from '@/lib/dates';
export const WORK_KINDS = {
  draft: 'Consulta manual', task: 'Resultado / encaminhamento / retorno', observation: 'Observação / medida',
  pregnancy: 'Episódio gestacional', medication: 'Reconciliação de medicamento', instruction: 'Orientações ao paciente', intake: 'Informações pré-consulta',
} as const;
export type WorkKind = keyof typeof WORK_KINDS;
export const ENCOUNTER_TEMPLATES: Record<string, string> = {
  livre: '',
  ginecologia: 'S — Queixa, história e contexto ginecológico:\n\nO — Exame e resultados efetivamente observados:\n\nA — Avaliação do médico:\n\nP — Plano acordado e acompanhamento:\n',
  prenatal: 'S — Queixas e evolução referidas:\n\nDatação confirmada e fonte:\n\nO — Medidas, exame e resultados disponíveis:\n\nA — Avaliação obstétrica do médico:\n\nP — Plano e próximo acompanhamento:\n',
  urologia: 'S — Queixa e história urológica:\n\nO — Exame e resultados disponíveis:\n\nA — Avaliação do médico:\n\nP — Plano e acompanhamento:\n',
};
export function validateWorkItem(kind: WorkKind, title: string, content: string, details: Record<string,string>): string | null {
  if (!title.trim() || title.trim().length>200) return 'Informe um título de até 200 caracteres.';
  if (['observation','pregnancy','medication'].includes(kind) && (!details.date || formatDateOnly(details.date)==='Data inválida')) return 'Informe uma data clínica válida.';
  if (kind==='medication' && details.state!=='stopped' && !details.dosage?.trim()) return 'Informe a dose revisada do medicamento.';
  if (kind==='medication' && !['active','changed','stopped'].includes(details.state)) return 'Selecione o estado do medicamento.';
  if (content.length>100000) return 'O texto excede o limite de 100.000 caracteres.';
  if (kind==='observation' && (!details.value?.trim() || !Number.isFinite(Number(details.value)) || !details.unit?.trim() || !details.date)) return 'Informe valor numérico, unidade e data da observação.';
  if (kind==='pregnancy' && (!details.date || !details.source?.trim())) return 'Informe a data provável do parto confirmada pelo médico e sua fonte.';
  if (['draft','instruction','intake','medication'].includes(kind) && !content.trim()) return 'Preencha o conteúdo antes de salvar.';
  return null;
}
