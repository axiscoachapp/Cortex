import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingCard } from './OnboardingCard';
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ prescriberComplete: false, isLoading: false, isError: false }) }));
describe('first use guidance is separate from implementation work', () => {
  it('points to a managed profile review instead of assigning setup/import to the doctor', () => {
    render(<MemoryRouter><OnboardingCard userId="synthetic" patientCount={0} hasConsultation={false} onNewConsultation={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(/precisa ser concluído pela equipe de implantação/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Consultar dados da implantação' })).toBeVisible();
    expect(screen.queryByText(/Preencher seus dados|importar pacientes|via CSV|passos obrigatórios/)).toBeNull();
    expect(screen.getByRole('button', { name: /Registrar sua primeira consulta/ })).toBeVisible();
  });
});
