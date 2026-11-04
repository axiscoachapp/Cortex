import { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';

// Searches of the public reference catalogs (TUSS exams, CID-10), contract in
// docs/prescriptions/CATALOGOS_E_MANIPULADOS.md. Read-only tables that any
// signed-in user may select. The generated Database types do not list them
// yet, so this file alone uses an untyped view of the client.
type Row = Record<string, string | null>;
type Query = PromiseLike<{ data: Row[] | null; error: unknown }> & {
  select(columns: string): Query; neq(column: string, value: string): Query; ilike(column: string, pattern: string): Query;
  like(column: string, pattern: string): Query; order(column: string): Query; limit(n: number): Query;
};
const catalog = supabase as unknown as { from(table: string): Query };

/** Characters that would change a LIKE pattern or a PostgREST filter. */
const safe = (q: string) => q.replace(/[%_\\,()"]/g, ' ').replace(/\s+/g, ' ').trim();

export interface ExamHit { code: string; name: string }
export interface CidHit { code: string; description: string }

function useDebouncedSearch<T>(query: string, minLength: number, run: (q: string) => Promise<T[]>) {
  const [hits, setHits] = useState<T[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const q = safe(query);
    if (q.length < minLength) { setHits([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await runRef.current(q);
        if (!cancelled) { setHits(rows); setFailed(false); }
      } catch {
        if (!cancelled) { setHits([]); setFailed(true); }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, minLength]);
  return { hits, searching, failed };
}

async function searchExams(q: string): Promise<ExamHit[]> {
  let query = catalog.from('exam_catalog').select('code,name').neq('exam_group', 'outro');
  query = /^\d{3,8}$/.test(q) ? query.like('code', `${q}%`) : query.ilike('name', `%${q}%`);
  const { data, error } = await query.order('name').limit(8);
  if (error) throw error;
  return (data ?? []).map((r) => ({ code: String(r.code), name: String(r.name) }));
}

async function searchCid(q: string): Promise<CidHit[]> {
  const upper = q.toUpperCase();
  let query = catalog.from('cid10_catalog').select('code,description');
  query = /^[A-Z]\d/.test(upper) ? query.ilike('code', `${upper}%`) : query.ilike('description', `%${q}%`);
  const { data, error } = await query.order('code').limit(8);
  if (error) throw error;
  return (data ?? []).map((r) => ({ code: String(r.code), description: String(r.description) }));
}

/** "Hemograma… (TUSS 40304361)": the line the exam request prints. */
export const examLine = (hit: ExamHit) => `${hit.name} (TUSS ${hit.code})`;

export function ExamSearch({ onPick, disabled }: { onPick: (hit: ExamHit) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const { hits, searching, failed } = useDebouncedSearch(query, 3, searchExams);
  return (
    <div className="space-y-1 relative">
      <label className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
        <Search className="w-3 h-3" />
        Buscar exame (tabela TUSS)
      </label>
      <Input aria-label="Buscar exame na tabela TUSS" value={query} disabled={disabled}
        onChange={(e) => setQuery(e.target.value)} placeholder="Digite 3+ letras ou o código" />
      {(hits.length > 0 || searching) && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-lg border border-border bg-white shadow-lg max-h-56 overflow-y-auto scrollbar-thin">
          {searching && hits.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Buscando…</p>
          ) : hits.map((h) => (
            <button key={h.code} type="button" onClick={() => { onPick(h); setQuery(''); }}
              className="w-full text-left px-3 py-2 hover:bg-medical-blue-light/40 border-b border-border/30 last:border-0">
              <p className="text-xs font-medium text-foreground">{h.name}</p>
              <p className="text-[0.625rem] text-muted-foreground">TUSS {h.code}</p>
            </button>
          ))}
        </div>
      )}
      {failed && <p role="alert" className="text-[0.6875rem] text-destructive">Não foi possível consultar a tabela TUSS. Digite o exame na lista abaixo.</p>}
    </div>
  );
}

/** CID field with suggestions from CID-10; free text still accepted. */
export function CidInput({ id, ariaLabel, value, onChange, placeholder, disabled }: {
  id?: string; ariaLabel?: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { hits } = useDebouncedSearch(value, 2, searchCid);
  const exact = hits.find((h) => h.code === value.trim().toUpperCase());
  return (
    <div className="relative space-y-0.5">
      <Input id={id} aria-label={ariaLabel} value={value} disabled={disabled} maxLength={20} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && hits.length > 0 && !exact && (
        <div role="listbox" aria-label="Sugestões de CID-10" className="absolute z-20 left-0 right-0 top-full mt-1 rounded-lg border border-border bg-white shadow-lg max-h-48 overflow-y-auto scrollbar-thin">
          {hits.map((h) => (
            <button key={h.code} type="button" role="option" aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(h.code); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 hover:bg-medical-blue-light/40 border-b border-border/30 last:border-0">
              <span className="text-xs font-semibold text-foreground">{h.code}</span>{' '}
              <span className="text-[0.6875rem] text-muted-foreground">{h.description}</span>
            </button>
          ))}
        </div>
      )}
      {exact && <p className="text-[0.625rem] text-muted-foreground">{exact.description}</p>}
    </div>
  );
}
