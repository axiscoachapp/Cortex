import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, LockKeyhole, Share2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { supabase } from '@/integrations/supabase/client';
import { sharingRpc, sharedClinicalList, SharingError, type SharedChart, type SharingOverview } from '@/lib/sharing';

const date = (value: string) => new Date(value).toLocaleString('pt-BR');
const empty: SharingOverview = { memberships: [], members: [], received: [], granted: [] };
const auditLabels: Record<string, string> = { chart_viewed: 'Prontuário consultado', share_granted: 'Permissões concedidas ou atualizadas', share_revoked: 'Acesso revogado', entry_added: 'Contribuição registrada', file_delivery_authorized: 'Envio de anexo autorizado' };
const structuredLabels: Record<string, string> = { observation: 'Observação clínica', pregnancy: 'Episódio gestacional', medication: 'Reconciliação de medicamento', instruction: 'Orientações aprovadas', intake: 'Registro pré-consulta aprovado' };
function StructuredSharedHistory({ items, count }: { items: SharedChart['structured_history']; count: number }) {
  return <div className="space-y-3"><h3 className="font-semibold">Histórico estruturado · {items.length} de {count}</h3>
    {!items.length && <p className="text-sm text-muted-foreground">Nenhum registro estruturado disponível neste compartilhamento.</p>}
    {items.map(item => {
      const details = item.details ?? {};
      const clinicalDate = typeof details.date === 'string' ? details.date.split('-').reverse().join('/') : date(item.created_at);
      const source = typeof details.source === 'string' && details.source.trim() ? details.source : 'Registro de autoria do médico';
      const medicationState = typeof details.state === 'string' ? ({ active: 'Ativo', changed: 'Alterado', stopped: 'Suspenso' } as Record<string, string>)[details.state] : '';
      return <article key={item.id} className="rounded-lg border p-4 space-y-2"><p className="text-xs text-primary">{structuredLabels[item.kind] ?? 'Registro clínico'} · {item.status === 'approved' ? 'Aprovado pelo médico' : 'Registrado pelo médico'}</p><h4 className="font-medium">{item.title}</h4><p className="text-xs text-muted-foreground">{item.author_name} · {clinicalDate}</p><p className="text-sm whitespace-pre-wrap break-words">{item.content}</p>
        {item.kind === 'observation' && <p className="text-sm">Valor: {String(details.value ?? '')} {String(details.unit ?? '')}</p>}
        {item.kind === 'medication' && medicationState && <p className="text-sm">Estado: {medicationState}</p>}
        <p className="text-xs text-muted-foreground break-words">Fonte: {source} · Atualizado em {date(item.updated_at)}</p>
      </article>;
    })}
  </div>;
}

export default function SharingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [overview, setOverview] = useState<SharingOverview>(empty);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clinicName, setClinicName] = useState('Haddad Nicola');
  const [email, setEmail] = useState('');
  const [patients, setPatients] = useState<{ id: string; name: string }[]>([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientError, setPatientError] = useState('');
  const [patientId, setPatientId] = useState(params.get('patient') ?? '');
  const [recipientId, setRecipientId] = useState('');
  const [permission, setPermission] = useState('read');
  const [allowDownload, setAllowDownload] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [chart, setChart] = useState<SharedChart | null>(null);
  const [chartError, setChartError] = useState('');
  const [chartLoading, setChartLoading] = useState(false);
  const [limit, setLimit] = useState(50);
  const [entry, setEntry] = useState('');
  const [entryType, setEntryType] = useState('addendum');
  const [entryError, setEntryError] = useState('');
  const [audit, setAudit] = useState<{ action: string; actor_name: string; created_at: string }[]>([]);
  const requestVersion = useRef(0);
  const chartRequest = useRef<number | null>(null);
  const overviewRequest = useRef(false);
  const authorization = useRef<{ patientId: string; revision: number } | null>(null);
  const entryRequestId = useRef(crypto.randomUUID());
  const editorPatient = useRef<string | null>(null);
  const guardEditor = useUnsavedChanges(!!entry.trim());
  const invalidateRequests = useCallback(() => { requestVersion.current++; }, []);
  const active = overview.memberships.find(m => m.status === 'active');
  const admin = active?.role === 'admin';

  const refresh = useCallback(async () => {
    if (overviewRequest.current) return;
    overviewRequest.current = true;
    try {
      const result = await sharingRpc<SharingOverview>('sharing_overview');
      if (!result || ![result.memberships, result.members, result.received, result.granted].every(Array.isArray)) throw new Error('A resposta de permissões não pôde ser validada. Tente novamente.');
      setOverview(result); setError('');
    }
    catch (err) { setOverview(empty); setError(err instanceof Error ? err.message : 'Não foi possível carregar os compartilhamentos.'); }
    finally { overviewRequest.current = false; setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const focus = () => { setLoading(true); setOverview(empty); void refresh(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refresh]);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const search = patientSearch.replace(/[%,_]/g, '');
      const { data, error: loadError } = await supabase.from('patients').select('id,name').eq('user_id', user.id).ilike('name', `%${search}%`).order('name').limit(50);
      if (cancelled) return;
      setPatients(data ?? []);
      setPatientError(loadError ? 'Não foi possível carregar seus pacientes. Tente outra busca.' : '');
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [patientSearch, user?.id]);
  const loadChart = useCallback(async (id: string, count: number, polling = false) => {
    if (polling && chartRequest.current !== null) return;
    const version = ++requestVersion.current;
    chartRequest.current = version;
    if (!polling) { setChartLoading(true); setChart(null); setChartError(''); }
    try {
      if (polling) {
        const access = await sharingRpc<{ authorization_revision: number; permission: SharedChart['permission'] }>('check_shared_patient_access', { p_patient_id: id });
        if (version !== requestVersion.current) return;
        if (authorization.current?.patientId === id && authorization.current.revision === access.authorization_revision) return;
        setChart(null);
        if (access.permission === 'read') setEntry('');
      }
      const result = await sharingRpc<SharedChart>('get_shared_patient_chart', { p_patient_id: id, p_limit: count });
      if (!result?.patient || result.patient.id !== id) throw new Error('A identidade do prontuário não pôde ser validada. Reabra o paciente.');
      const auditResult = result.permission === 'owner' && !polling
        ? await sharingRpc<{ action: string; actor_name: string; created_at: string }[]>('patient_sharing_audit', { p_patient_id: id }) : null;
      if (version !== requestVersion.current) return;
      authorization.current = { patientId: id, revision: result.authorization_revision };
      setChart(result); setChartError('');
      if (auditResult) setAudit(auditResult);
    } catch (err) {
      if (version !== requestVersion.current) return;
      setChart(null); setAudit([]);
      authorization.current = null;
      if (err instanceof SharingError && err.code === '42501') setEntry('');
      setChartError(err instanceof Error ? err.message : 'Acesso indisponível.');
    } finally {
      if (chartRequest.current === version) chartRequest.current = null;
      if (version === requestVersion.current) setChartLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!selected) return;
    void loadChart(selected, limit);
    const timer = window.setInterval(() => void loadChart(selected, limit, true), 5000);
    const focus = () => { setChart(null); void loadChart(selected, limit); void refresh(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); invalidateRequests(); };
  }, [selected, limit, loadChart, refresh, invalidateRequests]);

  const run = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'A operação não foi concluída.'); }
    finally { setBusy(false); }
  };
  const leaveEditor = () => guardEditor(false);
  const open = (id: string) => {
    if (!leaveEditor()) return;
    if (id === selected) { void loadChart(id, limit); return; }
    entryRequestId.current = crypto.randomUUID(); editorPatient.current = id; setSelected(id); setEntry(''); setEntryError(''); setAudit([]); setChart(null); setLimit(50);
  };
  const close = () => {
    if (!leaveEditor()) return;
    requestVersion.current++; editorPatient.current = null; setSelected(null); setChart(null); setEntry(''); setAudit([]);
  };
  const saveEntry = async () => {
    if (!chart || !selected || busy || !entry.trim()) return;
    const id = selected;
    setBusy(true); setEntryError('');
    try {
      await sharingRpc('append_shared_chart_entry', { p_patient_id: id, p_expected_authorization_revision: chart.authorization_revision, p_entry_type: entryType, p_content: entry, p_request_id: entryRequestId.current });
      if (editorPatient.current !== id) return;
      setEntry(''); entryRequestId.current = crypto.randomUUID(); setNotice('Contribuição registrada com autoria. Correções devem ser feitas por um novo adendo.');
      await loadChart(id, limit);
    } catch (err) { if (editorPatient.current === id) setEntryError(err instanceof Error ? err.message : 'A contribuição não foi salva.'); }
    finally { setBusy(false); }
  };
  const download = async (file: SharedChart['files'][number]) => {
    if (busy) return;
    setBusy(true); setEntryError('');
    try {
      const { data, error: downloadError } = await supabase.functions.invoke('shared-patient-file', { body: { fileId: file.id } });
      if (downloadError || !(data instanceof Blob)) throw new Error('Download não concluído. Verifique se o acesso continua autorizado e tente novamente.');
      const url = URL.createObjectURL(data); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.file_name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setEntryError(err instanceof Error ? err.message : 'Não foi possível baixar o arquivo.'); }
    finally { setBusy(false); }
  };

  return <div className="min-h-screen bg-background">
    <header className="border-b bg-card"><div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-4">
      <Button variant="ghost" size="icon" aria-label="Voltar ao consultório" onClick={() => navigate('/')}><ArrowLeft className="w-5 h-5" /></Button>
      <Share2 className="w-5 h-5 text-primary" /><div><h1 className="font-semibold text-lg">Compartilhamento entre médicos</h1><p className="text-xs text-muted-foreground">Listas privadas. Acesso concedido paciente por paciente.</p></div>
    </div></header>
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="rounded-xl border bg-card p-4 flex gap-3 text-sm"><LockKeyhole className="w-5 h-5 shrink-0 text-primary" /><p>Participar da clínica não dá acesso aos prontuários. Leitura, contribuição e download são permissões distintas. A revogação impede novos acessos; cópias já baixadas não podem ser recolhidas. Registros e autoria são preservados após o desligamento de um médico.</p></div>
      {error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-primary/30 p-3 text-sm">{notice}</p>}
      {loading ? <p role="status" className="flex gap-2"><Loader2 className="w-4 h-4 animate-spin" />Carregando permissões…</p> : <>
        {overview.memberships.filter(m => m.status === 'invited').map(m => <section key={m.clinic_id} className="rounded-xl border bg-card p-5 space-y-3"><h2 className="font-semibold">Convite para {m.name}</h2><p className="text-sm">Aceitar permite que os médicos ativos ofereçam compartilhamentos a você. Sua lista permanece privada.</p><div className="flex gap-2"><Button disabled={busy} onClick={() => run(() => sharingRpc('respond_clinic_invitation', { p_clinic_id: m.clinic_id, p_accept: true }), 'Convite aceito.')}>Aceitar</Button><Button variant="outline" disabled={busy} onClick={() => run(() => sharingRpc('respond_clinic_invitation', { p_clinic_id: m.clinic_id, p_accept: false }), 'Convite recusado.')}>Recusar</Button></div></section>)}
        <section className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="font-semibold flex items-center gap-2"><Users className="w-4 h-4" />{active ? active.name : 'Vincular equipe médica'}</h2>
          {!active ? <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void run(() => sharingRpc('create_clinic', { p_name: clinicName }), 'Clínica criada. Convide os médicos com contas individuais.'); }}><div className="space-y-1 flex-1 min-w-48"><Label htmlFor="clinic-name">Nome da clínica</Label><Input id="clinic-name" value={clinicName} onChange={e => setClinicName(e.target.value)} minLength={2} maxLength={120} required /></div><Button disabled={busy}>Criar equipe</Button></form> : <>
            <p className="text-sm text-muted-foreground">Sua função: {admin ? 'administrador da equipe' : 'médico'}. Administradores gerenciam contas e não recebem acesso automático aos pacientes.</p>
            <ul className="divide-y">{overview.members.filter(m => m.clinic_id === active.clinic_id).map(m => <li key={m.user_id} className="py-2 flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{m.name} <span className="text-muted-foreground">· {m.status === 'active' ? 'Ativo' : m.status === 'invited' ? 'Convite pendente' : 'Inativo'}</span></span>{admin && m.user_id !== user?.id && m.status !== 'inactive' && <Button variant="outline" size="sm" disabled={busy} onClick={() => { if (window.confirm('Desativar este médico e revogar seus compartilhamentos? Os registros e a autoria serão preservados.')) void run(() => sharingRpc('offboard_clinic_doctor', { p_clinic_id: active.clinic_id, p_user_id: m.user_id }), 'Médico desativado e acessos revogados.'); }}>Desativar</Button>}</li>)}</ul>
            {admin && <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void run(() => sharingRpc('invite_clinic_doctor', { p_clinic_id: active.clinic_id, p_email: email }), 'Convite disponível na conta do médico. Nenhuma mensagem externa foi enviada.'); }}><div className="flex-1 space-y-1 min-w-48"><Label htmlFor="doctor-email">Email da conta do médico</Label><Input id="doctor-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div><Button disabled={busy}>Disponibilizar convite</Button></form>}
          </>}
        </section>
        {active && <section className="rounded-xl border bg-card p-5 space-y-4"><h2 className="font-semibold">Compartilhar um paciente meu</h2>
          <form className="grid sm:grid-cols-2 gap-4" onSubmit={event => { event.preventDefault(); void run(() => sharingRpc('grant_patient_share', { p_patient_id: patientId, p_recipient_user_id: recipientId, p_permission: permission, p_allow_download: allowDownload, p_expires_at: expiry ? new Date(expiry).toISOString() : null }), 'Permissões registradas.'); }}>
            <div className="space-y-2"><Label htmlFor="share-patient-search">Buscar na minha lista</Label><Input id="share-patient-search" value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Nome do paciente" />{patientError && <p role="alert" className="text-sm text-destructive">{patientError}</p>}<Label htmlFor="share-patient">Paciente</Label><select className="w-full rounded-md border bg-background p-2 text-sm" id="share-patient" value={patientId} onChange={e => setPatientId(e.target.value)} required><option value="">Selecione um dos 50 resultados</option>{patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="share-recipient">Médico destinatário</Label><select className="w-full rounded-md border bg-background p-2 text-sm" id="share-recipient" value={recipientId} onChange={e => setRecipientId(e.target.value)} required><option value="">Selecione</option>{overview.members.filter(m => m.status === 'active' && m.user_id !== user?.id && m.clinic_id === active.clinic_id).map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select><Label htmlFor="share-permission">Permissão no prontuário</Label><select className="w-full rounded-md border bg-background p-2 text-sm" id="share-permission" value={permission} onChange={e => setPermission(e.target.value)}><option value="read">Somente leitura</option><option value="contribute">Leitura e contribuições com autoria</option></select></div>
            <div className="space-y-1"><Label htmlFor="share-expiry">Acesso válido até (opcional)</Label><Input id="share-expiry" type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} /></div>
            <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={allowDownload} onChange={e => setAllowDownload(e.target.checked)} />Permitir download de anexos</label>
            <p className="sm:col-span-2 text-sm text-muted-foreground">Inclui histórico clínico, consultas finalizadas, observações, episódios gestacionais, registros aprovados, contribuições e lista de anexos. Áudio, rascunhos, tarefas, pré-consultas pendentes, exportação completa e alteração de registros de outro autor permanecem restritos.</p><Button className="sm:col-span-2 justify-self-start" disabled={busy || !patientId || !recipientId}>Conceder / atualizar acesso</Button>
          </form>
        </section>}
        <div className="grid lg:grid-cols-2 gap-6">
          <section className="rounded-xl border bg-card p-5 space-y-3"><h2 className="font-semibold">Compartilhados comigo</h2>{!overview.received.length && <p className="text-sm text-muted-foreground">Nenhum prontuário compartilhado disponível.</p>}{overview.received.map(s => <div key={s.patient_id} className="border-t pt-3 flex items-center gap-3 justify-between"><div><p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.owner_name} · {s.permission === 'read' ? 'Leitura' : 'Contribuição'}{s.expires_at ? ` · Até ${date(s.expires_at)}` : ''}</p></div><Button variant="outline" size="sm" onClick={() => open(s.patient_id)}>Abrir</Button></div>)}</section>
          <section className="rounded-xl border bg-card p-5 space-y-3"><h2 className="font-semibold">Acessos que concedi</h2>{!overview.granted.length && <p className="text-sm text-muted-foreground">Sua lista permanece privada até você conceder acesso.</p>}{overview.granted.map(s => <div key={s.id} className="border-t pt-3 space-y-2"><p className="font-medium">{s.patient_name}</p><p className="text-xs text-muted-foreground">{s.recipient_name} · {s.permission === 'read' ? 'Leitura' : 'Contribuição'} · {s.revoked_at ? 'Revogado' : s.expires_at && new Date(s.expires_at) <= new Date() ? 'Expirado' : 'Concedido'} · Download {s.allow_download ? 'permitido' : 'bloqueado'}</p><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => open(s.patient_id)}>Registros e auditoria</Button>{!s.revoked_at && <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => sharingRpc('revoke_patient_share', { p_share_id: s.id }), 'Acesso revogado. Registros anteriores preservados.')}>Revogar</Button>}</div></div>)}</section>
        </div>
      </>}
      {selected && <section className="rounded-xl border-2 border-primary/30 bg-card p-5 space-y-5" aria-label="Prontuário compartilhado"><div className="flex justify-between items-center"><h2 className="font-semibold">{chart?.patient.name ?? 'Prontuário compartilhado'}</h2><Button variant="ghost" size="icon" aria-label="Fechar prontuário compartilhado" onClick={close}><X className="w-4 h-4" /></Button></div>
        {chartLoading && <p role="status">Verificando acesso…</p>}{chartError && <p role="alert" className="text-destructive">{chartError} O conteúdo foi removido desta tela.</p>}
        {chart && <>
          <p className="text-xs text-muted-foreground">Permissão atual: {chart.permission === 'owner' ? 'Responsável pelo prontuário' : chart.permission === 'read' ? 'Somente leitura' : 'Contribuição com autoria'}. Acesso verificado a cada operação, ao retornar à janela e periodicamente enquanto aberta.</p>
          <dl className="grid sm:grid-cols-2 gap-4 text-sm">{[
            ['Idade', chart.patient.age === null ? 'Não informada' : String(chart.patient.age)], ['Alergias', chart.patient.allergies?.join(', ') || 'Não informadas'], ['Medicações', sharedClinicalList(chart.patient.medications)], ['Diagnósticos registrados', sharedClinicalList(chart.patient.diagnoses)], ['Histórico médico', chart.patient.medical_history || 'Não informado'], ['Histórico social', chart.patient.social_anamnesis || 'Não informado'], ['Notas clínicas', chart.patient.clinical_notes || 'Não informadas'],
          ].map(([name, value]) => <div key={name}><dt className="font-medium">{name}</dt><dd className="whitespace-pre-wrap text-muted-foreground break-words">{value}</dd></div>)}</dl>
          <div className="space-y-3"><h3 className="font-semibold">Consultas · {chart.consultations.length} de {chart.consultation_count}</h3>{chart.consultations.map(c => <article key={c.id} className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{date(c.created_at)} · Médico responsável</p><h4 className="font-medium mt-1">{c.chief_complaint || 'Consulta'}</h4><p className="whitespace-pre-wrap text-sm mt-2 break-words">{c.soap_note || 'Sem nota registrada'}</p></article>)}</div>
          <StructuredSharedHistory items={chart.structured_history ?? []} count={chart.structured_history_count ?? 0} />
          <div className="space-y-3"><h3 className="font-semibold">Contribuições e adendos · {chart.entries.length} de {chart.entry_count}</h3>{chart.entries.map(e => <article key={e.id} className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{e.author_name} · {date(e.created_at)} · {e.entry_type === 'encounter' ? 'Atendimento' : 'Adendo'}</p><p className="whitespace-pre-wrap text-sm mt-2 break-words">{e.content}</p></article>)}</div>
          <div className="space-y-2"><h3 className="font-semibold">Anexos · {chart.files.length} de {chart.file_count}</h3>{chart.files.map(f => <div key={f.id} className="border rounded-lg p-3 flex justify-between items-center gap-2"><span className="text-sm break-all">{f.file_name}</span>{chart.allow_download && <Button variant="outline" size="sm" disabled={busy} aria-label={`Baixar ${f.file_name}`} onClick={() => download(f)}><Download className="w-4 h-4 mr-2" />Baixar</Button>}</div>)}</div>
          {Math.max(chart.consultation_count, chart.entry_count, chart.file_count, chart.structured_history_count ?? 0) > limit && <Button variant="outline" disabled={limit >= 500} onClick={() => setLimit(n => Math.min(n + 50, 500))}>{limit >= 500 ? 'Limite de 500 registros por seção nesta visualização' : 'Carregar mais registros'}</Button>}
          {chart.permission !== 'read' && <div className="space-y-3 border-t pt-5"><h3 className="font-semibold">Registrar contribuição</h3><p className="text-sm text-muted-foreground">Revise o texto completo antes de registrar. O conteúdo será preservado com sua autoria; correções são novos adendos.</p><Label htmlFor="shared-entry-type">Tipo de registro</Label><select id="shared-entry-type" disabled={busy} value={entryType} onChange={e => setEntryType(e.target.value)} className="block border rounded-md bg-background p-2 text-sm"><option value="addendum">Adendo</option><option value="encounter">Atendimento</option></select><Label htmlFor="shared-entry">Texto revisado pelo médico</Label><Textarea id="shared-entry" disabled={busy} value={entry} maxLength={50000} rows={8} onChange={e => { entryRequestId.current = crypto.randomUUID(); setEntry(e.target.value); }} />{entryError && <p role="alert" className="text-sm text-destructive">{entryError}</p>}<Button disabled={busy || !entry.trim()} onClick={saveEntry}>Confirmar e registrar com autoria</Button></div>}
          {audit.length > 0 && <details><summary className="cursor-pointer font-medium">Auditoria · últimos 100 eventos</summary><ul className="mt-3 space-y-2 text-xs">{audit.map((a, i) => <li key={`${a.created_at}-${i}`}>{date(a.created_at)} · {a.actor_name} · {auditLabels[a.action] ?? a.action}</li>)}</ul></details>}
        </>}
      </section>}
    </main>
  </div>;
}
