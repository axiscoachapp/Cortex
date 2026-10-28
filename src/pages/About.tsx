import { Link } from 'react-router-dom';
import { ArrowRight, FileText, Users, CalendarDays, ClipboardList } from 'lucide-react';
import { BrandLockup } from '@/components/BrandLockup';
import { Button } from '@/components/ui/button';
const features=[
  {icon:FileText,title:'Documentação com revisão',text:'Registre uma consulta manualmente ou revise o rascunho preparado a partir de uma gravação. O médico confirma o texto final.'},
  {icon:Users,title:'Cada médico, seus pacientes',text:'As listas são privadas. Um paciente pode ser compartilhado explicitamente com outro médico, com permissão de leitura ou contribuição.'},
  {icon:CalendarDays,title:'Agenda ligada à consulta',text:'Organize os atendimentos e acompanhe o estado de cada agendamento. Integrações externas mostram seu estado de sincronização.'},
  {icon:ClipboardList,title:'Continuidade do cuidado',text:'Retome rascunhos, registre observações, reconcilie medicações e acompanhe resultados, encaminhamentos e retornos.'},
];
export default function About(){return <div className="min-h-screen bg-background">
  <header className="border-b bg-card"><div className="max-w-6xl mx-auto p-5 flex justify-between items-center gap-4"><Link to="/auth" aria-label="Haddad Nicola — entrar"><BrandLockup compact/></Link><Button asChild><Link to="/auth">Entrar<ArrowRight className="w-4 h-4"/></Link></Button></div></header>
  <main className="max-w-6xl mx-auto px-5 py-16 sm:py-24"><p className="text-xs uppercase tracking-[.2em] text-primary">Haddad Nicola · Ambiente clínico</p><h1 className="font-serif text-4xl sm:text-6xl max-w-3xl leading-tight mt-6">Documentar com clareza.<br/><span className="text-primary">Acompanhar com atenção.</span></h1><p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mt-6">O Cortex reúne documentação, agenda e acompanhamento para o trabalho individual dos médicos do consultório.</p>
    <div className="grid sm:grid-cols-2 gap-5 mt-14">{features.map(({icon:Icon,title,text})=><article key={title} className="bg-card border rounded-xl p-7"><Icon className="h-6 w-6 text-primary mb-5"/><h2 className="font-serif text-2xl">{title}</h2><p className="text-sm leading-relaxed text-muted-foreground mt-3">{text}</p></article>)}</div>
    <section className="border-y border-border py-8 mt-12 space-y-3 max-w-3xl"><h2 className="font-serif text-2xl">Autoria e responsabilidade clínica</h2><p className="text-sm text-muted-foreground leading-relaxed">As sugestões de IA são rascunhos para revisão. Arquivos, textos clínicos e dados de conta seguem o fluxo de processamento e retenção configurado para o ambiente. Consulte os controles de privacidade na sua conta para exportação e solicitações de exclusão.</p><p className="text-sm text-muted-foreground leading-relaxed">A disponibilidade de recursos depende da configuração do serviço e das integrações. O envio ou a abertura de uma mensagem não comprova sua entrega ao paciente.</p></section>
    <Button asChild className="mt-8"><Link to="/auth">Acessar minha conta<ArrowRight className="h-4 w-4"/></Link></Button>
  </main><footer className="border-t py-6 text-center text-xs text-muted-foreground">Cortex · Haddad Nicola Consultório Médico</footer>
</div>;}
