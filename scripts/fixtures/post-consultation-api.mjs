import assert from 'node:assert/strict';

export const postConsultationId='55555555-5555-4555-8555-000000000099';
export function createPostConsultationFixture({patientId,userId,drafts,visits,workItems,entries=false}){
  const initial=structuredClone(visits),initialWork=structuredClone(workItems),calls=[],writes=[];
  return {calls,writes,reset(){visits.splice(0,visits.length,...structuredClone(initial));workItems.splice(0,workItems.length,...structuredClone(initialWork));},read(req,url,input){
    if(entries&&url.pathname==='/rest/v1/clinical_work_items'&&req.method==='POST'){
      writes.push({body:structuredClone(input),accepted:false});
      const keys=['title','content','details','due_date','status','patient_id','user_id','kind'],d=input.details;
      const valid=input.patient_id===patientId&&input.user_id===userId&&Object.keys(input).every(k=>keys.includes(k))&&typeof input.title==='string'&&input.title.trim().length>0&&input.title.length<=200&&typeof input.content==='string'&&d&&d.state==='active'&&/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&Object.keys(d).every(k=>['state','date','workflow','stage'].includes(k))&&(input.due_date===null||/^\d{4}-\d{2}-\d{2}$/.test(input.due_date))&&
        (input.kind==='instruction'&&input.status==='draft'&&input.content.trim()||input.kind==='task'&&input.status==='open'&&d.workflow==='followup'&&d.stage==='requested');
      if(!valid)return {status:400,body:{error:'Unexpected synthetic work insert'}};
      const row={...structuredClone(input),id:'c7000000-0000-4000-8000-'+String(writes.length).padStart(12,'0'),revision:0,created_at:'2026-11-07T04:00:00Z',updated_at:'2026-11-07T04:00:00Z'};workItems.push(row);writes.at(-1).accepted=true;return {status:201,body:row};
    }
    if(url.pathname==='/functions/v1/signature-session/state'&&req.method==='GET')return {status:200,body:{configured:false,active:false,expiresAt:null}};
    if(url.pathname!=='/functions/v1/finalize-consultation')return null;
    calls.push({method:req.method,body:structuredClone(input),accepted:false});
    const draft=drafts.find(d=>d.patient_id===patientId);
    const allowed=['patientId','draftId','chiefComplaint','transcription','patientContext','userSpecialty','templateContent','saveDirect','reviewed','soapNote','whatsappMessage'];
    if(req.method!=='POST'||!draft||input.patientId!==patientId||input.draftId!==draft.id||input.saveDirect!==true||input.reviewed!==true||input.soapNote!==draft.content.soapDraft||Object.keys(input).some(key=>!allowed.includes(key)))return {status:400,body:{error:'Unexpected synthetic finalization'}};
    assert.ok(!visits.some(v=>v.id===postConsultationId),'Duplicate synthetic finalization');
    visits.push({...structuredClone(initial[0]),id:postConsultationId,soap_note:input.soapNote});drafts.splice(drafts.indexOf(draft),1);calls.at(-1).accepted=true;
    return {status:200,body:{consultationId:postConsultationId,soapNote:input.soapNote,whatsappMessage:'',profileUpdates:{diagnoses:[],medications:[],allergies:[]}}};
  }};
}
