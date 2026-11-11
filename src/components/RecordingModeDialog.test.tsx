import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordingModeDialog } from './RecordingModeDialog';

vi.mock('@/hooks/useRecording', () => ({ supportsSystemAudio: () => true }));
afterEach(cleanup);

describe('RecordingModeDialog', () => {
  it('fits a phone: titled like its trigger, scrollable body, shared checkbox and a reason while disabled', () => {
    const onSelect = vi.fn();
    render(<RecordingModeDialog open onOpenChange={vi.fn()} onSelect={onSelect} />);
    const dialog = screen.getByRole('dialog', { name: 'Gravar consulta' });
    expect(dialog.className).toContain('max-h-[90dvh]');
    expect(dialog.querySelector('.overflow-y-auto')).not.toBeNull();
    const consent = within(dialog).getByRole('checkbox', { name: /consentiu com a gravação/ });
    expect(consent.tagName).toBe('BUTTON'); // the shared Radix checkbox, not a 13 px native box
    const presencial = within(dialog).getByRole('button', { name: /Presencial/ });
    expect(presencial).toBeDisabled();
    expect(presencial).toHaveAccessibleDescription('Marque o consentimento para escolher o tipo.');
    fireEvent.click(presencial);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(consent);
    expect(screen.queryByText('Marque o consentimento para escolher o tipo.')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Presencial/ }));
    expect(onSelect).toHaveBeenCalledWith('presencial', expect.objectContaining({ consentedAt: expect.any(String) }));
  });

  it('keeps the teleconsultation tip inside the teleconsultation card', () => {
    render(<RecordingModeDialog open onOpenChange={vi.fn()} onSelect={vi.fn()} />);
    const online = screen.getByRole('button', { name: /Teleconsulta/ });
    expect(within(online).getByText(/Compartilhar áudio da guia/)).toBeInTheDocument();
  });
});
