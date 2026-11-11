import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PatientManagement from './PatientManagement';

const mocks = vi.hoisted(() => ({
  result: { data: [] as unknown[], error: null as unknown },
  update: vi.fn(),
  filters: vi.fn(),
  toast: vi.fn(),
  fresh: null as Record<string, unknown> | null,
  insert: vi.fn(),
  insertResult: { error: null as unknown },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' }, loading: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      let updating = false;
      const query = {
        select: () => query,
        is: () => query,
        not: () => query,
        order: () => query,
        insert: (rows: unknown) => {
          mocks.insert(rows);
          return Promise.resolve(mocks.insertResult);
        },
        update: (value: unknown) => {
          updating = true;
          mocks.update(value);
          return query;
        },
        eq: (key: string, value: unknown) => {
          mocks.filters(key, value);
          return query;
        },
        // An update never matches (another session changed the row); a plain read returns the current row.
        maybeSingle: async () => ({ data: updating ? null : mocks.fresh, error: null }),
        range: (from: number) => Promise.resolve(from === 0 ? mocks.result : { data: [], error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.result).then(resolve),
      };
      return query;
    },
  },
}));

function renderDirectory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PatientManagement />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Patient directory', () => {
  beforeEach(() => {
    mocks.result = { data: [], error: null };
    mocks.fresh = null;
    mocks.update.mockReset();
    mocks.filters.mockReset();
    mocks.toast.mockReset();
  });

  it('shows a retryable load error instead of claiming no patients exist', async () => {
    mocks.result = { data: [], error: new Error('offline') };
    renderDirectory();
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível carregar/i);
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
    expect(screen.queryByText('Nenhum paciente cadastrado')).not.toBeInTheDocument();
  });

  it('explains that migration is prepared by Cortex without opening a file uploader', async () => {
    renderDirectory();
    await userEvent.click(screen.getByRole('button', { name: 'Mais opções de pacientes' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Migração de pacientes' }));
    const dialog = screen.getByRole('dialog', { name: 'Migração acompanhada pela equipe Cortex' });
    expect(dialog).toHaveTextContent(/equipe Cortex prepara e confere a migração/i);
    expect(dialog).toHaveTextContent(/prontuários de cada médico/i);
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importar pacientes' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('searches all loaded patients and opens their chart without starting a consultation', async () => {
    mocks.result.data = [
      { id: 'ana', name: 'Ana Silva', age: 35, last_visit: '2026-05-01', status: 'novo' },
      { id: 'bia', name: 'Beatriz Santos', age: 40, last_visit: '2026-05-02', status: 'retorno' },
    ];
    renderDirectory();
    await screen.findAllByText('Ana Silva');
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar pacientes/i }), 'Beatriz');
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /abrir prontuário de Beatriz Santos/i })).toHaveAttribute(
      'href',
      '/?patient=bia',
    );
  });
  it('retains edited demographics when another session changed the patient', async () => {
    mocks.result.data = [
      { id: 'ana', name: 'Ana Silva', age: 35, revision: 7, last_visit: '2026-05-01', status: 'novo' },
    ];
    renderDirectory();
    await screen.findAllByText('Ana Silva');
    await userEvent.click(screen.getByRole('button', { name: 'Ações para Ana Silva' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Editar cadastro' }));
    await userEvent.type(screen.getByLabelText('Nome'), ' Atualizada');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.filters).toHaveBeenCalledWith('revision', 7);
    expect(screen.getByLabelText('Nome')).toHaveValue('Ana Silva Atualizada');
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Paciente atualizado com sucesso!' }),
    );
  });
});

describe('Patient list layout and search', () => {
  beforeEach(() => {
    mocks.result = {
      data: [
        { id: 'ana', name: 'Ana Silva', age: 35, phone: '(41) 99876-5432', cpf: '52998224725', last_visit: '2026-05-01', status: 'novo' },
        { id: 'joao', name: 'João Souza', age: null, phone: null, last_visit: null, status: 'atendimento' },
      ],
      error: null,
    };
    mocks.fresh = null;
  });

  it('shows one compact row per patient with age, phone, last consultation and status', async () => {
    renderDirectory();
    const list = await screen.findByRole('list', { name: 'Pacientes' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('35 anos');
    expect(rows[0]).toHaveTextContent('(41) 99876-5432');
    expect(rows[0]).toHaveTextContent('01/05/2026');
    expect(rows[1]).toHaveTextContent('Em atendimento');
    expect(within(rows[0]).getByRole('button', { name: 'Ações para Ana Silva' })).toBeInTheDocument();
  });

  it.each([
    ['name without accents', 'joao', 'João Souza'],
    ['CPF digits', '529.982', 'Ana Silva'],
    ['phone digits', '98765', 'Ana Silva'],
  ])('searches by %s', async (_case, query, expected) => {
    renderDirectory();
    await screen.findByRole('list', { name: 'Pacientes' });
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar pacientes/i }), query);
    const rows = within(screen.getByRole('list', { name: 'Pacientes' })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(expected);
  });

  it('explains an empty search and offers to clear it or register the patient', async () => {
    renderDirectory();
    await screen.findByRole('list', { name: 'Pacientes' });
    const search = screen.getByRole('searchbox', { name: /buscar pacientes/i });
    await userEvent.type(search, 'Zuleica');
    expect(screen.getByText('Nenhum paciente com “Zuleica”.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar paciente' }));
    expect(screen.getByRole('dialog', { name: 'Novo paciente' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveValue('Zuleica');
  });

  it('clears the search from the empty result', async () => {
    renderDirectory();
    await screen.findByRole('list', { name: 'Pacientes' });
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar pacientes/i }), 'zzzz');
    await userEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getByRole('searchbox', { name: /buscar pacientes/i })).toHaveValue('');
    expect(within(screen.getByRole('list', { name: 'Pacientes' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows skeleton rows while loading', () => {
    mocks.result = new Promise(() => {}) as unknown as typeof mocks.result;
    renderDirectory();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando pacientes…');
  });

  it('refreshes the form with the current version after an edit conflict, keeping what the doctor changed', async () => {
    mocks.result.data = [{ id: 'ana', name: 'Ana Silva', age: 35, revision: 7, profession: 'Professora', last_visit: '2026-05-01', status: 'novo' }];
    mocks.fresh = { id: 'ana', name: 'Ana Silva', age: 35, revision: 8, profession: 'Engenheira', last_visit: '2026-05-01', status: 'novo' };
    renderDirectory();
    await userEvent.click(await screen.findByRole('button', { name: 'Ações para Ana Silva' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Editar cadastro' }));
    await userEvent.type(screen.getByLabelText('Nome'), ' Atualizada');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(screen.getByLabelText('Profissão (opcional)')).toHaveValue('Engenheira'));
    expect(screen.getByLabelText('Nome')).toHaveValue('Ana Silva Atualizada');
    // The conflict is explained inside the dialog, above the buttons, not in a toast.
    const alert = within(screen.getByRole('dialog', { name: 'Editar cadastro' })).getByRole('alert');
    expect(alert).toHaveTextContent('Este paciente foi alterado em outra sessão');
    expect(alert).toHaveFocus();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Paciente alterado em outra sessão' }));
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(mocks.filters).toHaveBeenCalledWith('revision', 8));
  });
});

vi.mock('@/hooks/useUnsavedChanges', () => ({
  useUnsavedChanges: (dirty: boolean) => (next: boolean) => next || !dirty || window.confirm('Descartar alterações?'),
}));

describe('Patient form dialog', () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    mocks.result = { data: [{ id: 'ana', name: 'Ana Silva', age: 35, revision: 7, last_visit: '2026-05-01', status: 'novo' }], error: null };
    mocks.fresh = null;
    mocks.toast.mockReset();
    mocks.insert.mockReset();
    mocks.insertResult = { error: null };
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  it('shows what is missing under the field, focuses it and never uses a toast', async () => {
    renderDirectory();
    await screen.findByRole('list', { name: 'Pacientes' });
    await userEvent.click(screen.getByRole('button', { name: 'Novo paciente' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo paciente' });
    const add = within(dialog).getByRole('button', { name: 'Adicionar' });
    expect(add).toBeEnabled();
    // Cancelar comes before the primary in the fixed footer.
    expect(within(dialog).getByRole('button', { name: 'Cancelar' }).compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(add);
    const name = screen.getByLabelText('Nome');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/informe um nome válido/i);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();

    await userEvent.type(name, 'Pessoa sintética');
    await userEvent.type(screen.getByLabelText('E-mail (opcional)'), 'sem-arroba');
    await userEvent.click(add);
    expect(name).not.toHaveAttribute('aria-invalid');
    const email = screen.getByLabelText('E-mail (opcional)');
    expect(email).toHaveFocus();
    expect(email).toHaveAccessibleDescription('Informe um e-mail válido, ou deixe em branco.');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('marks optional fields only with "(opcional)" and uses "Última consulta"', async () => {
    renderDirectory();
    await screen.findByRole('list', { name: 'Pacientes' });
    await userEvent.click(screen.getByRole('button', { name: 'Novo paciente' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo paciente' });
    expect(within(dialog).getByLabelText('Última consulta (opcional)')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Idade (opcional)')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/\*|se conhecida|Última visita/);
  });

  it('keeps a server refusal in the dialog, above the buttons', async () => {
    mocks.insertResult = { error: new Error('violates check constraint') };
    renderDirectory();
    await screen.findByRole('list', { name: 'Pacientes' });
    await userEvent.click(screen.getByRole('button', { name: 'Novo paciente' }));
    await userEvent.type(screen.getByLabelText('Nome'), 'Pessoa sintética');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(mocks.insert).toHaveBeenCalled());
    const alert = await within(screen.getByRole('dialog', { name: 'Novo paciente' })).findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível salvar o paciente');
    expect(alert).not.toHaveTextContent('check constraint');
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Nome')).toHaveValue('Pessoa sintética');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('shows the last consultation as date and distance in the list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-31T12:00:00-03:00'));
    try {
      renderDirectory();
      const row = (await screen.findAllByRole('listitem'))[0];
      expect(row).toHaveTextContent('01/05/2026 · há 30 dias');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still asks before archiving a patient', async () => {
    renderDirectory();
    await userEvent.click(await screen.findByRole('button', { name: 'Ações para Ana Silva' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Arquivar…' }));
    expect(screen.getByRole('alertdialog', { name: 'Arquivar Ana Silva?' })).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});