import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const client = useQueryClient();
  const field = useId();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ContactOption | null>(contact ?? null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [doctor, setDoctor] = useState('');
  const [kind, setKind] = useState<keyof typeof kinds>('scheduling');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const contactRequest = useRequestId();
  const caseRequest = useRequestId();
  const guard = useUnsavedChanges(
    !!(name || phone || subject),
    'Há um atendimento não salvo. Deseja sair e descartar o preenchimento?',
  );
  const results = useQuery({
    queryKey: ['reception', access?.actorId, 'contacts', access?.clinic?.id, search],
    queryFn: () => receptionApi.contacts(access!.clinic!.id, search),
    enabled: !!access?.clinic && mode === 'existing' && !selected && search.trim().length >= 2,
    retry: false,
  });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !access?.clinic) return;
    setBusy(true);
    setError(null);
    try {
      let target = selected;
      if (!target) {
        if (mode !== 'new') throw new Error('Selecione um contato antes de continuar.');
        const payload = { name: name.trim(), phone: phone.trim() };
        const id = await receptionApi.createContact(
          access.clinic.id,
          payload.name,
          payload.phone,
          contactRequest(payload),
        );
        target = { id, ...payload };
        setSelected(target);
      }
      const payload = { contact: target.id, doctor: doctor || null, subject: subject.trim(), kind };
      const id = await receptionApi.createCase(target.id, payload.doctor, payload.subject, kind, caseRequest(payload));
      await client.invalidateQueries({ queryKey: ['reception'] });
      onCreated(id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
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
                  <div className="space-y-2">
                    <Label htmlFor={field + 'search'}>Buscar contato por nome ou telefone</Label>
                    <Input
                      id={field + 'search'}
                      value={search}
                      maxLength={200}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <ReceptionNotice
                      loading={results.isFetching}
                      error={results.error}
                      onRetry={() => void results.refetch()}
                    />
                    {search.trim().length < 2 ? (
                      <p className="text-xs text-muted-foreground">Digite ao menos dois caracteres.</p>
                    ) : (
                      results.data?.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="block w-full rounded-lg border p-3 text-left hover:bg-muted text-sm"
                          onClick={() => setSelected(item)}
                        >
                          <span className="font-medium">{item.name}</span>
                          <span className="block text-xs text-muted-foreground">{item.phone || 'Sem telefone'}</span>
                        </button>
                      ))
                    )}
                    {results.data?.items.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Nenhum contato encontrado. Você pode cadastrar um novo.
                      </p>
                    )}
                    {results.data?.nextCursor && (
                      <p className="text-xs text-muted-foreground">Refine a busca para localizar o contato.</p>
                    )}
                  </div>
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
