// The dialog frame for every form dialog in the app: a header, a body that
// scrolls, and a fixed footer with the error right above "Cancelar" and the
// primary action. Use it instead of `max-h-… overflow-y-auto` on the content,
// which lets the primary button scroll out of sight.
//
//   <DialogContent className={`max-w-2xl ${dialogLayout.content}`}>
//     <DialogHeader className={dialogLayout.header}>…title = trigger label…</DialogHeader>
//     <form className="flex min-h-0 flex-1 flex-col" onSubmit={…}>
//       <div className={dialogLayout.body}>…fields, each with its message under it…</div>
//       <div className={dialogLayout.footer}>
//         {error && <p role="alert" tabIndex={-1} className={dialogLayout.error}>{error}</p>}
//         <div className={dialogLayout.actions}>
//           <Button type="button" variant="outline" className={dialogLayout.button}>Cancelar</Button>
//           <Button type="submit" className={dialogLayout.button}>…primary…</Button>
//         </div>
//       </div>
//     </form>
//   </DialogContent>
export const dialogLayout = {
  content: 'flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0',
  header: 'px-4 pb-3 pr-12 pt-5 sm:px-6',
  body: 'min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 sm:px-6',
  footer: 'space-y-3 border-t bg-background px-4 py-3 sm:px-6',
  error: 'rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive',
  actions: 'flex flex-wrap items-center justify-end gap-2',
  button: 'h-auto min-h-11 whitespace-normal',
};
