import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientFiles } from './PatientFiles';

const mocks = vi.hoisted(() => ({ remove: vi.fn().mockResolvedValue({ error: new Error('offline') }), deleteRow: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => {
    const query = { select: () => query, eq: () => query, order: () => query,
      range: (from: number) => Promise.resolve({ error: null, data: from ? [] : [{ id: 'file-a', storage_path: 'patients/doctor/patient/file.pdf', file_name: 'documento.pdf', mime_type: 'application/pdf', size_bytes: 50, created_at: '2026-05-01T12:00:00Z', ai_summary: null, tag: 'PDF' }] }),
      delete: () => ({ eq: mocks.deleteRow }),
    }; return query;
  },
  storage: { from: () => ({ remove: mocks.remove }) },
} }));

describe('Patient file removal', () => {
  it('retains metadata and offers a retry when the storage deletion fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<QueryClientProvider client={new QueryClient()}><PatientFiles patientId="patient" userId="doctor" /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir documento.pdf' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/registro foi mantido/i));
    expect(mocks.deleteRow).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Excluir documento.pdf' })).toBeEnabled();
  });
});
