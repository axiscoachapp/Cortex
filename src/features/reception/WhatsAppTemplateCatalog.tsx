import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { whatsappApi } from './whatsappApi';
import { readWhatsAppTemplates, type WhatsAppTemplateCatalog } from './whatsappTemplates';

type Scope = { actor: string; clinic: string };
const queryOptions = { retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always' as const, refetchOnWindowFocus: false, refetchOnReconnect: false };

export default function WhatsAppTemplateCatalog(scope: Scope) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), regionId = useId();
  return <div className="min-w-0 space-y-3">
    <Button ref={trigger} variant="outline" className="h-auto min-h-11 whitespace-normal" aria-expanded={open} aria-controls={open ? regionId : undefined} onClick={() => {
      setOpen(value => !value);
      if (open) trigger.current?.focus();
    }}>{open ? 'Ocultar modelos' : 'Consultar modelos'}</Button>
    {open && <CatalogConnection key={scope.actor + ':' + scope.clinic} {...scope} regionId={regionId} />}
  </div>;
}

function CatalogConnection({ actor, clinic, regionId }: Scope & { regionId: string }) {
  const heading = useRef<HTMLHeadingElement>(null), version = useRef(0);
  const headingId = useId();
  useEffect(() => { heading.current?.focus(); }, []);
  const connection = useQuery({
    ...queryOptions,
    queryKey: ['reception', actor, clinic, 'whatsapp', 'templates-connection'],
    queryFn: async ({ signal }) => ({ state: await whatsappApi.state(signal), version: ++version.current }),
  });
  const verifying = connection.fetchStatus !== 'idle';
  const fresh = connection.isSuccess && connection.isFetchedAfterMount && !verifying;
  const allowed = fresh && connection.data.state.serverReady && connection.data.state.connected && connection.data.state.canUseInbox;
  return <section id={regionId} aria-labelledby={headingId} className="min-w-0 rounded-lg border bg-card p-4 sm:p-6 space-y-4">
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">Modelos de mensagem</h2>
        <p className="text-sm text-muted-foreground">Consulte os modelos armazenados da clínica. A lista pode estar incompleta.</p>
      </div>
      <Button variant="outline" className="h-auto min-h-11 shrink-0 whitespace-normal" disabled={verifying} onClick={() => {
        heading.current?.focus();
        void connection.refetch();
      }}>Atualizar modelos</Button>
    </div>
    {connection.fetchStatus === 'paused' ? <p role="status" className="text-sm">Aguardando conexão de rede para verificar os modelos…</p>
      : verifying || connection.isPending ? <p role="status" className="text-sm">Verificando acesso aos modelos…</p>
      : connection.isError ? <p role="alert" className="text-sm">Não foi possível verificar o acesso aos modelos. Use Atualizar modelos para tentar novamente.</p>
      : allowed ? <CatalogRead key={connection.data.version} actor={actor} clinic={clinic} />
      : <div role="status" className="space-y-1 text-sm"><h3 className="font-semibold">Modelos indisponíveis</h3><p>Peça à administração para verificar a conexão e seu acesso ao WhatsApp da clínica.</p></div>}
  </section>;
}

function CatalogRead({ actor, clinic }: Scope) {
  const version = useRef(0);
  const query = useQuery({
    ...queryOptions,
    queryKey: ['reception', actor, clinic, 'whatsapp', 'templates'],
    queryFn: async ({ signal }) => ({ catalog: await readWhatsAppTemplates(signal), version: ++version.current }),
  });
  if (query.fetchStatus === 'paused') return <p role="status" className="text-sm">Aguardando conexão de rede para carregar os modelos…</p>;
  if (query.fetchStatus !== 'idle' || query.isPending) return <p role="status" className="text-sm">Carregando modelos…</p>;
  if (query.isError) return <p role="alert" className="text-sm">Não foi possível carregar os modelos. Use Atualizar modelos para tentar novamente.</p>;
  if (!query.isSuccess || !query.isFetchedAfterMount) return null;
  return <TemplateChoice key={query.data.version} catalog={query.data.catalog} />;
}

function TemplateChoice({ catalog }: { catalog: WhatsAppTemplateCatalog }) {
  const [selected, setSelected] = useState(''), fieldId = useId();
  const chosen = catalog.templates.find(row => JSON.stringify([row.name, row.language]) === selected);
  if (!catalog.templates.length) return <p role="status" className="text-sm">Nenhum modelo armazenado foi encontrado.</p>;
  return <div className="min-w-0 space-y-5">
    <div className="min-w-0 space-y-2">
      <Label htmlFor={fieldId}>Modelo e idioma</Label>
      <select id={fieldId} value={selected} onChange={event => setSelected(event.target.value)} className="block h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm">
        <option value="">Selecione um modelo</option>
        {catalog.templates.map(row => <option key={JSON.stringify([row.name, row.language])} value={JSON.stringify([row.name, row.language])}>{row.name} ({row.language})</option>)}
      </select>
    </div>
    {chosen && <div className="min-w-0 space-y-4">
      <h3 className="font-semibold [overflow-wrap:anywhere]">{chosen.name} <span className="font-normal">({chosen.language})</span></h3>
      <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
        {[['Categoria', chosen.category || 'Não informado'], ['Status informado', chosen.status || 'Não informado'], ['Quantidade de parâmetros', String(chosen.paramCount)]].map(([label, value]) => <div key={label} className="min-w-0 space-y-1"><dt className="text-muted-foreground">{label}</dt><dd className="[overflow-wrap:anywhere]">{value}</dd></div>)}
      </dl>
      <div className="min-w-0 space-y-2"><h4 className="text-sm font-medium">Texto do modelo</h4>
        <p className="rounded-md border bg-muted/30 p-4 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{chosen.body || 'Sem texto no corpo deste modelo.'}</p>
      </div>
    </div>}
  </div>;
}
