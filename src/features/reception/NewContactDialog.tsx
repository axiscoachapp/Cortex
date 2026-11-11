import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dialogLayout } from './dialogLayout';
import { FormError } from './FormError';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { useRequestId } from './useRequestId';

/** A phone the front desk can call back: DDD + number (10 or 11 digits), optionally with 55 in front. Empty is allowed. */
function phoneProblem(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!phone.trim()) return null;
  if (/[^\d\s()+.-]/.test(phone) || !(digits.length >= 10 && digits.length <= 13)) return 'Informe DDD + número, por exemplo (41) 99999-0000.';
  return null;
}

export function NewContactDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (contact: { id: string; name: string; phone: string }) => void }) {
  const access = useClinicAccess();
  const client = useQueryClient();
  const request = useRequestId();
  const field = useId();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const nameProblem = name.trim().length < 2 ? 'Informe o nome do contato (ao menos 2 letras).' : null;
  const problem = phoneProblem(phone);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (busy || nameProblem || problem || !access?.clinic) return;
    setBusy(true);
    setError(null);
    const payload = { name: name.trim(), phone: phone.trim() };
    try {
      const id = await receptionApi.createContact(access.clinic.id, payload.name, payload.phone, request({ clinic: access.clinic.id, ...payload }));
      request.reset();
      await client.invalidateQueries({ queryKey: ['reception', access.actorId, 'contacts'] });
      if (mounted.current) onCreated({ id, ...payload });
    } catch (failure) {
      if (mounted.current) setError(failure);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className={`max-w-lg ${dialogLayout.content}`}>
      <DialogHeader className={dialogLayout.header}>
        <DialogTitle>Novo contato</DialogTitle>
        <DialogDescription>Quem entrou em contato com a clínica. O prontuário continua separado, com cada médico.</DialogDescription>
      </DialogHeader>
      <form noValidate onSubmit={save} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={busy} className={dialogLayout.body}>
          <div className="space-y-2">
            <Label htmlFor={field + 'name'}>Nome</Label>
            <Input id={field + 'name'} className="h-11" value={name} maxLength={200} autoComplete="off" onChange={event => setName(event.target.value)}
              aria-invalid={touched && !!nameProblem} aria-describedby={touched && nameProblem ? field + 'name-error' : undefined} />
            {touched && nameProblem && <p id={field + 'name-error'} className="text-sm text-destructive">{nameProblem}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor={field + 'phone'}>Telefone com DDD (opcional)</Label>
            <Input id={field + 'phone'} className="h-11" type="tel" inputMode="tel" value={phone} maxLength={40} autoComplete="off" placeholder="(41) 99999-0000"
              onChange={event => setPhone(event.target.value)} onBlur={() => { if (phone.trim()) setTouched(true); }}
              aria-invalid={touched && !!problem} aria-describedby={touched && problem ? field + 'phone-error' : undefined} />
            {touched && problem && <p id={field + 'phone-error'} className="text-sm text-destructive">{problem}</p>}
          </div>
        </fieldset>
        <div className={dialogLayout.footer}>
          <FormError error={error} />
          <div className={dialogLayout.actions}>
            <Button type="button" variant="outline" className={dialogLayout.button} disabled={busy} onClick={onClose}>Cancelar</Button>
            <Button type="submit" className={dialogLayout.button} disabled={busy}>{busy ? 'Salvando…' : 'Salvar contato'}</Button>
          </div>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
