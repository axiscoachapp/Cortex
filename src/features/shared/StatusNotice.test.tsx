import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LoadErrorNotice, NoAccessNotice, loadErrorText } from './StatusNotice';
import { ReceptionAccessNotice, ReceptionNotice } from '@/features/reception/ReceptionNotice';

describe('shared status notices', () => {
  it('shows a failed read as one plain sentence with a working retry', () => {
    const retry = vi.fn();
    render(<LoadErrorNotice subject="o financeiro" onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar o financeiro. Verifique a conexão e tente de novo.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('says what the person cannot do, who can grant it, and offers a way back', () => {
    render(<MemoryRouter><NoAccessNotice title="Equipe da recepção" message="Esta página é só para o administrador da clínica." /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Equipe da recepção' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Esta página é só para o administrador da clínica.');
    expect(screen.getByRole('alert')).toHaveTextContent('Quem pode liberar: o administrador da clínica.');
    expect(screen.getByRole('link', { name: 'Voltar aos atendimentos' })).toHaveAttribute('href', '/recepcao');
  });

  it('draws reception errors and the reception no-access page with the same notices', () => {
    const { rerender } = render(<MemoryRouter><ReceptionNotice error={new Error('Agendamento indisponível. Atualize a agenda antes de tentar novamente.')} onRetry={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Agendamento indisponível.');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    rerender(<MemoryRouter><ReceptionNotice error="not an Error" /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent(loadErrorText());
    rerender(<MemoryRouter><ReceptionAccessNotice title="Indicadores do WhatsApp" message="Sua conta não vê os indicadores." /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Quem pode liberar: o administrador da clínica.');
  });
});
