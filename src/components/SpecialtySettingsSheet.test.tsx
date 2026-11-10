import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SpecialtySettingsSheet } from './SpecialtySettingsSheet';
const mount = () => render(<MemoryRouter><SpecialtySettingsSheet /></MemoryRouter>);
describe('settings shortcut follows assisted implementation', () => {
  it('opens navigation instead of a specialty, prescriber or copilot editor', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Configurações' }));
    expect(screen.getByRole('link', { name: /Dados da implantação/ })).toHaveAttribute('href', '/configuracoes?secao=implantacao');
    expect(screen.getByRole('link', { name: /Preferências de atendimento/ })).toHaveAttribute('href', '/configuracoes?secao=perfil');
    expect(screen.getByRole('link', { name: /Segurança e privacidade/ })).toBeVisible();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
  it('keeps the existing quick-settings event as a navigation shortcut', async () => {
    mount(); act(() => window.dispatchEvent(new Event('open-cortex-settings')));
    expect(await screen.findByRole('link', { name: 'Todas as configurações' })).toBeVisible();
  });
});
