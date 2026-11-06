// Accessible mobile menu: toggles the panel, keeps aria-expanded in sync,
// closes on Escape, on link click and when the viewport grows to desktop.
export function initMenu(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const panel = document.querySelector<HTMLElement>('[data-menu-panel]');
  const label = document.querySelector<HTMLElement>('[data-menu-label]');
  if (!button || !panel) return;

  const setOpen = (open: boolean, returnFocus = false) => {
    button.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    if (label) label.textContent = open ? 'Fechar menu' : 'Abrir menu';
    if (open) {
      panel.querySelector<HTMLElement>('a')?.focus();
    } else if (returnFocus) {
      button.focus();
    }
  };

  button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      setOpen(false, true);
    }
  });

  panel.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) setOpen(false);
  });

  const desktop = window.matchMedia('(min-width: 1024px)');
  desktop.addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}
