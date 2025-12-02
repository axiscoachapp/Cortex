import { useEffect, useState } from 'react';
import { X, FileText, Image, Upload, Clock, Calendar, User, Heart, Brain, Sparkles } from 'lucide-react';
import { Patient } from '@/types/patient';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

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

const mockSocialAnamnesis = `Paciente casado, 2 filhos. Trabalha como Professor (alto estresse). Não tabagista. Etilista social. Pratica caminhada 2x por semana. Alimentação irregular devido à rotina de trabalho.`;

const mockMedicalHistory = `Cirurgia de apêndice em 2015. Histórico familiar de diabetes (Mãe). Pai com hipertensão controlada. Nega doenças cardíacas na família. Vacinação em dia.`;

const mockAISummary = `João iniciou acompanhamento em outubro/2024 com queixa principal de insônia persistente e sintomas ansiosos associados ao estresse laboral. Após avaliação inicial, foi diagnosticado com Episódio Depressivo Moderado (F32.1) e Insônia não-orgânica (G47.0). 

Iniciou tratamento com Sertralina 50mg com boa tolerância. Apresentou melhora progressiva do humor nas primeiras 4 semanas. Zolpidem 10mg foi prescrito para uso eventual nos episódios de insônia mais intensa.

Pontos de atenção: monitorar ganho de peso (efeito colateral potencial da Sertralina) e avaliar necessidade de ajuste de dose na próxima consulta. Paciente demonstra boa adesão ao tratamento e insight preservado sobre sua condição.`;

const mockFiles = [
  { id: '1', name: 'Hemograma Completo.pdf', date: '15/10/2024', type: 'pdf', tag: 'Laboratório' },
  { id: '2', name: 'Foto Lesão Pele.jpg', date: '10/09/2024', type: 'image', tag: 'Imagem' },
  { id: '3', name: 'Receita Anterior.pdf', date: '01/08/2024', type: 'pdf', tag: 'Receita' },
];

const mockTimeline = [
  { id: '1', date: '30/11/2024', title: 'Retorno (Atual)', status: 'atual', reason: 'Acompanhamento mensal' },
  { id: '2', date: '15/10/2024', title: 'Primeira Consulta', status: 'concluida', reason: 'Insônia e Ansiedade' },
];

export function PatientProfileDrawer({ patient, open, onOpenChange }: PatientProfileDrawerProps) {
  const [aiInsights, setAiInsights] = useState<AIInsights | null>(null);
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (patient?.id && open) {
      loadPatientData();
    }
  }, [patient?.id, open]);

  const loadPatientData = async () => {
    if (!patient?.id) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('clinical_notes, ai_insights')
        .eq('id', patient.id)
        .single();

      if (error) throw error;

      if (data) {
        setClinicalNotes(data.clinical_notes || '');
        setAiInsights((data.ai_insights as AIInsights) || null);
      }
    } catch (error) {
      console.error('Error loading patient data:', error);
    } finally {
      setLoading(false);
    }
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
              <span className="text-foreground">Dossiê do Paciente: {patient.name}</span>
              <p className="text-sm font-normal text-muted-foreground">{patient.age} anos • {patient.profession}</p>
            </div>
          </SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="overview" className="text-xs sm:text-sm">Visão Geral</TabsTrigger>
            <TabsTrigger value="files" className="text-xs sm:text-sm">Arquivos & Exames</TabsTrigger>
            <TabsTrigger value="history" className="text-xs sm:text-sm">Histórico</TabsTrigger>
          </TabsList>

          {/* Tab 1: Visão Geral */}
          <TabsContent value="overview" className="space-y-6">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-medical-blue-light flex items-center justify-center">
                  <User className="w-4 h-4 text-medical-blue" />
                </div>
                <h3 className="font-semibold text-foreground">Anamnese Social</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed pl-10">
                {mockSocialAnamnesis}
              </p>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-success-light flex items-center justify-center">
                  <Heart className="w-4 h-4 text-success" />
                </div>
                <h3 className="font-semibold text-foreground">Histórico Médico</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed pl-10">
                {mockMedicalHistory}
              </p>
            </section>

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
                      <p className="text-sm text-foreground/90 leading-relaxed">
                        {aiInsights.summary}
                      </p>
                    </div>
                  )}

                  {aiInsights.symptoms && aiInsights.symptoms.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Sintomas</h4>
                      <ul className="space-y-1">
                        {aiInsights.symptoms.map((symptom, idx) => (
                          <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-medical-blue">•</span>
                            {symptom}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiInsights.behavioral_observations && aiInsights.behavioral_observations.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Observações Comportamentais</h4>
                      <ul className="space-y-1">
                        {aiInsights.behavioral_observations.map((obs, idx) => (
                          <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-medical-blue">•</span>
                            {obs}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiInsights.risk_factors && aiInsights.risk_factors.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Fatores de Risco</h4>
                      <ul className="space-y-1">
                        {aiInsights.risk_factors.map((risk, idx) => (
                          <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-destructive">⚠️</span>
                            {risk}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiInsights.family_history && aiInsights.family_history.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Histórico Familiar</h4>
                      <ul className="space-y-1">
                        {aiInsights.family_history.map((history, idx) => (
                          <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-medical-blue">•</span>
                            {history}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiInsights.social_factors && aiInsights.social_factors.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Fatores Sociais</h4>
                      <ul className="space-y-1">
                        {aiInsights.social_factors.map((factor, idx) => (
                          <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-medical-blue">•</span>
                            {factor}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiInsights.clinical_changes && aiInsights.clinical_changes.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Mudanças Clínicas</h4>
                      <ul className="space-y-1">
                        {aiInsights.clinical_changes.map((change, idx) => (
                          <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2">
                            <span className="text-success">✓</span>
                            {change}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="pl-10 p-4 rounded-lg bg-secondary/50 border border-border">
                  <p className="text-sm text-muted-foreground">
                    Nenhum insight gerado ainda. Adicione notas clínicas no painel lateral direito para gerar insights automáticos com IA.
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
                      file.type === 'pdf' ? 'bg-destructive/10' : 'bg-medical-blue-light'
                    )}>
                      {file.type === 'pdf' ? (
                        <FileText className="w-5 h-5 text-destructive" />
                      ) : (
                        <Image className="w-5 h-5 text-medical-blue" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-medical-blue transition-colors">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">{file.date}</p>
                      <Badge variant="outline" className="mt-2 text-xs">
                        {file.tag}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* Tab 3: Histórico de Consultas */}
          <TabsContent value="history" className="space-y-4">
            <h3 className="font-semibold text-foreground">Histórico de Consultas</h3>

            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-border" />

              <div className="space-y-4">
                {mockTimeline.map((item, index) => (
                  <div key={item.id} className="relative pl-10">
                    {/* Timeline dot */}
                    <div className={cn(
                      'absolute left-2 top-1 w-4 h-4 rounded-full border-2 bg-background',
                      item.status === 'atual' 
                        ? 'border-medical-blue bg-medical-blue' 
                        : 'border-muted-foreground/30'
                    )}>
                      {item.status === 'atual' && (
                        <span className="absolute inset-0 animate-ping rounded-full bg-medical-blue opacity-50" />
                      )}
                    </div>

                    <div className={cn(
                      'p-4 rounded-lg border',
                      item.status === 'atual' 
                        ? 'border-medical-blue/30 bg-medical-blue-light/50' 
                        : 'border-border bg-card'
                    )}>
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">{item.date}</span>
                        {item.status === 'atual' && (
                          <Badge className="bg-medical-blue text-primary-foreground text-xs">
                            Em andamento
                          </Badge>
                        )}
                      </div>
                      <p className="font-semibold text-foreground">{item.title}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        <span className="font-medium">Motivo:</span> {item.reason}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
