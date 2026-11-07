// "Pré-consultas": the week's clinic appointments with the state of their pre-consultation.
// The reception copies links and reviews the registration part; the doctor reads the health part.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Copy, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useClinicAccess } from '@/features/reception/accessContext';
import { answerText } from '../../../supabase/functions/_shared/intakeForm';
import { dateTime, intakeCall, type IntakeListItem, type IntakeResponse } from './intakeApi';

const DAY = 24 * 3600 * 1000;

function stateBadge(i: IntakeListItem) {
  if (i.appointmentStatus === 'cancelado') return <Badge variant="outline">Cancelada</Badge>;
  if (i.state === 'answered' && i.registrationReviewedAt) return <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Conferida</Badge>;
  if (i.state === 'answered') return <Badge className="bg-[#F2B23E]/20 text-[#0E2A33] hover:bg-[#F2B23E]/20">Respondida</Badge>;
  if (i.state === 'pending' && i.openedAt) return <Badge variant="secondary">Aberta, sem resposta</Badge>;
  if (i.state === 'pending') return <Badge variant="secondary">Link criado</Badge>;
  return <Badge variant="outline">Sem link</Badge>;
}

function Answers({ title, items }: { title: string; items: IntakeResponse['registration'] }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Nada respondido nesta parte.</p> : (
        <dl className="divide-y rounded-lg border">
          {items.map((a) => (
            <div key={a.id} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
              <dt className="text-sm text-muted-foreground">{a.label}</dt>
              <dd className="text-sm whitespace-pre-wrap break-words">{answerText(a.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** Answers of one appointment. Health answers come from the server only for the appointment's doctor. */
export function IntakeAnswersDialog({ appointmentId, open, onOpenChange }: { appointmentId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const access = useClinicAccess();
  const queryClient = useQueryClient();
  const scope = [access?.clinic?.id ?? 'none', access?.actorId ?? 'none'];
  const q = useQuery({
    queryKey: ['intake-response', ...scope, appointmentId],
    queryFn: () => intakeCall<{ request: IntakeResponse | null }>('response', { appointmentId }),
    enabled: open && !!appointmentId, staleTime: 0, refetchOnMount: 'always', retry: false,
  });
  const r = q.data?.request ?? null;
  const review = useMutation({
    mutationFn: (part: 'registration' | 'health') => intakeCall('review', { requestId: r!.id, part, revision: r!.revision }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['intake-response', ...scope, appointmentId] });
      void queryClient.invalidateQueries({ queryKey: ['intake-list', ...scope] });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-2xl max-h-[90vh] grid-cols-1 overflow-y-auto overflow-x-hidden [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Respostas da pré-consulta</DialogTitle>
          <DialogDescription>{r?.answeredAt ? `Enviadas em ${dateTime(r.answeredAt)}${r.submissions > 1 ? ` (${r.submissions} envios)` : ''}.` : 'Ainda sem respostas.'}</DialogDescription>
        </DialogHeader>
        {q.isLoading || (q.isFetching && !q.isFetchedAfterMount) ? <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando…</p>
          : q.isError ? (
            <p role="alert" className="text-sm text-destructive">{(q.error as Error).message} <button type="button" className="underline" onClick={() => q.refetch()}>Tentar novamente</button></p>
          ) : !r || r.state !== 'answered' ? <p className="text-sm text-muted-foreground">O paciente ainda não respondeu.</p> : (
            <div className="space-y-5">
              <Answers title="Dados cadastrais e convênio" items={r.registration} />
              <p className="text-sm">
                {/* What the patient ticked in this submission; the effective consent lives in WhatsApp (an earlier SAIR or authorization prevails). */}
                {r.whatsappConsent
                  ? 'O paciente marcou, neste envio, que aceita mensagens pelo WhatsApp. Vale para o celular do cadastro, se ele não pediu para sair antes.'
                  : 'O paciente não marcou a autorização de mensagens neste envio. Uma autorização ou saída registrada antes continua valendo.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {r.registrationReviewedAt ? (
                  <span className="flex items-center gap-1.5 text-sm text-primary"><CheckCircle2 className="h-4 w-4" /> Dados conferidos em {dateTime(r.registrationReviewedAt)}</span>
                ) : (
                  <Button size="sm" className="h-auto min-h-9 whitespace-normal text-left" onClick={() => review.mutate('registration')} disabled={review.isPending}>Marcar dados como conferidos</Button>
                )}
              </div>
              {r.healthVisible ? (
                <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                  <Answers title="Sobre a consulta (só o médico vê)" items={r.health ?? []} />
                  {r.healthReviewedAt ? (
                    <span className="flex items-center gap-1.5 text-sm text-primary"><CheckCircle2 className="h-4 w-4" /> Lidas em {dateTime(r.healthReviewedAt)}</span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => review.mutate('health')} disabled={review.isPending}>Marcar como lidas</Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">As respostas sobre saúde ficam só para o médico da consulta.</p>
              )}
              {review.isError && <p role="alert" className="text-sm text-destructive">{(review.error as Error).message}</p>}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

/** `embedded`: inside the reception layout (/recepcao/...), without its own page frame and back button. */
export default function IntakePage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const access = useClinicAccess();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scope = [access?.clinic?.id ?? 'none', access?.actorId ?? 'none'];
  const [offset, setOffset] = useState(0);
  const range = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = new Date(start.getTime() + offset * 7 * DAY);
    return { from, to: new Date(from.getTime() + 7 * DAY) };
  }, [offset]);
  const state = useQuery({ queryKey: ['intake-state', ...scope], queryFn: () => intakeCall<{ ready: boolean; canEditForm: boolean; enabled: boolean }>('state'), staleTime: 0 });
  const list = useQuery({
    queryKey: ['intake-list', ...scope, range.from.toISOString()],
    queryFn: () => intakeCall<{ items: IntakeListItem[] }>('list', { from: range.from.toISOString(), to: range.to.toISOString() }),
    staleTime: 0, refetchOnMount: 'always', retry: false,
  });
  const [viewing, setViewing] = useState<string | null>(null);
  const [rotating, setRotating] = useState<IntakeListItem | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['intake-list', ...scope] });

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast({ title: 'Link copiado', description: 'Cole na conversa com o paciente.' }); }
    catch { toast({ title: 'Copie o link', description: url }); }
  };
  const link = useMutation({
    mutationFn: (appointmentId: string) => intakeCall<{ url: string }>('link', { appointmentId }),
    onSuccess: (r) => { void copy(r.url); refresh(); },
    onError: (e: Error) => toast({ title: 'Não foi possível criar o link', description: e.message, variant: 'destructive' }),
  });
  const rotate = useMutation({
    mutationFn: (requestId: string) => intakeCall<{ url: string }>('rotate', { requestId }),
    onSuccess: (r) => { void copy(r.url); setRotating(null); refresh(); },
    onError: (e: Error) => toast({ title: 'Não foi possível trocar o link', description: e.message, variant: 'destructive' }),
  });

  const items = list.data?.items ?? [];
  const label = `${range.from.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a ${new Date(range.to.getTime() - DAY).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;

  return (
    <div className={embedded ? '' : 'min-h-screen bg-[#F6F8F7]'}>
      <div className={embedded ? 'w-full max-w-5xl' : 'mx-auto w-full max-w-5xl px-4 py-5 sm:py-8'}>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {!embedded && <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Button>}
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold"><ClipboardList className="h-5 w-5 text-primary" aria-hidden /> Pré-consultas</h1>
            <p className="text-sm text-muted-foreground">Formulário que o paciente responde antes da consulta, por um link único.</p>
          </div>
        </div>

        {state.data && (!state.data.enabled || !state.data.ready) && (
          <div className="mb-4 rounded-lg border border-[#F2B23E]/60 bg-[#F2B23E]/10 p-3 text-sm">
            {!state.data.ready ? 'A pré-consulta ainda não foi configurada no servidor.' : 'O formulário da clínica está desligado.'}{' '}
            {state.data.canEditForm && state.data.ready && <Link to="/configuracoes?secao=pre-consulta" className="underline">Configurar o formulário</Link>}
          </div>
        )}

        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Semana anterior" onClick={() => setOffset((o) => o - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" aria-label="Próxima semana" onClick={() => setOffset((o) => o + 1)}><ChevronRight className="h-4 w-4" /></Button>
            <span className="ml-2 text-sm font-medium" aria-live="polite">{label}</span>
          </div>
          {offset !== 0 && <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>Hoje</Button>}
        </div>

        {list.isLoading ? <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando…</p>
          : list.isError ? (
            <p role="alert" className="text-sm text-destructive">{(list.error as Error).message} <button type="button" className="underline" onClick={() => list.refetch()}>Tentar novamente</button></p>
          ) : items.length === 0 ? (
            <p className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground">Nenhuma consulta da agenda da clínica neste período.</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-white">
              {items.map((i) => {
                const cancelled = i.appointmentStatus === 'cancelado' || i.appointmentStatus === 'faltou';
                const usable = !cancelled && state.data?.enabled && state.data?.ready;
                return (
                  <li key={i.appointmentId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{i.contactName ?? 'Sem contato vinculado'}</p>
                      <p className="text-sm text-muted-foreground">{dateTime(i.start)} · {i.doctorName}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {stateBadge(i)}
                      {i.state === 'answered' && <Button size="sm" variant="outline" onClick={() => setViewing(i.appointmentId)}>Ver respostas</Button>}
                      {usable && (
                        <Button size="sm" variant={i.state === 'none' ? 'default' : 'outline'} disabled={link.isPending}
                          onClick={() => link.mutate(i.appointmentId)} aria-label={`Copiar link da pré-consulta de ${i.contactName ?? 'paciente'}`}>
                          <Copy className="mr-1.5 h-3.5 w-3.5" /> {i.state === 'none' ? 'Criar e copiar link' : 'Copiar link'}
                        </Button>
                      )}
                      {usable && i.requestId && (
                        <Button size="icon" variant="ghost" aria-label="Trocar o link (o anterior para de funcionar)" onClick={() => setRotating(i)}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
      <IntakeAnswersDialog appointmentId={viewing} open={!!viewing} onOpenChange={(o) => !o && setViewing(null)} />
      <AlertDialog open={!!rotating} onOpenChange={(o) => !o && setRotating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar o link?</AlertDialogTitle>
            <AlertDialogDescription>
              O link enviado antes para de funcionar na hora. Use se ele foi para a pessoa errada. As respostas já enviadas continuam guardadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (rotating?.requestId) rotate.mutate(rotating.requestId); }} disabled={rotate.isPending}>
              Trocar e copiar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
