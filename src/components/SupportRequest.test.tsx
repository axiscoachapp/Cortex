import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupportRequest } from './SupportRequest';
import { supportLinks, supportRequestText } from '@/lib/support';

describe('SupportRequest', () => {
  it('always offers a ready request to copy, with the subject and the screen', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    window.history.pushState({}, '', '/financeiro?aba=cadastros');
    render(<SupportRequest subject="Convênios e tabela de preços" clinicName="Clínica Sintética" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copiar pedido' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Assunto: Convênios e tabela de preços'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Clínica Sintética'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Tela: /financeiro?aba=cadastros'));
    expect(await screen.findByText(/Pedido copiado/)).toBeVisible();
  });

  it('says so when the copy fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
    render(<SupportRequest subject="WhatsApp" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copiar pedido' }));
    expect(await screen.findByText(/Não foi possível copiar/)).toBeVisible();
  });

  it('builds no link without a configured channel', () => {
    expect(supportLinks(supportRequestText('Assunto'))).toEqual({ whatsapp: null, email: null });
  });
});
