import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, ChevronRight, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

/** A shortcut to the same settings sections, never a second setup editor. */
export function SpecialtySettingsSheet() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('open-cortex-settings', show);
    return () => window.removeEventListener('open-cortex-settings', show);
  }, []);
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground" title="Configurações" aria-label="Configurações"><Settings2 className="h-4 w-4" /></Button></SheetTrigger>
    <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-md overflow-y-auto">
      <SheetHeader><SheetTitle>Configurações</SheetTitle><SheetDescription>Preferências de atendimento, dados da implantação e segurança da conta.</SheetDescription></SheetHeader>
      <div className="mt-6 space-y-3">{[
        { to: 'perfil', title: 'Preferências de atendimento', description: 'Escolher seu modelo de evolução.', icon: BadgeCheck },
        { to: 'implantacao', title: 'Dados da implantação', description: 'Consultar especialidade e cadastro do prescritor.', icon: Settings2 },
        { to: 'seguranca', title: 'Segurança e privacidade', description: 'Senha, segundo fator e dados pessoais.', icon: ShieldCheck },
      ].map(({ to, title, description, icon: Icon }) => <Link key={to} to={`/configuracoes?secao=${to}`} onClick={() => setOpen(false)} className="flex min-h-16 items-start gap-3 rounded-xl border p-4 hover:bg-muted/50"><Icon className="mt-1 h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span></span><ChevronRight className="mt-1 h-4 w-4 shrink-0" /></Link>)}</div>
      <Link to="/configuracoes" onClick={() => setOpen(false)} className="mt-5 flex min-h-11 items-center justify-between rounded-xl bg-primary/10 p-4 text-sm font-semibold text-primary">Todas as configurações<ChevronRight className="h-4 w-4" /></Link>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">A implantação mantém a configuração técnica da clínica. Para corrigir o cadastro profissional, fale com a equipe responsável.</p>
    </SheetContent>
  </Sheet>;
}
