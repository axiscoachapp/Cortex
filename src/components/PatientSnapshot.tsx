import { useState } from 'react';
import { User, Stethoscope, Pill, AlertCircle, FolderOpen, Printer } from 'lucide-react';
import { Patient } from '@/types/patient';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PatientProfileDrawer } from './PatientProfileDrawer';
import { useToast } from '@/hooks/use-toast';

interface PatientSnapshotProps {
  patient: Patient | null;
}

export function PatientSnapshot({ patient }: PatientSnapshotProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { toast } = useToast();

  const handleGeneratePrescription = () => {
    toast({
      title: 'Gerando receita...',
      description: 'A receita médica está sendo preparada.',
    });
  };

  if (!patient) {
    return (
      <aside className="w-full h-full bg-transparent flex items-center justify-center">
        <div className="text-center text-muted-foreground p-6">
          <User className="w-12 h-12 mx-auto mb-4 text-slate-400 opacity-50" />
          <p className="text-sm">Nenhum paciente selecionado</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-full h-full bg-transparent flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-border/50">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Perfil Vivo
        </h2>
        
        {/* Demographics */}
        <div className="flex items-center gap-3">
          {patient.photoUrl ? (
            <img
              src={patient.photoUrl}
              alt={patient.name}
              className="w-14 h-14 rounded-full object-cover border border-border/50 shadow-sm"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-card border border-border/50 shadow-sm flex items-center justify-center">
              <span className="text-medical-blue font-bold text-base">
                {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </span>
            </div>
          )}
          <div>
            <h3 className="font-semibold text-foreground text-sm">{patient.name}</h3>
            <p className="text-xs text-muted-foreground">{patient.age} anos • {patient.profession}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Diagnoses - Compact */}
        <section className="p-4 border-b border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <Stethoscope className="w-4 h-4 text-slate-400" />
            <h4 className="font-medium text-foreground text-xs uppercase tracking-wide">Hipóteses Diagnósticas</h4>
          </div>
          <div className="space-y-1.5">
            {patient.diagnoses.map((diagnosis, index) => (
              <div
                key={index}
                className="flex items-baseline gap-2 text-sm py-1.5 px-2.5 rounded-lg bg-card shadow-sm"
              >
                <span className="font-mono text-medical-blue text-xs shrink-0">{diagnosis.code}</span>
                <span className="text-foreground/80 text-xs">{diagnosis.description}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Medications - Compact */}
        <section className="p-4 border-b border-border/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Pill className="w-4 h-4 text-slate-400" />
              <h4 className="font-medium text-foreground text-xs uppercase tracking-wide">Medicações em Uso</h4>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGeneratePrescription}
              className="h-7 px-2 text-xs gap-1.5 text-medical-blue hover:text-medical-blue-dark hover:bg-card"
            >
              <Printer className="w-3.5 h-3.5" />
              Gerar Receita
            </Button>
          </div>
          <div className="space-y-1">
            {patient.medications.map((medication, index) => (
              <div
                key={index}
                className="flex items-center gap-2 py-2 px-2.5 rounded-lg bg-card shadow-sm"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground">{medication.name}</span>
                  <span className="text-xs text-muted-foreground ml-1">{medication.dosage}</span>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {medication.instructions}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Allergies - Compact & Highlighted */}
        <section className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className={cn(
              'w-4 h-4',
              patient.allergies.length > 0 ? 'text-destructive' : 'text-slate-400'
            )} />
            <h4 className="font-medium text-foreground text-xs uppercase tracking-wide">Alertas / Alergias</h4>
          </div>
          {patient.allergies.length > 0 ? (
            <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
              {patient.allergies.map((allergy, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-destructive">
                    ⚠️ Alergia a {allergy}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-2 px-2.5 rounded-lg bg-card shadow-sm">
              Nenhuma alergia registrada
            </p>
          )}
        </section>
      </div>

      {/* Bottom Action */}
      <div className="p-4 border-t border-border/50">
        <Button
          variant="ghost"
          className="w-full justify-center gap-2 text-muted-foreground hover:text-medical-blue hover:bg-card text-xs"
          onClick={() => setDrawerOpen(true)}
        >
          <FolderOpen className="w-4 h-4" />
          Ver Perfil Completo & Arquivos
        </Button>
      </div>

      {/* Profile Drawer */}
      <PatientProfileDrawer
        patient={patient}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </aside>
  );
}
