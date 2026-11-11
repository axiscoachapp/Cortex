import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { dialogLayout } from '@/lib/dialogLayout';

/** The app's own question before in-app navigation throws edits away (the browser keeps the tab-close prompt). */
export function DiscardChangesDialog({ open, message, onKeep, onDiscard }: {
  open: boolean; message: string; onKeep: () => void; onDiscard: () => void;
}) {
  return <AlertDialog open={open} onOpenChange={next => { if (!next) onKeep(); }}>
    <AlertDialogContent className="max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
        <AlertDialogDescription>{message}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className={dialogLayout.actions}>
        <Button type="button" variant="outline" className={dialogLayout.button} onClick={onKeep} autoFocus>Continuar editando</Button>
        <Button type="button" variant="destructive" className={dialogLayout.button} onClick={onDiscard}>Descartar alterações</Button>
      </div>
    </AlertDialogContent>
  </AlertDialog>;
}
