import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Patient } from '@/types/patient';

interface NewPatientData {
  name: string;
  age: number;
  profession: string;
  phone?: string;
}

interface NewConsultationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: Patient[];
  onStartConsultation: (patientId: string | null, newPatientData: NewPatientData | undefined, chiefComplaint: string) => void;
}

export function NewConsultationModal({ open, onOpenChange, patients, onStartConsultation }: NewConsultationModalProps) {
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientAge, setNewPatientAge] = useState('');
  const [newPatientProfession, setNewPatientProfession] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isNewPatient) {
      onStartConsultation(null, {
        name: newPatientName,
        age: parseInt(newPatientAge) || 0,
        profession: newPatientProfession,
        phone: newPatientPhone.trim() || undefined,
      }, chiefComplaint);
    } else {
      onStartConsultation(selectedPatientId, undefined, chiefComplaint);
    }
    
    // Reset form
    setIsNewPatient(false);
    setSelectedPatientId('');
    setNewPatientName('');
    setNewPatientAge('');
    setNewPatientProfession('');
    setNewPatientPhone('');
    setChiefComplaint('');
    onOpenChange(false);
  };

  const isValid = chiefComplaint.trim() && (isNewPatient ? newPatientName.trim() : selectedPatientId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-foreground">Nova Consulta</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          {/* Patient Selection Toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={!isNewPatient ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsNewPatient(false)}
              className="flex-1"
            >
              Paciente Existente
            </Button>
            <Button
              type="button"
              variant={isNewPatient ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsNewPatient(true)}
              className="flex-1"
            >
              Novo Paciente
            </Button>
          </div>

          {!isNewPatient ? (
            <div className="space-y-2">
              <Label htmlFor="patient-select">Selecionar Paciente</Label>
              <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um paciente..." />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.name} - {patient.age} anos
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-patient-name">Nome do Paciente *</Label>
                <Input
                  id="new-patient-name"
                  value={newPatientName}
                  onChange={(e) => setNewPatientName(e.target.value)}
                  placeholder="Nome completo"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="new-patient-age">Idade</Label>
                  <Input
                    id="new-patient-age"
                    type="number"
                    value={newPatientAge}
                    onChange={(e) => setNewPatientAge(e.target.value)}
                    placeholder="Ex: 35"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-patient-profession">Profissão</Label>
                  <Input
                    id="new-patient-profession"
                    value={newPatientProfession}
                    onChange={(e) => setNewPatientProfession(e.target.value)}
                    placeholder="Ex: Engenheiro"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-patient-phone">Telefone / WhatsApp <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <Input
                  id="new-patient-phone"
                  type="tel"
                  value={newPatientPhone}
                  onChange={(e) => setNewPatientPhone(e.target.value)}
                  placeholder="Ex: (11) 99999-9999"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="chief-complaint">Queixa Principal *</Label>
            <Textarea
              id="chief-complaint"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="Descreva a queixa principal do paciente..."
              className="min-h-[100px] resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" variant="medical" disabled={!isValid} className="flex-1">
              Iniciar Consulta
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
