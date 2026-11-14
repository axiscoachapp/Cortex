import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FileViewerDialog } from '@/components/FileViewerDialog';
import { fetchAllRows } from '@/lib/pagination';
import type { Patient } from '@/types/patient';

interface Proposal {
  id: string;
  kind: 'document' | 'history';
  title: string;
  createdAt: string;
  source: string;
  note: string;
  medicalHistory: string;
  socialAnamnesis: string;
  revision: number;
  storagePath?: string;
  mimeType?: string | null;
}
interface ProposalContext {
  patientRevision: number;
  medicalHistory: string;
  socialAnamnesis: string;
  proposals: Proposal[];
}
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => `- ${entry}`)
        .join('\n')
    : '';

export function ClinicalProposals({ patient, userId }: { patient: Patient; userId: string }) {
  const query = useQuery<ProposalContext>({
    queryKey: ['clinical-proposals', patient.id, userId],
    queryFn: async () => {
      const [profile, files, visits] = await Promise.all([
        supabase
          .from('patients')
          .select('revision,medical_history,social_anamnesis')
          .eq('id', patient.id)
          .eq('user_id', userId)
          .single(),
        fetchAllRows((from, to) =>
          supabase
            .from('patient_files')
            .select('id,file_name,created_at,ai_summary,ai_profile_proposal,storage_path,mime_type')
            .eq('patient_id', patient.id)
            .eq('user_id', userId)
            .eq('ai_review_status', 'pending')
            .not('ai_summary', 'is', null)
            .order('created_at', { ascending: false })
            .order('id')
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabase
            .from('consultations')
            .select('id,created_at,chief_complaint,soap_note,transcription,history_proposals,revision')
            .eq('patient_id', patient.id)
            .eq('user_id', userId)
            .neq('history_proposals', '{}')
            .order('created_at', { ascending: false })
            .order('id')
            .range(from, to),
        ),
      ]);
      if (profile.error || !profile.data) throw new Error('Context unavailable');
      const proposals: Proposal[] = files.map((file) => ({
        id: file.id,
        kind: 'document',
        title: file.file_name,
        createdAt: file.created_at,
        source: file.ai_summary ?? '',
        note: file.ai_profile_proposal ?? '',
        medicalHistory: '',
        socialAnamnesis: '',
        revision: 0,
        storagePath: file.storage_path,
        mimeType: file.mime_type,
      }));
      for (const visit of visits) {
        const history = visit.history_proposals;
        if (
          !history ||
          typeof history !== 'object' ||
          Array.isArray(history) ||
          history.review ||
          history.sourceConsultationId !== visit.id
        )
          continue;
        proposals.push({
          id: visit.id,
          kind: 'history',
          title: visit.chief_complaint || 'Histórico da consulta',
          createdAt: visit.created_at,
          source: `Evolução aprovada:\n${visit.soap_note ?? ''}\n\nTranscrição de origem:\n${visit.transcription ?? 'Não disponível'}`,
          note: '',
          medicalHistory: strings(history.medicalHistory),
          socialAnamnesis: strings(history.socialAnamnesis),
          revision: visit.revision,
        });
      }
      return {
        patientRevision: profile.data.revision,
        medicalHistory: profile.data.medical_history ?? '',
        socialAnamnesis: profile.data.social_anamnesis ?? '',
        proposals,
      };
    },
  });
  if (query.isError && !query.data)
    return (
      <div role="alert" className="m-4 border rounded-lg p-3 text-sm space-y-2">
        <p>Não foi possível carregar as revisões pendentes.</p>
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          Recarregar revisões
        </Button>
      </div>
    );
  if (!query.data?.proposals.length) return null;
  return (
    <section aria-label="Propostas clínicas para revisão" className="m-4 space-y-3">
      <div>
        <h2 className="font-semibold text-sm">Sugestões da IA aguardando a sua revisão</h2>
        {query.isError && (
          <p role="alert" className="text-xs text-destructive">
            Não foi possível atualizar esta lista. Seus textos continuam nos campos.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          A IA leu um documento anexado ou uma consulta e sugeriu um texto para o prontuário. Nada entra sem a sua
          aprovação: confira, ajuste se precisar e acrescente ou dispense.
        </p>
      </div>
      {query.data.proposals.map((proposal) => (
        <ProposalEditor
          key={`${patient.id}:${proposal.kind}:${proposal.id}`}
          proposal={proposal}
          context={query.data!}
          patientId={patient.id}
          userId={userId}
        />
      ))}
    </section>
  );
}

function ProposalEditor({
  proposal,
  context,
  patientId,
  userId,
}: {
  proposal: Proposal;
  context: ProposalContext;
  patientId: string;
  userId: string;
}) {
  const client = useQueryClient();
  const [note, setNote] = useState(proposal.note);
  const [medicalHistory, setMedicalHistory] = useState(proposal.medicalHistory);
  const [socialAnamnesis, setSocialAnamnesis] = useState(proposal.socialAnamnesis);
  const [reference, setReference] = useState({
    patientRevision: context.patientRevision,
    consultationRevision: proposal.revision,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // The original document is shown inside the app, in the viewer dialog.
  const [viewingSource, setViewingSource] = useState(false);
  const isDocument = proposal.kind === 'document';
  const hintId = useId();
  const dirty =
    note !== proposal.note ||
    medicalHistory !== proposal.medicalHistory ||
    socialAnamnesis !== proposal.socialAnamnesis;
  useUnsavedChanges(
    dirty || saving,
    saving
      ? 'A revisão está sendo salva. Aguarde a confirmação antes de sair.'
      : 'Há alterações na revisão. Descartar o texto não salvo?',
    { blocking: saving },
  );
  const decide = async (accepted: boolean) => {
    if (saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result =
        proposal.kind === 'document'
          ? await supabase.rpc('review_document_proposal', {
              p_file_id: proposal.id,
              p_expected_patient_revision: reference.patientRevision,
              p_note: note,
              p_accept: accepted,
            })
          : await supabase.rpc('review_history_proposal', {
              p_consultation_id: proposal.id,
              p_expected_patient_revision: reference.patientRevision,
              p_expected_consultation_revision: reference.consultationRevision,
              p_medical_history: medicalHistory,
              p_social_anamnesis: socialAnamnesis,
              p_accept: accepted,
            });
      if (result.error) throw result.error;
      await Promise.all([
        client.invalidateQueries({ queryKey: ['clinical-proposals', patientId, userId] }),
        client.invalidateQueries({ queryKey: ['patients', userId] }),
        client.invalidateQueries({ queryKey: ['patient-files', patientId] }),
        client.invalidateQueries({ queryKey: ['patient-detail', patientId] }),
        client.invalidateQueries({ queryKey: ['patient-clinical-notes', patientId] }),
        client.invalidateQueries({ queryKey: ['patient-consultations', patientId] }),
      ]);
    } catch {
      setError(
        'Não foi possível salvar. O prontuário pode ter mudado enquanto você revisava. Seu texto foi mantido: atualize e confira antes de tentar de novo.',
      );
    } finally {
      setSaving(false);
    }
  };
  const updateReference = async () => {
    if (saving) return;
    await client.invalidateQueries({ queryKey: ['clinical-proposals', patientId, userId] });
    const latest = client.getQueryData<ProposalContext>(['clinical-proposals', patientId, userId]);
    const source = latest?.proposals.find((item) => item.kind === proposal.kind && item.id === proposal.id);
    if (latest && source) {
      setReference({ patientRevision: latest.patientRevision, consultationRevision: source.revision });
      setError('');
      setNotice('Atualizado. Confira o que já está no prontuário e tente de novo; seu texto continua aqui.');
    }
  };
  const valid = isDocument ? !!note.trim() : !!medicalHistory.trim() || !!socialAnamnesis.trim();
  const date = new Date(proposal.createdAt).toLocaleDateString('pt-BR');
  const empty = isDocument ? !proposal.note.trim() : !proposal.medicalHistory.trim() && !proposal.socialAnamnesis.trim();
  return (
    <article className="rounded-xl border bg-background p-4 space-y-3" aria-label={`Revisar ${proposal.title}`}>
      <div>
        <h3 className="font-medium text-sm">{proposal.title}</h3>
        <p className="text-xs text-muted-foreground">
          {isDocument ? `Documento anexado em ${date}` : `Consulta de ${date}`}
        </p>
      </div>
      <p className="text-xs">
        {isDocument
          ? empty
            ? 'A IA leu este documento e não sugeriu anotação. Se quiser registrar algo sobre ele, escreva abaixo; se não, dispense.'
            : 'A IA leu este documento e sugere a anotação abaixo. Abra o documento, confira e ajuste o texto antes de acrescentar.'
          : 'A IA separou desta consulta os fatos abaixo para o histórico do paciente. Confira e ajuste o texto antes de acrescentar.'}
      </p>
      {proposal.storagePath && (
        <div>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => setViewingSource(true)}>
            Abrir o documento
          </Button>
          <FileViewerDialog
            open={viewingSource}
            onOpenChange={setViewingSource}
            file={{ storagePath: proposal.storagePath, fileName: proposal.title, mimeType: proposal.mimeType ?? null }}
          />
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer">
          {isDocument ? 'Ver o que a IA leu no documento' : 'Ver o texto da consulta'} e o que já está no prontuário
        </summary>
        <p className="font-medium mt-2">
          {isDocument ? 'Leitura da IA (ainda não revisada)' : 'Texto da consulta de origem'}
        </p>
        <pre className="whitespace-pre-wrap font-sans mt-1 max-h-64 overflow-auto">{proposal.source}</pre>
        <p className="font-medium mt-3">Já está no prontuário</p>
        <p className="whitespace-pre-wrap">{context.medicalHistory || 'Sem histórico médico registrado.'}</p>
        <p className="whitespace-pre-wrap">{context.socialAnamnesis || 'Sem anamnese social registrada.'}</p>
      </details>
      {isDocument ? (
        <label className="block text-xs space-y-1">
          Texto a acrescentar às notas clínicas
          <Textarea value={note} disabled={saving} maxLength={4000} onChange={(event) => setNote(event.target.value)} />
        </label>
      ) : (
        <>
          <label className="block text-xs space-y-1">
            Texto a acrescentar ao histórico médico
            <Textarea
              value={medicalHistory}
              disabled={saving}
              maxLength={8000}
              onChange={(event) => setMedicalHistory(event.target.value)}
            />
          </label>
          <label className="block text-xs space-y-1">
            Texto a acrescentar à anamnese social
            <Textarea
              value={socialAnamnesis}
              disabled={saving}
              maxLength={8000}
              onChange={(event) => setSocialAnamnesis(event.target.value)}
            />
          </label>
        </>
      )}
      {error && (
        <div role="alert" className="text-xs text-destructive space-y-2">
          <p>{error}</p>
          <Button size="sm" variant="outline" onClick={updateReference} disabled={saving}>
            Atualizar e manter meu texto
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide(true)} disabled={saving || !valid} aria-describedby={hintId}>
          {saving ? 'Salvando…' : 'Acrescentar ao prontuário'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide(false)} disabled={saving}>
          Dispensar sugestão
        </Button>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {valid
          ? 'Entra no prontuário exatamente o texto que estiver no campo.'
          : 'Para acrescentar, escreva o texto no campo acima.'}
        {isDocument && ' Dispensar não apaga o documento: ele continua em Arquivos.'}
      </p>
    </article>
  );
}
