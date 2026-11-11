import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { DocumentPreviewModal } from './DocumentPreviewModal';
const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
const setup = (onClose = vi.fn()) =>
  render(
    <DocumentPreviewModal
      open
      onClose={onClose}
      type="patient_summary"
      content="Texto sintético revisado"
      isLoading={false}
      patientName="Paciente sintético"
    />,
  );
describe('document preview recovery', () => {
  it('offers recovery when clipboard access is rejected', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('copie manualmente');
    expect(screen.getByText('Texto sintético revisado')).toBeInTheDocument();
  });
  it('explains a blocked print window and keeps the document visible', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir / PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Permita pop-ups');
    expect(screen.getByRole('button', { name: 'Fechar prévia do documento' })).toBeInTheDocument();
  });
});

describe('document preview editing', () => {
  it('lets the doctor edit the text before copying and printing', async () => {
    writeText.mockResolvedValue(undefined);
    const printed: string[] = [];
    const win = { document: { write: (html: string) => printed.push(html), close: vi.fn() }, focus: vi.fn(), print: vi.fn(), close: vi.fn(), addEventListener: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Editar texto' }));
    fireEvent.change(screen.getByLabelText('Texto do documento: Resumo para o Paciente'), { target: { value: 'Texto corrigido pelo médico' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver documento' }));
    expect(screen.getByText('Texto corrigido pelo médico')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith('Texto corrigido pelo médico');
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir / PDF' }));
    expect(printed[0]).toContain('Texto corrigido pelo médico');
    // The window closes after printing, not right after print() is called.
    expect(win.close).not.toHaveBeenCalled();
    expect(win.addEventListener).toHaveBeenCalledWith('afterprint', expect.any(Function), { once: true });
  });

  it('asks before discarding the generated document', () => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    setup(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar prévia do documento' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar prévia do documento' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain('descartar');
    confirm.mockRestore();
  });
});
