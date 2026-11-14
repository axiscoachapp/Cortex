import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientFiles } from './PatientFiles';
import type { ViewerFile } from './FileViewerDialog';

const mocks = vi.hoisted(() => ({
  remove: vi.fn().mockResolvedValue({ error: new Error('offline') }),
  deleteRow: vi.fn(),
  createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.invalid/signed' }, error: null }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
// The viewer has its own tests: here it only shows which file it was given.
vi.mock('@/components/FileViewerDialog', () => ({
  FileViewerDialog: ({
    open,
    onOpenChange,
    file,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    file: ViewerFile;
  }) =>
    open ? (
      <div role="dialog" aria-label={file.fileName} data-path={file.storagePath} data-type={file.mimeType ?? ''}>
        <button type="button" onClick={() => onOpenChange(false)}>
          Fechar
        </button>
      </div>
    ) : null,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: (from: number) =>
          Promise.resolve({
            error: null,
            data: from
              ? []
              : [
                  {
                    id: 'file-a',
                    storage_path: 'patients/doctor/patient/file.pdf',
                    file_name: 'documento.pdf',
                    mime_type: 'application/pdf',
                    size_bytes: 50,
                    created_at: '2026-05-01T12:00:00Z',
                    ai_summary: null,
                    tag: 'PDF',
                  },
                ],
          }),
        delete: () => ({ eq: mocks.deleteRow }),
      };
      return query;
    },
    storage: { from: () => ({ remove: mocks.remove, createSignedUrl: mocks.createSignedUrl }) },
  },
}));

describe('Patient file opening', () => {
  it('shows the file inside the app, in the viewer, instead of sending the doctor to a browser tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PatientFiles patientId="patient" userId="doctor" />
      </QueryClientProvider>,
    );
    const file = await screen.findByRole('button', { name: 'Ver documento.pdf' });
    expect(file).toHaveAccessibleDescription(/01\/05\/2026.*50 B.*PDF/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(file);
    const viewer = screen.getByRole('dialog', { name: 'documento.pdf' });
    expect(viewer).toHaveAttribute('data-path', 'patients/doctor/patient/file.pdf');
    expect(viewer).toHaveAttribute('data-type', 'application/pdf');
    // The download and the new tab now live inside the viewer.
    expect(screen.queryByRole('button', { name: /Abrir ou baixar/ })).not.toBeInTheDocument();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await userEvent.click(within(viewer).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open.mockRestore();
  });
  it('opens the viewer from the keyboard', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PatientFiles patientId="patient" userId="doctor" />
      </QueryClientProvider>,
    );
    (await screen.findByRole('button', { name: 'Ver documento.pdf' })).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'documento.pdf' })).toBeInTheDocument();
  });
});

describe('Patient file removal', () => {
  it('retains metadata and offers a retry when the storage deletion fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PatientFiles patientId="patient" userId="doctor" />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir documento.pdf' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/registro foi mantido/i));
    expect(mocks.deleteRow).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Excluir documento.pdf' })).toBeEnabled();
  });
});
