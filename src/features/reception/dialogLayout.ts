// Dialog frame used by the agenda dialogs: header, a body that scrolls, and a
// fixed footer with the error right above "Cancelar" and the primary action.
export const dialogLayout = {
  content: 'flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0',
  header: 'px-4 pb-3 pr-12 pt-5 sm:px-6',
  body: 'min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 sm:px-6',
  footer: 'space-y-3 border-t bg-background px-4 py-3 sm:px-6',
  actions: 'flex flex-wrap items-center justify-end gap-2',
  button: 'h-auto min-h-11 whitespace-normal',
};
