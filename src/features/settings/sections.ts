import { BadgeCheck, ClipboardList, Home, Info, KeyRound, MessageCircle, Plug, Settings2, Shield, Users, UserCog } from 'lucide-react';
import type { ClinicAccess } from '@/features/reception/contracts';

export type SectionId = 'inicio' | 'perfil' | 'implantacao' | 'whatsapp' | 'pre-consulta' | 'conexoes' | 'equipe' | 'permissoes' | 'usuarios' | 'seguranca' | 'sobre';
export interface SettingsSection { id: SectionId; label: string; icon: typeof Settings2; description: string; group: string; ownHeading?: boolean }
/** Navigation follows the verified account. Clinic admin is not an implementation operator. */
export function settingsSections(access: ClinicAccess | null | undefined): SettingsSection[] {
  const clinical = access?.kind === 'clinical', clinic = !!access?.active && !!access.clinic, admin = clinic && access?.admin;
  return [
    { id: 'inicio', label: 'Visão geral', icon: Home, description: 'Encontre o que você pode ajustar e o que é cuidado pela implantação.', group: 'Configurações' },
    ...(clinical ? [
      { id: 'perfil' as const, label: 'Preferências de atendimento', icon: BadgeCheck, description: 'Escolha o modelo usado nas suas evoluções.', group: 'Seu trabalho' },
      { id: 'usuarios' as const, label: admin ? 'Médicos e compartilhamento' : 'Compartilhamento', icon: UserCog, description: 'Acesso a prontuários depende de compartilhamento explícito entre médicos.', group: 'Seu trabalho' },
    ] : []),
    ...(clinical ? [{ id: 'permissoes' as const, label: 'Acesso à minha agenda', icon: KeyRound, description: 'Aprove ou revogue o acesso da recepção à sua agenda.', group: 'Seu trabalho', ownHeading: true }] : []),
    ...(clinic ? [{ id: 'whatsapp' as const, label: 'WhatsApp e lembretes', icon: MessageCircle, description: 'Consulte o canal da clínica e as mensagens da rotina.', group: 'Rotina da clínica' }] : []),
    ...(admin ? [
      { id: 'pre-consulta' as const, label: 'Perguntas da pré-consulta', icon: ClipboardList, description: 'Mantenha as perguntas que a clínica envia antes do atendimento.', group: 'Rotina da clínica' },
      { id: 'equipe' as const, label: 'Equipe da recepção', icon: Users, description: 'Consulte a equipe e mantenha seus acessos operacionais.', group: 'Rotina da clínica', ownHeading: true },
    ] : []),
    { id: 'implantacao', label: 'Dados da implantação', icon: Settings2, description: 'Configurações preparadas e mantidas pela equipe de implantação.', group: 'Implantação e conexões' },
    ...(clinical ? [{ id: 'conexoes' as const, label: 'Agenda e assinatura', icon: Plug, description: 'Conexões que precisam da autorização pessoal do médico.', group: 'Implantação e conexões' }] : []),
    { id: 'seguranca', label: 'Segurança e privacidade', icon: Shield, description: 'Senha, segundo fator e seus dados pessoais.', group: 'Sua conta' },
    { id: 'sobre', label: 'Sobre o Cortex', icon: Info, description: 'Informações do ambiente e avisos.', group: 'Sua conta' },
  ];
}
