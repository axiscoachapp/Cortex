import assert from 'node:assert/strict';

export const recoverySelect = 'id,patient_id,status,updated_at,patient:patients!draft_patient_owner_fk(id,name)';
export function createRecoveryNoticeFixture({userId,patients,drafts}) {
  const base=patients[0]; assert.ok(base && drafts.length);
  const otherIds=['aaaaaaaa-aaaa-4aaa-8aaa-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-000000000002'];
  for (const [index,id] of otherIds.entries()) {
    patients.push({...structuredClone(base),id,name:index ? 'Paciente sintético ' + 'NomeSemEspaços'.repeat(15) : 'Paciente sintético de revisão'});
    drafts.push({...structuredClone(drafts[0]),id:'bbbbbbbb-bbbb-4bbb-8bbb-00000000000'+index,patient_id:id,status:index?'processing':'review',discard_requested_at:null,
      content:{audioMimeType:'audio/webm',soapDraft:'Revisão sintética preservada',clarifications:[],originalComments:[],differentialDiagnoses:[],drugInteractionAlerts:[],transcriptionQuality:'good'}});
  }
  patients.push({...structuredClone(base),id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'PACIENTE_COM_EXCLUSAO_SOLICITADA',deletion_requested_at:'2026-11-06T12:00:00Z'});
  let mode='valid',localMode='valid'; const calls=[],localCalls=[],unexpected=[];
  const initialDrafts=structuredClone(drafts);
  return {
    calls,localCalls,unexpected,
    reset(){mode='valid';localMode='valid';drafts.splice(0,drafts.length,...structuredClone(initialDrafts));},
    setLocalMode(value){assert.ok(['valid','unavailable'].includes(value));localMode=value;},
    setMode(value){assert.ok(['valid','empty','unavailable'].includes(value));mode=value;},
    makeReview(patientId){const draft=drafts.find(row=>row.patient_id===patientId);assert.ok(draft);draft.status='review';draft.content={...draft.content,soapDraft:'Revisão sintética atualizada em outra aba',clarifications:[],originalComments:[],differentialDiagnoses:[],drugInteractionAlerts:[],transcriptionQuality:'good'};},
    read(req,url){
      if(url.pathname==='/rest/v1/patients'&&url.searchParams.get('select')==='id,name'&&url.searchParams.get('id')?.startsWith('in.')){
        const q=Object.fromEntries(url.searchParams);localCalls.push({method:req.method,query:q});
        if(req.method!=='GET'||Object.keys(q).length!==5||q.user_id!=='eq.'+userId||q.deletion_requested_at!=='is.null'||q.limit!=='51'||!/^in\.\([0-9a-f,-]+\)$/.test(q.id)){
          unexpected.push(localCalls.at(-1));return {status:400,body:{error:'Unexpected local metadata ownership read'}};
        }
        if(localMode==='unavailable')return {status:503,body:{error:'Synthetic local ownership unavailable'}};
        const ids=q.id.slice(4,-1).split(',');
        if(ids.length>50||ids.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))return {status:400,body:{error:'Invalid synthetic IDs'}};
        return {status:200,body:patients.filter(p=>p.user_id===userId&&!p.deletion_requested_at&&ids.includes(p.id)).map(({id,name})=>({id,name}))};
      }
      if(url.pathname!=='/rest/v1/consultation_drafts'||!url.searchParams.get('select')?.includes('patient:'))return null;
      calls.push({method:req.method,query:Object.fromEntries(url.searchParams)});
      const q=Object.fromEntries(url.searchParams);
      if(req.method!=='GET'||Object.keys(q).length!==6||q.select!==recoverySelect||q.user_id!=='eq.'+userId||q.discard_requested_at!=='is.null'||q.status!=='in.(processing,review,error)'||q.order!=='updated_at.desc,id.asc'||q.limit!=='51'){
        unexpected.push(calls.at(-1));return {status:400,body:{error:'Unexpected synthetic metadata read'}};
      }
      if(mode==='unavailable')return {status:503,body:{error:'Synthetic metadata unavailable'}};
      const rows=mode==='empty'?[]:drafts.filter(row=>row.user_id===userId&&!row.discard_requested_at&&['processing','review','error'].includes(row.status));
      return {status:200,body:rows.slice(0,51).map(row=>({id:row.id,patient_id:row.patient_id,status:row.status,updated_at:row.updated_at,patient:patients.filter(patient=>patient.user_id===userId).map(({id,name})=>({id,name})).find(patient=>patient.id===row.patient_id)??null}))};
    },
  };
}
