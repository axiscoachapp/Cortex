import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from './alert-dialog';
import { Button } from './button';
import { dialogLayout } from '@/lib/dialogLayout';

const classes = (element: Element) => element.className.split(/\s+/);

function renderDialog(className?: string) {
  render(
    <Dialog open>
      <DialogContent className={className}>
        <DialogTitle>Título</DialogTitle>
        <DialogDescription>Descrição</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
  return screen.getByRole('dialog', { name: 'Título' });
}

describe('Dialog primitives', () => {
  it('has a 44 px close target with a keyboard focus ring', () => {
    renderDialog();
    const close = screen.getByRole('button', { name: 'Fechar' });
    expect(classes(close)).toEqual(expect.arrayContaining(['h-[44px]', 'w-[44px]', 'focus-visible:ring-2', 'focus-visible:ring-ring']));
    expect(classes(close)).not.toContain('focus:outline-none');
  });

  it('never grows past the viewport and keeps a phone margin, even without classes from the author', () => {
    const dialog = renderDialog();
    expect(classes(dialog)).toEqual(expect.arrayContaining(['max-h-[calc(100dvh-24px)]', 'overflow-y-auto', 'w-[calc(100vw-24px)]', 'rounded-lg']));
  });

  it('lets the shared form frame replace the default height and scroll (tailwind-merge keeps the last one)', () => {
    const dialog = renderDialog(`max-w-2xl ${dialogLayout.content}`);
    const list = classes(dialog);
    expect(list).toEqual(expect.arrayContaining(['max-h-[90dvh]', 'overflow-hidden', 'flex', 'p-0', 'max-w-2xl']));
    expect(list).not.toContain('max-h-[calc(100dvh-24px)]');
    expect(list).not.toContain('overflow-y-auto');
    expect(list).not.toContain('grid');
    expect(list).not.toContain('p-6');
    expect(list).not.toContain('max-w-lg');
  });

  it('gives alert dialogs the same viewport limits', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Arquivar?</AlertDialogTitle>
          <AlertDialogDescription>Pode desfazer.</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Arquivar?' });
    expect(classes(dialog)).toEqual(expect.arrayContaining(['max-h-[calc(100dvh-24px)]', 'overflow-y-auto', 'w-[calc(100vw-24px)]']));
  });
});

describe('Disabled buttons', () => {
  it.each(['default', 'medical', 'destructive'] as const)('a disabled %s button turns neutral grey instead of a pale brand colour', (variant) => {
    render(<Button variant={variant} disabled>Salvar</Button>);
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toBeDisabled();
    expect(classes(button)).toEqual(expect.arrayContaining(['disabled:bg-muted', 'disabled:text-muted-foreground', 'disabled:border-border']));
    expect(classes(button)).not.toContain('disabled:opacity-50');
  });

  it('keeps the grey when a caller recolours the button', () => {
    render(<Button className="bg-destructive hover:bg-destructive/90" disabled>Excluir</Button>);
    expect(classes(screen.getByRole('button', { name: 'Excluir' }))).toEqual(expect.arrayContaining(['bg-destructive', 'disabled:bg-muted']));
  });
});
