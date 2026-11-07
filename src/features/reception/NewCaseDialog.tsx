import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { receptionApi } from './api';
import { useClinicAccess } from './accessContext';
import { kinds } from './contracts';
import { useRequestId } from './useRequestId';
import { ReceptionNotice } from './ReceptionNotice';
import { ContactSearch } from './ContactSearch';
import { useAuth } from '@/contexts/AuthContext';
import { useSessionHidden } from '@/contexts/SessionVisibility';

export interface ContactOption {
  id: string;
  name: string;
  phone: string;
}
export function NewCaseDialog({
  contact,
  onClose,
  onCreated,
}: {
  contact?: ContactOption;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const access = useClinicAccess();
  const { user } = useAuth();
  const hidden = useSessionHidden();
  const client = useQueryClient();
  const field = useId();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selected, setSelected] = useState<ContactOption | null>(contact ?? null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [doctor, setDoctor] = useState('');
  const [kind, setKind] = useState<keyof typeof kinds>('scheduling');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const scope = user && access?.clinic && user.id === access.actorId
    ? user.id + ':' + access.clinic.id + ':' + (access.admin ? 'admin' : access.kind) : null;
  const initialScope = useRef(scope), invalidated = useRef(false);
  const mounted = useRef(false), current = useRef(false), pending = useRef(false), started = useRef(false);
  const validContext = !!scope && scope === initialScope.current && !!access?.active && !hidden
    && (access.admin || access.kind === 'reception') && (!doctor || access.doctors.some(item => item.id === doctor));
  const blocked = invalidated.current || !validContext;
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (!validContext) invalidated.current = true;
    current.current = !blocked;
  }, [validContext, blocked]);
  const mayContinue = () => mounted.current && current.current && !invalidated.current;
  const contactRequest = useRequestId();
  const caseRequest = useRequestId();
  const guard = useUnsavedChanges(
    !blocked && !!(name || phone || subject || (selected && !contact) || doctor || kind !== 'scheduling'),
    busy ? 'Há um atendimento em envio. Aguarde o resultado antes de sair.' : 'Há um atendimento não salvo. Deseja sair e descartar o preenchimento?',
    { blocking: busy && !blocked },
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || busy || !access?.clinic || !mayContinue()) return;
    pending.current = true;
    const origin = { actor: access.actorId, clinic: access.clinic.id };
    const snapshot = { selected, mode, name: name.trim(), phone: phone.trim(), subject: subject.trim(), doctor: doctor || null, kind };
    setBusy(true);
    setError(null);
    try {
      let target = snapshot.selected;
      if (!target) {
        if (snapshot.mode !== 'new') throw new Error('Selecione um contato antes de continuar.');
        const payload = { name: snapshot.name, phone: snapshot.phone };
        if (!mayContinue()) return;
        started.current = true;
        const id = await receptionApi.createContact(
          origin.clinic,
          payload.name,
          payload.phone,
          contactRequest(payload),
        );
        if (!mayContinue()) return;
        target = { id, ...payload };
        setSelected(target);
      }
      if (!mayContinue()) return;
      const payload = { contact: target.id, doctor: snapshot.doctor, subject: snapshot.subject, kind: snapshot.kind };
      started.current = true;
      const id = await receptionApi.createCase(target.id, payload.doctor, payload.subject, payload.kind, caseRequest(payload));
      if (!mayContinue()) return;
      await client.invalidateQueries({
        queryKey: ['reception', origin.actor],
        predicate: query => (query.queryKey[2] === 'queue' || query.queryKey[2] === 'contacts') && query.queryKey[3] === origin.clinic,
      });
      if (!mayContinue()) return;
      onCreated(id);
    } catch (err) {
      if (mayContinue()) setError(err);
    } finally {
      pending.current = false;
      if (mayContinue()) setBusy(false);
    }
  }
  if (blocked) return <Dialog open={!hidden} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>Novo atendimento</DialogTitle></DialogHeader>
      <div role="alert" className="space-y-3 text-sm">
        <p>A verificação deste atendimento foi interrompida. Feche esta janela e confira os contatos e a fila antes de abrir outro atendimento.</p>
        {started.current && <p>Uma solicitação enviada antes da mudança pode ter sido concluída.</p>}
        <p>Fechar esta janela descarta o preenchimento.</p>
      </div>
      <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={onClose}>Fechar atendimento</Button>
    </DialogContent>
  </Dialog>;
  return (
    <Dialog
      open={!hidden}
      onOpenChange={(open) => {
        if (!open && !busy && guard(false)) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo atendimento</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Identifique quem entrou em contato. Um número pode pertencer a uma família; o paciente será confirmado antes
          de agendar.
        </p>
        <ReceptionNotice error={error} />
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            {selected ? (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="font-medium">{selected.name}</p>
                <p className="text-muted-foreground">{selected.phone || 'Sem telefone cadastrado'}</p>
              </div>
            ) : (
              <>
                <fieldset className="flex flex-wrap gap-3">
                  <legend className="sr-only">Cadastro do contato</legend>
                  <label className="flex gap-2 text-xs">
                    <input
                      type="radio"
                      name={field + 'mode'}
                      checked={mode === 'existing'}
                      onChange={() => setMode('existing')}
                    />
                    Contato existente
                  </label>
                  <label className="flex gap-2 text-xs">
                    <input
                      type="radio"
                      name={field + 'mode'}
                      checked={mode === 'new'}
                      onChange={() => setMode('new')}
                    />
                    Novo contato
                  </label>
                </fieldset>
                {mode === 'existing' ? (
                  <ContactSearch onSelect={setSelected} />
                ) : (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor={field + 'name'}>Nome de quem entrou em contato</Label>
                      <Input
                        id={field + 'name'}
                        required
                        minLength={2}
                        maxLength={200}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor={field + 'phone'}>Telefone com DDD (opcional)</Label>
                      <Input
                        id={field + 'phone'}
                        type="tel"
                        maxLength={40}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Número brasileiro com DDD; para outro país, informe + e o código.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
            <div>
              <Label htmlFor={field + 'subject'}>Assunto administrativo</Label>
              <Input
                id={field + 'subject'}
                required
                minLength={2}
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex.: solicitar um horário de retorno"
              />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={field + 'kind'}>Tipo de demanda</Label>
                <select
                  id={field + 'kind'}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as keyof typeof kinds)}
                >
                  {Object.entries(kinds).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor={field + 'doctor'}>Médico relacionado</Label>
                <select
                  id={field + 'doctor'}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  value={doctor}
                  onChange={(e) => setDoctor(e.target.value)}
                >
                  <option value="">A definir pela equipe</option>
                  {access?.doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (guard(false)) onClose();
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || (!selected && mode === 'existing')}>
              {busy ? 'Registrando…' : 'Adicionar à fila'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
