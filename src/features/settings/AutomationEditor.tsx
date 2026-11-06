import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  APPOINTMENT_TYPES, PARAM_LABELS, previewBody,
  type Automation, type AutomationParam, type AutomationRule, type ParamSource, type WhatsAppTemplate,
} from './whatsappApi';

type Unit = 'min' | 'h' | 'd';
const UNIT_MINUTES: Record<Unit, number> = { min: 1, h: 60, d: 1440 };
const splitOffset = (minutes: number): { amount: number; unit: Unit } =>
  minutes > 0 && minutes % 1440 === 0 && minutes >= 4320 ? { amount: minutes / 1440, unit: 'd' }
    : minutes % 60 === 0 ? { amount: minutes / 60, unit: 'h' } : { amount: minutes, unit: 'min' };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: WhatsAppTemplate[];
  doctors: Array<{ id: string; name: string }>;
  initial: Automation | null;
  preset: Partial<AutomationRule> | null;
  saving: boolean;
  error: string;
  onSave: (rule: AutomationRule) => void;
}

export function AutomationEditor({ open, onOpenChange, templates, doctors, initial, preset, saving, error, onSave }: Props) {
  const approved = useMemo(() => templates.filter((t) => t.status === 'APPROVED'), [templates]);
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [trigger, setTrigger] = useState<Automation['trigger']>('before_start');
  const [amount, setAmount] = useState(48);
  const [unit, setUnit] = useState<Unit>('h');
  const [templateKey, setTemplateKey] = useState('');
  const [params, setParams] = useState<AutomationParam[]>([]);
  const [linkUrl, setLinkUrl] = useState('');
  const [allDoctors, setAllDoctors] = useState(true);
  const [doctorIds, setDoctorIds] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) return;
    const base = initial ?? { ...preset };
    setName(base.name ?? '');
    setEnabled(initial ? initial.enabled : true);
    setTrigger(base.trigger ?? 'before_start');
    const split = splitOffset(base.offsetMinutes ?? 2880);
    setAmount(split.amount);
    setUnit(split.unit);
    setTemplateKey(initial ? `${initial.templateName}|${initial.templateLanguage}` : '');
    setParams(initial?.params ?? []);
    setLinkUrl(initial?.linkUrl ?? '');
    setAllDoctors(!initial?.doctorIds?.length);
    setDoctorIds(initial?.doctorIds ?? []);
    setTypes(initial?.appointmentTypes ?? []);
    setLocalError('');
  }, [open, initial, preset]);

  const template = templates.find((t) => `${t.name}|${t.language}` === templateKey);
  useEffect(() => {
    if (!template) return;
    setParams((current) => Array.from({ length: template.paramCount }, (_, i) => current[i] ?? { source: i === 0 ? 'paciente_primeiro_nome' : 'data' }));
  }, [template]);

  const usesLink = params.some((p) => p.source === 'link');
  const submit = () => {
    const offsetMinutes = Math.round(amount * UNIT_MINUTES[unit]);
    if (name.trim().length < 2) return setLocalError('Dê um nome à automação.');
    if (!template) return setLocalError('Escolha o modelo de mensagem.');
    if (!Number.isFinite(offsetMinutes) || offsetMinutes < 0 || offsetMinutes > 20160) return setLocalError('O prazo vai de 0 a 14 dias.');
    if (usesLink && !/^https:\/\/\S+$/.test(linkUrl.trim())) return setLocalError('Informe um link que comece com https://.');
    if (params.some((p) => p.source === 'texto' && !p.text?.trim())) return setLocalError('Preencha os textos fixos.');
    if (!allDoctors && !doctorIds.length) return setLocalError('Escolha pelo menos um médico ou marque "Todos".');
    setLocalError('');
    onSave({
      name: name.trim(), enabled, trigger, offsetMinutes, templateName: template.name, templateLanguage: template.language,
      params, linkUrl: usesLink ? linkUrl.trim() : null, doctorIds: allDoctors ? null : doctorIds, appointmentTypes: types.length ? types : null,
    });
  };

  const setParam = (index: number, patch: Partial<AutomationParam>) =>
    setParams((list) => list.map((p, i) => (i === index ? { ...p, ...patch, ...(patch.source && patch.source !== 'texto' ? { text: undefined } : {}) } : p)));

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Editar automação' : 'Nova automação'}</DialogTitle>
          <DialogDescription>Envia um modelo aprovado do WhatsApp a cada consulta que atender às condições.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="automation-name">Nome</Label>
            <Input id="automation-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Lembrete 48 h antes" />
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Quando enviar</legend>
            <div className="grid grid-cols-[5.5rem_7rem_1fr] gap-2">
              <Input aria-label="Quantidade" type="number" min={0} max={unit === 'd' ? 14 : unit === 'h' ? 336 : 20160} value={amount}
                onChange={(e) => setAmount(Number(e.target.value))} />
              <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
                <SelectTrigger aria-label="Unidade"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="min">minutos</SelectItem>
                  <SelectItem value="h">horas</SelectItem>
                  <SelectItem value="d">dias</SelectItem>
                </SelectContent>
              </Select>
              <Select value={trigger} onValueChange={(v) => setTrigger(v as Automation['trigger'])}>
                <SelectTrigger aria-label="Referência"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="before_start">antes do início</SelectItem>
                  <SelectItem value="after_end">depois do fim</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {trigger === 'before_start'
                ? 'Só para consultas agendadas ou confirmadas. Nada sai entre 20h e 8h: a mensagem espera o horário.'
                : 'Só para consultas marcadas como realizadas. Nada sai entre 20h e 8h.'}
            </p>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="automation-template">Modelo de mensagem</Label>
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger id="automation-template"><SelectValue placeholder={approved.length ? 'Escolha um modelo aprovado' : 'Nenhum modelo aprovado'} /></SelectTrigger>
              <SelectContent>
                {approved.map((t) => (
                  <SelectItem key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Os modelos são criados e aprovados no WhatsApp Manager da Meta. Use texto neutro: a política do WhatsApp não permite
              enviar ou pedir informações de saúde pelo canal.
            </p>
          </div>

          {template && params.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Campos do modelo</legend>
              {params.map((p, i) => (
                <div key={i} className="grid grid-cols-[3rem_1fr] items-start gap-2">
                  <span className="pt-2 text-sm font-mono text-muted-foreground">{`{{${i + 1}}}`}</span>
                  <div className="space-y-1.5">
                    <Select value={p.source} onValueChange={(v) => setParam(i, { source: v as ParamSource })}>
                      <SelectTrigger aria-label={`Origem do campo ${i + 1}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PARAM_LABELS) as ParamSource[]).map((s) => <SelectItem key={s} value={s}>{PARAM_LABELS[s]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {p.source === 'texto' && (
                      <Input aria-label={`Texto do campo ${i + 1}`} maxLength={200} value={p.text ?? ''} onChange={(e) => setParam(i, { text: e.target.value })} />
                    )}
                  </div>
                </div>
              ))}
            </fieldset>
          )}

          {usesLink && (
            <div className="space-y-1.5">
              <Label htmlFor="automation-link">Link</Label>
              <Input id="automation-link" type="url" inputMode="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" />
              <p className="text-xs text-muted-foreground">Por exemplo, o formulário de pré-consulta ou as orientações de preparo.</p>
            </div>
          )}

          {template && (
            <div className="rounded-lg bg-[#e7f6ee] px-3 py-2.5 text-sm whitespace-pre-wrap text-foreground" aria-label="Prévia da mensagem">
              {previewBody(template, params, linkUrl.trim() || null)}
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Para quais consultas</legend>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allDoctors} onCheckedChange={(v) => setAllDoctors(v === true)} /> Todos os médicos
            </label>
            {!allDoctors && (
              <div className="grid gap-1.5 pl-6 sm:grid-cols-2">
                {doctors.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={doctorIds.includes(d.id)}
                      onCheckedChange={(v) => setDoctorIds((ids) => (v === true ? [...ids, d.id] : ids.filter((x) => x !== d.id)))} />
                    {d.name}
                  </label>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
              {Object.entries(APPOINTMENT_TYPES).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={types.includes(value)}
                    onCheckedChange={(v) => setTypes((list) => (v === true ? [...list, value] : list.filter((x) => x !== value)))} />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Sem tipo marcado, vale para todos os tipos de consulta.</p>
          </fieldset>

          <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <span>
              <span className="font-medium">Ativa</span>
              <span className="block text-xs text-muted-foreground">Desativada, a regra fica salva sem enviar.</span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Automação ativa" />
          </label>

          {(localError || error) && <p role="alert" className="text-sm text-destructive">{localError || error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Salvando…' : 'Salvar automação'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
