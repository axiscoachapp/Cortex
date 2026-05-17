import { useEffect, useState } from 'react';
import { FileText, Image, Upload, Calendar, User, Heart, Brain, Sparkles, Pencil, Check, X } from 'lucide-react';
import { SoapNoteView } from '@/components/SoapNoteView';
import { Patient } from '@/types/patient';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface PatientProfileDrawerProps {
  patient: Patient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AIInsights {
  symptoms?: string[];
  behavioral_observations?: string[];
  risk_factors?: string[];
  family_history?: string[];
  social_factors?: string[];
  clinical_changes?: string[];
  summary?: string;
}

interface Consultation {
  id: string;
  created_at: string;
  chief_complaint: string | null;
  soap_note: string | null;
}

const mockFiles = [
  { id: '1', name: 'Hemograma Completo.pdf', date: '15/10/2024', type: 'pdf', tag: 'Laboratório' },
  { id: '2', name: 'Foto Lesão Pele.jpg', date: '10/09/2024', type: 'image', tag: 'Imagem' },
  { id: '3', name: 'Receita Anterior.pdf', date: '01/08/2024', type: 'pdf', tag: 'Receita' },
];

export function PatientProfileDrawer({ patient, open, onOpenChange }: PatientProfileDrawerProps) {
  const [aiInsights, setAiInsights] = useState<AIInsights | null>(null);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [socialAnamnesis, setSocialAnamnesis] = useState('');
  const [medicalHistory, setMedicalHistory] = useState('');
  const [editingField, setEditingField] = useState<'social' | 'medical' | null>(null);
  const [draftValue, setDraftValue] = useState('');

  const { toast } = useToast();

  useEffect(() => {
    if (patient?.id && open) {
      loadPatientData();
      loadConsultations();
    }
  }, [patient?.id, open]);

  useEffect(() => {
    if (patient) {
      setSocialAnamnesis(patient.socialAnamnesis ?? '');
      setMedicalHistory(patient.medicalHistory ?? '');
    }
  }, [patient?.id]);

  const loadPatientData = async () => {
    if (!patient?.id) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('patients')
        .select('ai_insights, social_anamnesis, medical_history')
        .eq('id', patient.id)
        .single();

      if (data) {
        setAiInsights((data.ai_insights as AIInsights) || null);
        setSocialAnamnesis(data.social_anamnesis ?? '');
        setMedicalHistory(data.medical_history ?? '');
      }
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  };

  const loadConsultations = async () => {
    if (!patient?.id) return;
    const { data } = await supabase
      .from('consultations')
      .select('id, created_at, chief_complaint, soap_note')
      .eq('patient_id', patient.id)
      .order('created_at', { ascending: false });

    setConsultations(data ?? []);
  };

  const startEdit = (field: 'social' | 'medical') => {
    setEditingField(field);
    setDraftValue(field === 'social' ? socialAnamnesis : medicalHistory);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setDraftValue('');
  };

  const saveEdit = async (field: 'social' | 'medical') => {
    if (!patient?.id) return;
    const updateData = field === 'social'
      ? { social_anamnesis: draftValue }
      : { medical_history: draftValue };

    const { error } = await supabase
      .from('patients')
      .update(updateData)
      .eq('id', patient.id);

    if (error) {
      toast({ title: 'Erro ao salvar', variant: 'destructive' });
      return;
    }

    if (field === 'social') setSocialAnamnesis(draftValue);
    else setMedicalHistory(draftValue);
    setEditingField(null);
    toast({ title: 'Salvo com sucesso' });
  };

  if (!patient) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle className="flex items-center gap-3 text-lg">
            <div className="w-10 h-10 rounded-full bg-medical-blue-light border-2 border-medical-blue/30 flex items-center justify-center">
              <span className="text-medical-blue font-bold text-sm">
                {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </span>
            </div>
            <div>
              <span className="text-foreground truncate max-w-[200px] md:max-w-none">Dossiê: {patient.name}</span>
              <p className="text-sm font-normal text-muted-foreground">{patient.age} anos{patient.profession ? ` · ${patient.profession}` : ''}</p>
            </div>
          </SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="grid w-full grid-cols-3 mb-6 h-10">
            <TabsTrigger value="overview" className="text-xs sm:text-sm h-full">Geral</TabsTrigger>
            <TabsTrigger value="files" className="text-xs sm:text-sm h-full">Arquivos</TabsTrigger>
            <TabsTrigger value="history" className="text-xs sm:text-sm h-full">
              Histórico {consultations.length > 0 && `(${consultations.length})`}
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Visão Geral */}
          <TabsContent value="overview" className="space-y-6">
            {/* Social Anamnesis */}
            <EditableSection
              icon={<User className="w-4 h-4 text-medical-blue" />}
              iconBg="bg-medical-blue-light"
              title="Anamnese Social"
              value={socialAnamnesis}
              isEditing={editingField === 'social'}
              draftValue={draftValue}
              onEdit={() => startEdit('social')}
              onCancel={cancelEdit}
              onSave={() => saveEdit('social')}
              onDraftChange={setDraftValue}
              placeholder="Adicione informações sociais do paciente (estado civil, trabalho, hábitos...)"
            />

            {/* Medical History */}
            <EditableSection
              icon={<Heart className="w-4 h-4 text-success" />}
              iconBg="bg-success/10"
              title="Histórico Médico"
              value={medicalHistory}
              isEditing={editingField === 'medical'}
              draftValue={draftValue}
              onEdit={() => startEdit('medical')}
              onCancel={cancelEdit}
              onSave={() => saveEdit('medical')}
              onDraftChange={setDraftValue}
              placeholder="Adicione o histórico médico do paciente (cirurgias, doenças preexistentes, histórico familiar...)"
            />

            {/* AI Insights */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground">Insights da IA</h3>
              </div>
              {loading ? (
                <div className="pl-10 p-4 rounded-lg bg-secondary/50 border border-border">
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                </div>
              ) : aiInsights && Object.keys(aiInsights).length > 0 ? (
                <div className="pl-10 space-y-4">
                  {aiInsights.summary && (
                    <div className="p-4 rounded-lg bg-medical-blue-light/30 border border-medical-blue/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-medical-blue" />
                        <span className="text-xs font-semibold text-medical-blue uppercase">Resumo</span>
                      </div>
                      <p className="text-sm text-foreground/90 leading-relaxed">{aiInsights.summary}</p>
                    </div>
                  )}
                  {aiInsights.symptoms && aiInsights.symptoms.length > 0 && (
                    <InsightList title="Sintomas" items={aiInsights.symptoms} bullet="•" bulletColor="text-medical-blue" />
                  )}
                  {aiInsights.behavioral_observations && aiInsights.behavioral_observations.length > 0 && (
                    <InsightList title="Observações Comportamentais" items={aiInsights.behavioral_observations} bullet="•" bulletColor="text-medical-blue" />
                  )}
                  {aiInsights.risk_factors && aiInsights.risk_factors.length > 0 && (
                    <InsightList title="Fatores de Risco" items={aiInsights.risk_factors} bullet="⚠️" bulletColor="text-destructive" />
                  )}
                  {aiInsights.family_history && aiInsights.family_history.length > 0 && (
                    <InsightList title="Histórico Familiar" items={aiInsights.family_history} bullet="•" bulletColor="text-medical-blue" />
                  )}
                  {aiInsights.social_factors && aiInsights.social_factors.length > 0 && (
                    <InsightList title="Fatores Sociais" items={aiInsights.social_factors} bullet="•" bulletColor="text-medical-blue" />
                  )}
                  {aiInsights.clinical_changes && aiInsights.clinical_changes.length > 0 && (
                    <InsightList title="Mudanças Clínicas" items={aiInsights.clinical_changes} bullet="✓" bulletColor="text-success" />
                  )}
                </div>
              ) : (
                <div className="pl-10 p-4 rounded-lg bg-secondary/50 border border-border">
                  <p className="text-sm text-muted-foreground">
                    Nenhum insight gerado ainda. Adicione notas clínicas no painel lateral direito para gerar insights automáticos.
                  </p>
                </div>
              )}
            </section>
          </TabsContent>

          {/* Tab 2: Arquivos & Exames */}
          <TabsContent value="files" className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-foreground">Arquivos Anexados</h3>
              <Button variant="outline" size="sm" className="gap-2">
                <Upload className="w-4 h-4" />
                Upload Arquivo
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {mockFiles.map((file) => (
                <div
                  key={file.id}
                  className="p-4 rounded-lg border border-border bg-card hover:bg-secondary/30 transition-colors cursor-pointer group"
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'w-10 h-10 rounded-lg flex items-center justify-center',
                      file.type === 'pdf' ? 'bg-destructive/10' : 'bg-medical-blue-light',
                    )}>
                      {file.type === 'pdf'
                        ? <FileText className="w-5 h-5 text-destructive" />
                        : <Image className="w-5 h-5 text-medical-blue" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-medical-blue transition-colors">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">{file.date}</p>
                      <Badge variant="outline" className="mt-2 text-xs">{file.tag}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* Tab 3: Histórico de Consultas */}
          <TabsContent value="history" className="space-y-4">
            <h3 className="font-semibold text-foreground">Histórico de Consultas</h3>
            {consultations.length === 0 ? (
              <div className="p-6 text-center rounded-lg border border-border bg-card">
                <p className="text-sm text-muted-foreground">Nenhuma consulta registrada ainda.</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-border" />
                <div className="space-y-4">
                  {consultations.map((consultation, index) => {
                    const isFirst = index === 0;
                    const isExpanded = expandedId === consultation.id;
                    const date = new Date(consultation.created_at).toLocaleDateString('pt-BR', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                    });
                    return (
                      <div key={consultation.id} className="relative pl-10">
                        <div className={cn(
                          'absolute left-2 top-1 w-4 h-4 rounded-full border-2 bg-background',
                          isFirst ? 'border-medical-blue bg-medical-blue' : 'border-muted-foreground/30',
                        )}>
                          {isFirst && <span className="absolute inset-0 animate-ping rounded-full bg-medical-blue opacity-50" />}
                        </div>
                        <div className={cn(
                          'p-4 rounded-lg border',
                          isFirst ? 'border-medical-blue/30 bg-medical-blue-light/50' : 'border-border bg-card',
                        )}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm font-medium text-foreground">{date}</span>
                              {isFirst && (
                                <Badge className="bg-medical-blue text-primary-foreground text-xs">Última</Badge>
                              )}
                            </div>
                            {consultation.soap_note && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setExpandedId(isExpanded ? null : consultation.id)}
                              >
                                {isExpanded ? 'Ocultar' : 'Ver SOAP'}
                              </Button>
                            )}
                          </div>
                          {consultation.chief_complaint && (
                            <p className="text-sm text-muted-foreground">
                              <span className="font-medium text-foreground">Queixa:</span> {consultation.chief_complaint}
                            </p>
                          )}
                          {isExpanded && consultation.soap_note && (
                            <div className="mt-3 pt-3 border-t border-border/50">
                              <SoapNoteView text={consultation.soap_note} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

interface EditableSectionProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  value: string;
  isEditing: boolean;
  draftValue: string;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDraftChange: (v: string) => void;
  placeholder: string;
}

function EditableSection({
  icon, iconBg, title, value, isEditing, draftValue,
  onEdit, onCancel, onSave, onDraftChange, placeholder,
}: EditableSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', iconBg)}>
            {icon}
          </div>
          <h3 className="font-semibold text-foreground">{title}</h3>
        </div>
        {!isEditing && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>

      {isEditing ? (
        <div className="pl-10 space-y-2">
          <Textarea
            value={draftValue}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={placeholder}
            className="min-h-[100px] text-sm resize-none"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" variant="medical" onClick={onSave} className="gap-1.5">
              <Check className="w-3.5 h-3.5" />
              Salvar
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} className="gap-1.5">
              <X className="w-3.5 h-3.5" />
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <p className={cn(
          'text-sm leading-relaxed pl-10',
          value ? 'text-muted-foreground' : 'text-muted-foreground/50 italic',
        )}>
          {value || placeholder}
        </p>
      )}
    </section>
  );
}

function InsightList({ title, items, bullet, bulletColor }: {
  title: string; items: string[]; bullet: string; bulletColor: string;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">{title}</h4>
      <ul className="space-y-1">
        {items.map((item, idx) => (
          <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2">
            <span className={bulletColor}>{bullet}</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
