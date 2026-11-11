/** The one full-screen loader of the app (route chunks, session start, home). */
export function FullScreenLoader() {
  return <div role="status" className="flex h-[100dvh] items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div aria-hidden="true" className="flex h-8 w-8 animate-pulse items-center justify-center rounded-lg bg-primary">
        <span className="text-sm font-bold text-primary-foreground">C</span>
      </div>
      <p className="text-sm text-muted-foreground">Carregando...</p>
    </div>
  </div>;
}
