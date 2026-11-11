import { afterEach, describe, expect, it, vi } from 'vitest';
// fireEvent: the toast's swipe handling needs pointer capture, which jsdom lacks.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Toaster } from './toaster';
import { toast } from '@/hooks/use-toast';

afterEach(() => {
  act(() => toast({ title: '' }).dismiss());
  vi.useRealTimers();
});

describe('Toaster', () => {
  it('shows notices at the top centre with a limited width', () => {
    render(<Toaster />);
    const region = screen.getByRole('region', { name: /notificações/i });
    const viewport = region.querySelector('ol')!;
    expect(viewport.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['top-0', 'left-1/2', '-translate-x-1/2', 'max-w-[420px]']),
    );
    expect(viewport.className).not.toMatch(/bottom-0|right-0/);
  });

  it('keeps an error until it is closed, with a visible 44 px close button', async () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => { toast({ title: 'Não foi possível salvar', variant: 'destructive' }); });
    act(() => { vi.advanceTimersByTime(60_000); });
    const item = screen.getByText('Não foi possível salvar').closest('li')!;
    expect(item).toHaveAttribute('data-state', 'open');
    const close = within(item).getByRole('button', { name: 'Fechar notificação' });
    expect(close.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-[44px]', 'w-[44px]']));
    expect(close.className).not.toMatch(/opacity-0/);
    vi.useRealTimers();
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByText('Não foi possível salvar')?.closest('li')?.getAttribute('data-state') ?? 'closed').toBe('closed'));
  });

  it('closes other notices by themselves', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => { toast({ title: 'Paciente arquivado' }); });
    expect(screen.getByText('Paciente arquivado').closest('li')).toHaveAttribute('data-state', 'open');
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(screen.queryByText('Paciente arquivado')?.closest('li')?.getAttribute('data-state') ?? 'closed').toBe('closed');
  });

  it('announces errors at once and other notices politely', async () => {
    render(<Toaster />);
    act(() => { toast({ title: 'Falha no envio', variant: 'destructive' }); });
    const assertive = await waitFor(() => {
      const node = Array.from(document.querySelectorAll('[aria-live="assertive"]')).find((element) => element.textContent?.includes('Falha no envio'));
      expect(node).toBeTruthy();
      return node!;
    });
    expect(assertive).toHaveAttribute('role', 'status');
    expect(assertive.textContent).toMatch(/^Notificação/);

    act(() => { toast({ title: 'Paciente restaurado' }); });
    await waitFor(() => {
      const node = Array.from(document.querySelectorAll('[aria-live="polite"]')).find((element) => element.textContent?.includes('Paciente restaurado'));
      expect(node).toBeTruthy();
    });
  });
});
