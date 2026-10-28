import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sharingRpc } from '@/lib/sharing';

interface SharedProtocol { id: string; title: string; source_version: string; source_author: string; reviewed_at: string; authorization_revision: number; source_review_revision: number }
interface ProtocolSource extends SharedProtocol { source_text: string; source_reference: string }
interface ProtocolOverview {
  members: { user_id: string; name: string }[];
  received: SharedProtocol[]; received_count: number;
  granted: { id: string; recipient_user_id: string; recipient_name: string; revoked_at: string | null }[];
}
const empty: ProtocolOverview = { members: [], received: [], received_count: 0, granted: [] };
const date = (value: string) => new Date(value).toLocaleString('pt-BR');

/** The authorization overview is deliberately not stored in a long-lived query
 * cache. Failure, focus and revocation remove previously visible shared data. */
function useProtocolOverview(documentId: string | null = null, search = '', limit = 50) {
  const [data, setData] = useState<ProtocolOverview>(empty);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  const version = useRef(0);
  const invalidate = useCallback(() => { version.current++; }, []);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const request = ++version.current;
    try {
      const next = await sharingRpc<ProtocolOverview>('protocol_sharing_overview', { p_document_id: documentId, p_search: search, p_limit: limit });
      if (request !== version.current) return;
      if (!next || ![next.members, next.received, next.granted].every(Array.isArray)) throw new Error('Não foi possível validar as permissões.');
      setData(next); setError('');
    } catch (err) {
      if (request !== version.current) return;
      setData(empty); setError(err instanceof Error ? err.message : 'Compartilhamento indisponível.');
    } finally { busy.current = false; if (request === version.current) setLoading(false); }
  }, [documentId, search, limit]);
  useEffect(() => {
    setData(empty); setLoading(true); void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const focus = () => { setData(empty); setLoading(true); void refresh(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); invalidate(); };
  }, [refresh, invalidate]);
  return { data, error, loading, refresh };
}

export function ProtocolShareControls({ source }: { source: { id: string; title: string; review_status: string; status: string } }) {
  const overview = useProtocolOverview(source.id);
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); await overview.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível alterar o acesso.'); }
    finally { setBusy(false); }
  };
  return <section className="border rounded-lg p-4 space-y-3" aria-label="Permissões deste protocolo"><h3 className="font-semibold text-sm">Compartilhar somente esta versão</h3>
    <p className="text-xs text-muted-foreground">Leitura do protocolo revisado e uso como referência citada. O destinatário não pode editar, reindexar ou exportar sua biblioteca. Versões futuras exigem outro compartilhamento. Permissões de pacientes não concedem acesso a protocolos.</p>
    {(overview.error || error) && <p role="alert" className="text-xs text-destructive">{error || overview.error}</p>}{notice && <p role="status" className="text-xs">{notice}</p>}
    {overview.loading ? <p role="status" className="text-xs">Verificando médicos e permissões…</p> : <>
      {source.review_status === 'approved' && source.status === 'ready' ? overview.data.members.length ? <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void run(() => sharingRpc('grant_protocol_share', { p_document_id: source.id, p_recipient_user_id: recipient }), 'Acesso de leitura concedido somente a esta versão.'); }}><div className="flex-1 min-w-44 space-y-1"><Label htmlFor="protocol-recipient">Médico destinatário</Label><select id="protocol-recipient" value={recipient} onChange={e => setRecipient(e.target.value)} disabled={busy} required className="block w-full rounded-md border bg-background p-2 text-sm"><option value="">Selecione um médico ativo</option>{overview.data.members.map(member => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}</select></div><Button size="sm" disabled={busy || !recipient}>Conceder leitura</Button></form> : <p className="text-xs">Não há outro médico ativo na sua equipe. <Link to="/compartilhamento" className="underline">Gerenciar equipe médica</Link></p> : <p className="text-xs text-muted-foreground">A fonte precisa estar aprovada e com indexação concluída para receber novos compartilhamentos.</p>}
      <ul className="divide-y">{overview.data.granted.map(share => <li key={share.id} className="py-2 flex gap-2 items-center justify-between"><span className="text-xs">{share.recipient_name} · {share.revoked_at ? 'Revogado' : 'Leitura concedida'}</span>{!share.revoked_at && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => sharingRpc('revoke_protocol_share', { p_share_id: share.id }), 'Acesso revogado. Cópias já consultadas não podem ser recolhidas.')}>Revogar leitura</Button>}</li>)}</ul>
    </>}
  </section>;
}

export function SharedProtocolsPanel() {
  const [search, setSearch] = useState(''); const [limit, setLimit] = useState(50);
  const overview = useProtocolOverview(null, search, limit);
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState<ProtocolSource | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0); const requestActive = useRef<number | null>(null);
  const authorization = useRef<{ grant: number; review: number } | null>(null);
  const invalidateRequests = useCallback(() => { requestVersion.current++; }, []);
  const read = useCallback(async (id: string, checkOnly = false) => {
    if (checkOnly && requestActive.current !== null) return;
    const request = ++requestVersion.current; requestActive.current = request;
    if (!checkOnly) { setSource(null); setLoading(true); setError(''); }
    try {
      if (checkOnly) {
        const access = await sharingRpc<{ authorization_revision: number; source_review_revision: number }>('check_shared_protocol_access', { p_document_id: id });
        if (request !== requestVersion.current) return;
        if (access.authorization_revision === authorization.current?.grant && access.source_review_revision === authorization.current?.review) return;
        setSource(null);
      }
      const next = await sharingRpc<ProtocolSource>('get_shared_protocol', { p_document_id: id });
      if (request !== requestVersion.current) return;
      if (!next || next.id !== id || typeof next.source_text !== 'string') throw new Error('A identidade da fonte não pôde ser validada.');
      authorization.current = { grant: next.authorization_revision, review: next.source_review_revision }; setSource(next); setError('');
    } catch (err) {
      if (request !== requestVersion.current) return;
      setSource(null); authorization.current = null; setError(err instanceof Error ? err.message : 'Fonte indisponível.');
    } finally { if (requestActive.current === request) requestActive.current = null; if (request === requestVersion.current) setLoading(false); }
  }, []);
  const openSource = (id: string) => {
    if (id === selected) { void read(id); return; }
    invalidateRequests(); setSource(null); setError(''); setSelected(id);
  };
  useEffect(() => {
    if (!selected) return;
    void read(selected);
    const timer = window.setInterval(() => void read(selected, true), 5000);
    const focus = () => { setSource(null); void read(selected); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); invalidateRequests(); };
  }, [selected, read, invalidateRequests]);
  return <section className="border rounded-xl bg-card p-4 sm:p-5 space-y-4" aria-label="Protocolos compartilhados comigo"><div><h2 className="font-semibold">Protocolos compartilhados comigo</h2><p className="text-xs text-muted-foreground mt-1">Somente fontes e versões explicitamente concedidas. Acesso verificado a cada leitura e periodicamente; retirada da fonte ou desligamento do médico interrompe o acesso.</p></div>
    <Input aria-label="Buscar protocolo compartilhado" value={search} onChange={e => { setSearch(e.target.value); setLimit(50); }} placeholder="Buscar pelo título compartilhado" />
    {overview.error && <p role="alert" className="text-sm text-destructive">{overview.error}</p>}{overview.loading ? <p role="status" className="text-sm">Verificando compartilhamentos…</p> : <><p className="text-xs text-muted-foreground">{overview.data.received.length} de {overview.data.received_count} fontes disponíveis.</p>{!overview.data.received.length && <p className="text-sm text-muted-foreground">Nenhum protocolo compartilhado disponível.</p>}<ul className="divide-y">{overview.data.received.map(item => <li key={item.id} className="py-3 flex gap-3 items-center justify-between"><div className="min-w-0"><h3 className="font-medium text-sm break-words">{item.title}</h3><p className="text-xs text-muted-foreground">{item.source_author} · versão {item.source_version} · revisão {date(item.reviewed_at)}</p></div><Button size="sm" variant="outline" onClick={() => openSource(item.id)}>Ler versão</Button></li>)}</ul>{overview.data.received_count > limit && <Button variant="outline" size="sm" disabled={limit >= 500} onClick={() => setLimit(n => Math.min(n + 50, 500))}>{limit >= 500 ? 'Refine a busca para localizar outras fontes' : 'Carregar mais protocolos'}</Button>}</>}
    {selected && <div className="border-t pt-4 space-y-3"><div className="flex justify-between items-center gap-3"><h3 className="font-medium">{source?.title ?? 'Fonte compartilhada'}</h3><Button size="sm" variant="outline" onClick={() => { invalidateRequests(); setSelected(null); setSource(null); setError(''); }}>Fechar leitura</Button></div>{loading && <p role="status">Verificando acesso à fonte…</p>}{error && <p role="alert" className="text-sm text-destructive">{error} O texto foi removido desta tela.</p>}{source && <><p className="text-xs text-muted-foreground">Revisado / compartilhado por: {source.source_author} · versão {source.source_version} · revisão {date(source.reviewed_at)}</p><p className="text-sm break-words">Fonte: {source.source_reference}</p><pre className="font-sans text-sm whitespace-pre-wrap break-words border rounded-lg p-4 bg-muted/20">{source.source_text}</pre><p className="text-xs text-muted-foreground">Esta permissão é de leitura. Cópias já consultadas não podem ser recolhidas; uma versão posterior precisa de nova concessão.</p></>}</div>}
  </section>;
}
