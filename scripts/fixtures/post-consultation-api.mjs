import assert from 'node:assert/strict';

export const postConsultationId='55555555-5555-4555-8555-000000000099';
export function createPostConsultationFixture({patientId,drafts,visits}){
  const initial=structuredClone(visits),calls=[];
  return {calls,reset(){visits.splice(0,visits.length,...structuredClone(initial));},read(req,url,input){
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
