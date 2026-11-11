import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesRouteGuard, pendingExit, useUnsavedChanges } from './useUnsavedChanges';

afterEach(() => vi.restoreAllMocks());

function Editor({ blocking = false, onClosed }: { blocking?: boolean; onClosed: () => void }) {
  const guard = useUnsavedChanges(true, 'Texto sintético não salvo.', { blocking });
  return <>
    <button onClick={() => { if (guard(false, onClosed)) onClosed(); }}>Fechar com o diálogo do app</button>
    <button onClick={() => { if (guard(false)) onClosed(); }}>Fechar legado</button>
  </>;
}
function mount(blocking = false) {
  const onClosed = vi.fn();
  const router = createMemoryRouter([{ path: '*', element: <><UnsavedChangesRouteGuard /><Editor blocking={blocking} onClosed={onClosed} /></> }]);
  render(<RouterProvider router={router} />);
  return { onClosed, router };
}

describe('unsaved changes in the app dialog', () => {
  it('asks "Continuar editando" / "Descartar alterações" for a dirty close with a proceed step', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { onClosed } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar com o diálogo do app' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Descartar alterações?' });
    expect(ask).toHaveTextContent('Texto sintético não salvo.');
    await userEvent.click(within(ask).getByRole('button', { name: 'Continuar editando' }));
    expect(onClosed).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar com o diálogo do app' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar alterações' }));
    expect(onClosed).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps legacy callers on the browser confirm, and never closes a blocking operation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onClosed } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar legado' }));
    expect(confirm).toHaveBeenCalledWith('Texto sintético não salvo.');
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('a blocking operation is never discarded, and leaving the tab still warns', async () => {
    const { onClosed } = mount(true);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar com o diálogo do app' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    expect(pendingExit()).toEqual({ locked: 'Texto sintético não salvo.', unsaved: true });
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('blocks route changes in the app dialog and proceeds only after discard', async () => {
    const { router } = mount();
    void router.navigate('/agenda');
    const ask = await screen.findByRole('alertdialog', { name: 'Descartar alterações?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Continuar editando' }));
    expect(router.state.location.pathname).toBe('/');
    void router.navigate('/agenda');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar alterações' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/agenda'));
  });
});
