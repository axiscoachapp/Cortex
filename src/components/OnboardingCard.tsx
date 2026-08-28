import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Check, ChevronRight, X, BadgeCheck, Users, FileStack, Mic,
} from 'lucide-react';
import { useUserSettings } from '@/hooks/useUserSettings';
import { cn } from '@/lib/utils';

interface OnboardingCardProps {
  patientCount: number;
  hasConsultation: boolean;
  userId: string;
}

/** First-run guided checklist. Dismissed per user via localStorage — a nudge,
 *  not a wall; disappears automatically once every step is complete. */
export function OnboardingCard({ patientCount, hasConsultation, userId }: OnboardingCardProps) {
  const navigate = useNavigate();
  const { prescriberComplete } = useUserSettings();
  const dismissKey = `cortex_onboarding_dismissed_${userId}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey) === '1');

  const steps = useMemo(() => [
    { key: 'prescriber', done: prescriberComplete, label: 'Preencher seus dados de prescritor', icon: BadgeCheck,
      hint: 'Nome, CRM e endereço — obrigatórios nas receitas', action: () => window.dispatchEvent(new Event('open-cortex-settings')) },
    { key: 'patients', done: patientCount > 0, label: 'Adicionar ou importar pacientes', icon: Users,
      hint: 'Importe de outro prontuário via CSV', action: () => navigate('/gerenciar-pacientes') },
    { key: 'template', done: false, label: 'Explorar modelos de documento', icon: FileStack,
      hint: 'Personalize a estrutura das evoluções', action: () => navigate('/modelos'), optional: true },
    { key: 'consult', done: hasConsultation, label: 'Gravar sua primeira consulta', icon: Mic,
      hint: 'Selecione um paciente e grave', action: () => {} },
  ], [prescriberComplete, patientCount, hasConsultation, navigate]);

  const required = steps.filter(s => !s.optional);
  const doneCount = required.filter(s => s.done).length;
  const allDone = doneCount === required.length;

  if (dismissed || allDone) return null;

  const dismiss = () => { localStorage.setItem(dismissKey, '1'); setDismissed(true); };

  return (
    <div className="rounded-2xl border border-medical-blue/20 bg-gradient-to-br from-medical-blue-light/50 to-white p-4 md:p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-medical-blue/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-medical-blue" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Bem-vindo ao Cortex</h3>
            <p className="text-[11px] text-muted-foreground">{doneCount} de {required.length} passos concluídos</p>
          </div>
        </div>
        <button onClick={dismiss} className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-white/60" title="Dispensar">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        {steps.map(({ key, done, label, hint, icon: Icon, action, optional }) => (
          <button
            key={key}
            type="button"
            onClick={action}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all',
              done ? 'bg-white/40' : 'bg-white hover:bg-white/80 hover:shadow-sm',
            )}
          >
            <div className={cn(
              'w-6 h-6 rounded-full flex items-center justify-center shrink-0',
              done ? 'bg-green-100' : 'bg-medical-blue-light',
            )}>
              {done ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Icon className="w-3.5 h-3.5 text-medical-blue" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn('text-xs font-medium', done ? 'text-muted-foreground line-through' : 'text-foreground')}>
                {label}{optional && <span className="text-[9px] text-muted-foreground/60 font-normal"> · opcional</span>}
              </p>
              {!done && <p className="text-[10px] text-muted-foreground">{hint}</p>}
            </div>
            {!done && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}
