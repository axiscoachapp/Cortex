import { useCallback, useEffect, useRef, useState } from 'react';
import { Save, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { clinicDate } from '@/lib/dates';
import { ENCOUNTER_TEMPLATES, validateWorkItem, WORK_KINDS, WorkKind } from '@/lib/clinicalWorkspace';
import type { Tables, Json } from '@/integrations/supabase/types';
type Item=Tables<'clinical_work_items'>;
function detailsOf(item?:Item):Record<string,string> {
 return item?.details && typeof item.details==='object' && !Array.isArray(item.details) ? Object.fromEntries(Object.entries(item.details).filter((entry):entry is [string,string]=>typeof entry[1]==='string')) : {};
}
export function ClinicalWorkEditor({item,patientId,userId,onSaved,onClose,onExitGuardChange}:{item?:Item;patientId:string;userId:string;onSaved:()=>void;onClose:()=>void;onExitGuardChange?:(guard:()=>boolean)=>void}) {
  const [kind,setKind]=useState<WorkKind>(item?.kind as WorkKind ?? 'draft');
  const [title,setTitle]=useState(item?.title ?? 'Consulta manual');
  const [content,setContent]=useState(item?.content ?? '');
  const [details,setDetails]=useState<Record<string,string>>(item?detailsOf(item):{date:clinicDate(),state:'active'});
  const [due,setDue]=useState(item?.due_date ?? '');
  const [saved,setSaved]=useState<Item|undefined>(item);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [medicationContext,setMedicationContext]=useState<{revision:number;medications:Array<{name:string;dosage:string;instructions:string}>}>();
  const [medicationError,setMedicationError]=useState('');
  const saving=useRef(false);
  const snapshot=JSON.stringify({kind,title,content,details,due});
  const [lastSaved,setLastSaved]=useState(item?snapshot:'');
  const locked=!!saved && ['approved','done'].includes(saved.status) && ['draft','instruction','medication'].includes(kind);
  const dirty=!locked && snapshot!==lastSaved && (!!content.trim() || title!=='Consulta manual');
  const canClose=useUnsavedChanges(dirty||busy,'Há alterações não salvas neste registro. Descartar e abrir outro?',{blocking:busy});
  useEffect(()=>{onExitGuardChange?.(()=>!busy&&canClose(false));},[busy,canClose,onExitGuardChange]);
  const loadMedicationContext=useCallback(async()=>{
    setMedicationError('');
    const {data,error:failure}=await supabase.from('patients').select('revision,medications').eq('id',patientId).eq('user_id',userId).single();
    if(failure||!data){setMedicationError('Não foi possível carregar a lista ativa. Atualize antes de aprovar a reconciliação.');return;}
    const medications=Array.isArray(data.medications)?data.medications.filter((entry):entry is {name:string;dosage:string;instructions:string}=>!!entry&&typeof entry==='object'&&!Array.isArray(entry)&&typeof entry.name==='string').map(entry=>({name:entry.name,dosage:typeof entry.dosage==='string'?entry.dosage:'',instructions:typeof entry.instructions==='string'?entry.instructions:''})):[];
    setMedicationContext({revision:data.revision,medications});
  },[patientId,userId]);
  useEffect(()=>{if(kind==='medication'&&!locked)void loadMedicationContext();},[kind,locked,loadMedicationContext]);
  const value=(key:string,text:string)=>setDetails(previous=>({...previous,[key]:text}));
  const save=async(approve=false):Promise<Item|undefined>=>{
    if(saving.current || locked) return saved;
    const invalid=validateWorkItem(kind,title,content,details);
    if(invalid){setError(invalid);return;}
    saving.current=true;setBusy(true);setError('');
    const savingSnapshot=snapshot;
    try {
      const patch={title:title.trim(),content,details:details as Json,due_date:due||null,status:approve?'approved':kind==='draft'||kind==='instruction'?'draft':'open'};
      const response=saved
        ? await supabase.from('clinical_work_items').update(patch).eq('id',saved.id).eq('revision',saved.revision).select().maybeSingle()
        : await supabase.from('clinical_work_items').insert({...patch,patient_id:patientId,user_id:userId,kind}).select().single();
      if(response.error||!response.data)throw new Error('Não foi possível salvar. O item pode ter sido alterado em outra sessão; seu texto permanece aqui.');
      setSaved(response.data);setLastSaved(savingSnapshot);setNotice(`Salvo às ${new Date().toLocaleTimeString('pt-BR')}`);onSaved();return response.data;
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar. Tente novamente.');}
    finally{saving.current=false;setBusy(false);}
  };
  // Only physician-authored manual drafts autosave. Approval is always an explicit action.
  useEffect(()=>{
    if(kind!=='draft'||!dirty||!content.trim()||busy||error)return;
    const timer=setTimeout(()=>{void save();},1200);return()=>clearTimeout(timer);
    // save captures the exact content/revision associated with this timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[snapshot,dirty,kind,busy,error]);
  const finalize=async()=>{
    const row=dirty||!saved?await save():saved;if(!row)return;
    if(!window.confirm('Confirmar e registrar exatamente este texto no prontuário?'))return;
    setBusy(true);setError('');
    try{
      const {error:failure}=await supabase.rpc('finalize_manual_encounter',{p_item_id:row.id,p_revision:row.revision});
      if(failure)throw failure;
      setLastSaved(snapshot);setSaved({...row,status:'done'});setNotice('Consulta revisada registrada. Nenhuma chamada de IA foi necessária.');onSaved();
    }catch{setError('Não foi possível confirmar a consulta. Seu rascunho continua salvo; recarregue o item para conferir a versão e tente novamente.');}
    finally{setBusy(false);}
  };
  const approveMedication=async()=>{
    if(!medicationContext||medicationError||busy)return;
    const row=dirty||!saved?await save():saved;if(!row)return;
    if(!window.confirm('Aprovar exatamente este medicamento, dose, instruções e estado na lista ativa do paciente?'))return;
    setBusy(true);setError('');
    try{
      const {data,error:failure}=await supabase.rpc('approve_medication_reconciliation',{p_item_id:row.id,p_item_revision:row.revision,p_patient_revision:medicationContext.revision});
      if(failure||data!==true)throw new Error('Conflict');
      setLastSaved(snapshot);setSaved({...row,status:'approved'});setNotice('Reconciliação aprovada. A lista ativa foi atualizada com o registro revisado.');onSaved();
      setMedicationContext(undefined);void loadMedicationContext();
    }catch{setError('A reconciliação não foi confirmada. Seu registro continua salvo; atualize e compare a lista ativa antes de tentar novamente.');}
    finally{setBusy(false);}
  };
  return <section className="rounded-xl border bg-card p-4 sm:p-6 space-y-4" aria-label="Editor clínico">
    <div className="flex items-center justify-between gap-3"><h2 className="font-serif text-2xl">{locked?'Versão registrada':'Documentar e acompanhar'}</h2><Button variant="ghost" disabled={busy} onClick={()=>{if(!busy&&canClose(false))onClose();}}>Fechar</Button></div>
    {error&&<p role="alert" className="text-sm text-destructive">{error} {dirty&&<button className="underline" onClick={()=>{setError('');void save();}}>Tentar salvar novamente</button>}</p>}
    <p role="status" className="text-xs text-muted-foreground">{busy?'Salvando…':dirty?'Alterações ainda não salvas':notice||'Conteúdo de autoria do médico. Revise antes de aprovar.'}</p>
    <div className="grid sm:grid-cols-2 gap-4"><label className="text-sm space-y-2"><span>Tipo de registro</span><select aria-label="Tipo de registro" className="w-full h-10 border rounded-md bg-background px-3" value={kind} disabled={!!saved||busy||!!details.previousVersionId} onChange={e=>{const next=e.target.value as WorkKind;setKind(next);setTitle(next==='medication'?'':WORK_KINDS[next]);}}>{Object.entries(WORK_KINDS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label className="text-sm space-y-2"><span>{kind==='medication'?'Nome do medicamento':'Título / assunto'}</span><Input aria-label="Título do registro" value={title} disabled={locked||busy} maxLength={200} onChange={e=>setTitle(e.target.value)}/></label></div>
    {kind==='draft'&&!locked&&<label className="text-sm flex flex-wrap items-center gap-3">Estrutura da consulta<select aria-label="Estrutura da consulta" disabled={busy} defaultValue="livre" className="h-10 rounded-md border bg-background px-3" onChange={e=>{if(!content.trim()||window.confirm('Substituir o texto pela estrutura selecionada?')){setContent(ENCOUNTER_TEMPLATES[e.target.value]);value('template',e.target.value);value('templateVersion','1');}}}><option value="livre">Texto livre</option><option value="ginecologia">Ginecologia</option><option value="prenatal">Pré-natal</option><option value="urologia">Urologia</option></select><span className="text-xs text-muted-foreground">Estruturas em branco; registre somente fatos confirmados.</span></label>}
    <label className="block text-sm space-y-2"><span>{kind==='draft'?'Texto exato da evolução':kind==='medication'?'Dose, via, frequência e instruções confirmadas':'Conteúdo / contexto / fonte'}</span><Textarea aria-label="Conteúdo do registro" value={content} disabled={locked||busy} maxLength={100000} onChange={e=>setContent(e.target.value)} className="min-h-48 leading-relaxed"/></label>
    {kind==='medication'&&<div className="rounded-lg bg-muted/40 p-3 space-y-2"><h3 className="text-xs font-semibold">Lista ativa para comparação</h3>{medicationError&&<p role="alert" className="text-xs text-destructive">{medicationError}</p>}{medicationContext?<ul className="text-xs space-y-1">{medicationContext.medications.length?medicationContext.medications.map((entry,index)=><li key={index}>{entry.name} · {entry.dosage} · {entry.instructions}</li>):<li>Nenhum medicamento ativo registrado.</li>}</ul>:<p className="text-xs">Carregando lista ativa…</p>}<Button size="sm" variant="outline" disabled={busy} onClick={loadMedicationContext}>Atualizar lista mantendo rascunho</Button><p className="text-xs text-muted-foreground">Salvar o registro não altera a lista ativa. A aprovação aplica somente este medicamento; os demais são preservados.</p></div>}
    {['observation','pregnancy','medication'].includes(kind)&&<div className="grid sm:grid-cols-2 gap-3">
      <label className="text-sm space-y-2"><span>{kind==='pregnancy'?'DPP confirmada pelo médico':kind==='medication'?'Data de início / alteração / suspensão':'Data do registro'}</span><Input type="date" aria-label="Data clínica" value={details.date??''} disabled={locked||busy} onChange={e=>value('date',e.target.value)}/></label>
      <label className="text-sm space-y-2"><span>Fonte / documento / consulta</span><Input aria-label="Fonte do registro" value={details.source??''} disabled={locked||busy} onChange={e=>value('source',e.target.value)}/></label>
      {kind==='observation'&&<><label className="text-sm">Valor<Input aria-label="Valor observado" disabled={locked||busy} inputMode="decimal" value={details.value??''} onChange={e=>value('value',e.target.value)}/></label><label className="text-sm">Unidade<Input aria-label="Unidade da observação" disabled={locked||busy} value={details.unit??''} onChange={e=>value('unit',e.target.value)}/></label></>}
      {kind==='medication'&&<label className="text-sm">Dose revisada<Input aria-label="Dose revisada" value={details.dosage??''} disabled={locked||busy} onChange={e=>value('dosage',e.target.value)}/></label>}
      {kind==='medication'&&<label className="text-sm">Estado<select aria-label="Estado do medicamento" disabled={locked||busy} className="w-full h-10 border rounded-md px-3 bg-background" value={details.state??'active'} onChange={e=>value('state',e.target.value)}><option value="active">Ativo</option><option value="changed">Alterado</option><option value="stopped">Suspenso</option></select></label>}
      {kind==='pregnancy'&&<p className="text-xs text-muted-foreground">Cada registro representa um episódio separado. A datação deve ser validada pelo médico; o sistema não infere a idade gestacional.</p>}
    </div>}
    {kind==='task'&&<div className="grid sm:grid-cols-2 gap-3">
      <label className="text-sm space-y-2">Fluxo<select aria-label="Fluxo de acompanhamento" disabled={busy} className="w-full h-10 border rounded-md px-3 bg-background" value={details.workflow??'result'} onChange={e=>{value('workflow',e.target.value);value('stage','requested');}}><option value="result">Resultado de exame</option><option value="referral">Encaminhamento</option><option value="followup">Retorno</option><option value="waitlist">Lista de espera</option><option value="confirmation">Confirmação de consulta</option></select></label>
      <label className="text-sm space-y-2">Prazo<Input aria-label="Prazo da tarefa" disabled={busy} type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
      <label className="text-sm space-y-2">Etapa<select aria-label="Etapa do acompanhamento" disabled={busy} className="w-full h-10 border rounded-md px-3 bg-background" value={details.stage??'requested'} onChange={e=>value('stage',e.target.value)}><option value="requested">Solicitado / aguardando</option>{['waitlist','confirmation'].includes(details.workflow)?<><option value="contacted">Contato realizado</option><option value="confirmed">Confirmado pelo paciente</option><option value="declined">Recusado pelo paciente</option></>:<><option value="received">Recebido</option><option value="reviewed">Revisado pelo médico</option><option value="acted">Conduta registrada</option></>}</select></label>
      {details.workflow==='waitlist'&&<label className="text-sm space-y-2">Preferência de disponibilidade<Input aria-label="Disponibilidade para lista de espera" value={details.availability??''} disabled={busy} onChange={e=>value('availability',e.target.value)}/></label>}
      {['waitlist','confirmation'].includes(details.workflow)&&<><label className="text-sm space-y-2">Canal do contato<select aria-label="Canal de confirmação" disabled={busy} className="w-full h-10 border rounded-md px-3 bg-background" value={details.channel??'phone'} onChange={e=>value('channel',e.target.value)}><option value="phone">Telefone</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="in_person">Presencial</option></select></label><p className="text-xs text-muted-foreground">Registre somente contatos e respostas efetivamente confirmados. Salvar este acompanhamento não envia mensagens nem reserva um horário. As versões preservam as alterações.</p></>}
    </div>}
    <div className="flex flex-wrap gap-2">
      {!locked&&<Button disabled={busy} onClick={()=>save(false)} className="gap-2"><Save className="h-4 w-4"/>Salvar{kind==='draft'?' rascunho':''}</Button>}
      {kind==='draft'&&!locked&&<Button variant="outline" disabled={busy||!content.trim()} onClick={finalize}><Check className="h-4 w-4 mr-2"/>Revisei: confirmar consulta</Button>}
      {kind==='instruction'&&!locked&&<Button variant="outline" disabled={busy} onClick={()=>save(true)}>Aprovar esta versão</Button>}
      {kind==='medication'&&!locked&&<Button variant="outline" disabled={busy||!medicationContext||!!medicationError} onClick={approveMedication}>Aprovar reconciliação</Button>}
      {locked&&['instruction','medication'].includes(kind)&&<><Button variant="outline" onClick={()=>{setDetails(previous=>({...Object.fromEntries(Object.entries(previous).filter(([key])=>!['reconciledAt','reconciledBy','patientRevisionBefore','consultationId','approvedAt'].includes(key))),previousVersionId:saved!.id,versionNumber:String(Number(previous.versionNumber??'1')+1)}));setSaved(undefined);setLastSaved('');setNotice('Nova versão em rascunho. A versão aprovada anterior foi preservada.');}}>Criar nova versão</Button>{kind==='instruction'&&<><Button onClick={()=>{const blob=new Blob([content],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='orientacoes-aprovadas.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Baixar versão aprovada</Button><span className="text-xs text-muted-foreground self-center">O download não confirma entrega ao paciente.</span></>}</>}
    </div>
  </section>;
}
