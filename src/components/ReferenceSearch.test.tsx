import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { CidInput, DcbInput, ExamSearch, examLine } from './ReferenceSearch';

// Synthetic catalog rows; the client records each query it receives.
const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  fail: false,
  rows: {
    exam_catalog: [{ code: '40304361', name: 'Exame laboratorial sintético' }],
    cid10_catalog: [{ code: 'N76.0', description: 'Diagnóstico sintético' }, { code: 'N76.1', description: 'Outro diagnóstico sintético' }],
    dcb_catalog: [{ name: 'substância sintética' }, { name: 'substância sintética micronizada' }],
  } as Record<string, Array<Record<string, string>>>,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, ops: [] as Array<[string, unknown[]]> };
      db.calls.push(call);
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'neq', 'ilike', 'like', 'order']) query[op] = (...args: unknown[]) => { call.ops.push([op, args]); return query; };
      query.limit = async (...args: unknown[]) => {
        call.ops.push(['limit', args]);
        return db.fail ? { data: null, error: new Error('offline') } : { data: db.rows[table] ?? [], error: null };
      };
      return query;
    },
  },
}));

describe('TUSS exam search', () => {
  it('searches names (never the "outro" group) and codes, and hands back the pick', async () => {
    db.calls = []; db.fail = false;
    const onPick = vi.fn();
    render(<ExamSearch onPick={onPick} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Buscar exame na tabela TUSS'), 'exa%me');
    await user.click(await screen.findByRole('button', { name: /Exame laboratorial sintético/ }));
    expect(onPick).toHaveBeenCalledWith({ code: '40304361', name: 'Exame laboratorial sintético' });
    const last = db.calls.at(-1)!;
    expect(last.table).toBe('exam_catalog');
    expect(last.ops).toContainEqual(['neq', ['exam_group', 'outro']]);
    expect(last.ops).toContainEqual(['ilike', ['name', '%exa me%']]); // LIKE wildcards never reach the filter
    expect(examLine(onPick.mock.calls[0][0])).toBe('Exame laboratorial sintético (TUSS 40304361)');
    await user.type(screen.getByLabelText('Buscar exame na tabela TUSS'), '40304');
    await waitFor(() => expect(db.calls.at(-1)!.ops).toContainEqual(['like', ['code', '40304%']]));
  });

  it('says so when the catalog cannot be read, and the list stays editable', async () => {
    db.calls = []; db.fail = true;
    render(<ExamSearch onPick={() => {}} />);
    await userEvent.setup().type(screen.getByLabelText('Buscar exame na tabela TUSS'), 'hemo');
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar a tabela TUSS');
  });
});

describe('CID-10 field', () => {
  function Field() {
    const [value, setValue] = useState('');
    return <CidInput ariaLabel="CID" value={value} onChange={setValue} />;
  }

  it('suggests by code or description, fills the code and shows its description', async () => {
    db.calls = []; db.fail = false;
    render(<Field />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('CID'), 'n76');
    await user.click(await screen.findByRole('option', { name: /N76\.0/ }));
    expect(screen.getByLabelText('CID')).toHaveValue('N76.0');
    expect(await screen.findByText('Diagnóstico sintético')).toBeInTheDocument();
    expect(db.calls.find((c) => c.ops.some(([op, args]) => op === 'ilike' && args[0] === 'code' && args[1] === 'N76%'))).toBeTruthy();
    await user.clear(screen.getByLabelText('CID'));
    await user.type(screen.getByLabelText('CID'), 'vagin');
    await waitFor(() => expect(db.calls.at(-1)!.ops).toContainEqual(['ilike', ['description', '%vagin%']]));
  });

  it('keeps free text when nothing is picked', async () => {
    db.calls = []; db.fail = false;
    render(<Field />);
    await userEvent.setup().type(screen.getByLabelText('CID'), 'Z00');
    expect(screen.getByLabelText('CID')).toHaveValue('Z00');
  });
});

describe('DCB names for formula components', () => {
  function Field() {
    const [value, setValue] = useState('');
    return <DcbInput ariaLabel="Componente 1" value={value} onChange={setValue} />;
  }
  it('suggests official names and fills the chosen one, keeping free text possible', async () => {
    db.calls = []; db.fail = false;
    render(<Field />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Componente 1'), 'subst');
    await user.click(await screen.findByRole('option', { name: 'substância sintética micronizada' }));
    expect(screen.getByLabelText('Componente 1')).toHaveValue('substância sintética micronizada');
    expect(db.calls.at(-1)).toMatchObject({ table: 'dcb_catalog' });
    expect(db.calls.some((c) => c.ops.some(([op, args]) => op === 'ilike' && args[1] === '%subst%'))).toBe(true);
  });
});
