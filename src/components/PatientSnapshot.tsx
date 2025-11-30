import { useState } from 'react';
import { User, Stethoscope, Pill, AlertCircle, FolderOpen } from 'lucide-react';
import { Patient } from '@/types/patient';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PatientProfileDrawer } from './PatientProfileDrawer';

interface PatientSnapshotProps {
  patient: Patient | null;
}

export function PatientSnapshot({ patient }: PatientSnapshotProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!patient) {
    return (
      <aside className="w-full h-full bg-card border-l border-border flex items-center justify-center">
        <div className="text-center text-muted-foreground p-6">
          <User className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">Nenhum paciente selecionado</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-full h-full bg-card border-l border-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-border bg-gradient-to-br from-medical-blue-light to-card">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Perfil Vivo
        </h2>
        
        {/* Demographics */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-medical-blue-light border-2 border-medical-blue/30 flex items-center justify-center">
            <span className="text-medical-blue font-bold text-lg">
              {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
            </span>
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{patient.name}</h3>
            <p className="text-sm text-muted-foreground">{patient.age} anos</p>
            <p className="text-sm text-muted-foreground">{patient.profession}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Diagnoses */}
        <section className="p-5 border-b border-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-medical-blue-light flex items-center justify-center">
              <Stethoscope className="w-4 h-4 text-medical-blue" />
            </div>
            <h4 className="font-semibold text-foreground text-sm">Hipóteses Diagnósticas</h4>
          </div>
          <ul className="space-y-2">
            {patient.diagnoses.map((diagnosis, index) => (
              <li
                key={index}
                className="text-sm p-2.5 rounded-lg bg-secondary/50 border border-border/50"
              >
                <span className="font-mono text-medical-blue text-xs">{diagnosis.code}</span>
                <span className="mx-2 text-muted-foreground">—</span>
                <span className="text-foreground/90">{diagnosis.description}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Medications */}
        <section className="p-5 border-b border-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-success-light flex items-center justify-center">
              <Pill className="w-4 h-4 text-success" />
            </div>
            <h4 className="font-semibold text-foreground text-sm">Medicações em Uso</h4>
          </div>
          <ul className="space-y-2">
            {patient.medications.map((medication, index) => (
              <li
                key={index}
                className="text-sm p-2.5 rounded-lg bg-success-light/50 border border-success/20"
              >
                <span className="font-medium text-foreground">{medication.name}</span>
                <span className="text-muted-foreground"> {medication.dosage}</span>
                <p className="text-xs text-muted-foreground mt-1">
                  ({medication.instructions})
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Allergies */}
        <section className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className={cn(
              'w-7 h-7 rounded-lg flex items-center justify-center',
              patient.allergies.length > 0 ? 'bg-destructive/10' : 'bg-secondary'
            )}>
              <AlertCircle className={cn(
                'w-4 h-4',
                patient.allergies.length > 0 ? 'text-destructive' : 'text-muted-foreground'
              )} />
            </div>
            <h4 className="font-semibold text-foreground text-sm">Alertas / Alergias</h4>
          </div>
          {patient.allergies.length > 0 ? (
            <ul className="space-y-2">
              {patient.allergies.map((allergy, index) => (
                <li
                  key={index}
                  className="text-sm p-2.5 rounded-lg bg-destructive/10 border border-destructive/20"
                >
                  <span className="font-medium text-destructive">
                    ⚠️ Alergia a {allergy}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground p-2.5 rounded-lg bg-secondary/50">
              Nenhuma alergia registrada
            </p>
          )}
        </section>
      </div>

      {/* Bottom Action */}
      <div className="p-4 border-t border-border">
        <Button
          variant="ghost"
          className="w-full justify-center gap-2 text-muted-foreground hover:text-medical-blue hover:bg-medical-blue-light"
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
