import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileUpdateCard, type MergedProfile } from './ProfileUpdateCard';

const existing = {
  diagnoses: [{ code: 'E03.9', description: 'Hipotireoidismo' }],
  medications: [
    { name: 'Levotiroxina 88 mcg', dosage: '1 comprimido ao dia', instructions: 'em jejum' },
    { name: 'Desogestrel 75 mcg', dosage: '1 comprimido ao dia', instructions: 'uso contínuo' },
  ],
  allergies: ['Sulfa'],
};
const initial = {
  diagnoses: [],
  medications: [{ name: 'Estradiol em gel', dosage: '1 mg ao dia', instructions: 'na pele' }],
  allergies: ['Dipirona'],
  medicationsStopped: ['Desogestrel 75 mcg', 'Medicamento que não está no cadastro'],
};

function mount(onAccept = vi.fn(async (_merged: MergedProfile) => {})) {
  render(<ProfileUpdateCard initial={initial} existing={existing} missingFields={[]} onAccept={onAccept} onDismiss={() => {}} />);
  return onAccept;
}

describe('ProfileUpdateCard', () => {
  it('removes a stopped medication from the chart when accepted, and only one that is in the chart', async () => {
    const onAccept = mount();
    expect(screen.getByText('Retirar das medicações em uso')).toBeVisible();
    expect(screen.getByLabelText('Desogestrel 75 mcg')).toBeChecked();
    expect(screen.queryByLabelText('Medicamento que não está no cadastro')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /aceitar/i }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledOnce());
    const merged = onAccept.mock.calls[0][0];
    expect(merged.medications.map((m) => m.name)).toEqual(['Levotiroxina 88 mcg', 'Estradiol em gel']);
    expect(merged.allergies).toEqual(['Sulfa', 'Dipirona']);
  });

  it('keeps the medication when the doctor unticks the removal', async () => {
    const onAccept = mount();
    await userEvent.click(screen.getByLabelText('Desogestrel 75 mcg'));
    await userEvent.click(screen.getByRole('button', { name: /aceitar/i }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledOnce());
    expect(onAccept.mock.calls[0][0].medications.map((m) => m.name)).toEqual(['Levotiroxina 88 mcg', 'Desogestrel 75 mcg', 'Estradiol em gel']);
  });

  it('saves text left in an "add" field instead of dropping it silently', async () => {
    const onAccept = mount();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.type(screen.getByPlaceholderText(/adicionar alergia/i), 'Penicilina');
    await userEvent.click(screen.getByRole('button', { name: /salvar edição/i }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledOnce());
    expect(onAccept.mock.calls[0][0].allergies).toEqual(['Sulfa', 'Dipirona', 'Penicilina']);
  });
});
