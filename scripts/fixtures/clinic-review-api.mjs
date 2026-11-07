// Loopback-only synthetic API for browser regression tests. Never use real keys/data.
import http from 'node:http';
import { z } from 'zod';
import { createRecoveryNoticeFixture, recoverySelect } from './recovery-notice-api.mjs';
import { createSchedulingFixture } from './scheduling-migration-api.mjs';
export const uid='11111111-1111-4111-8111-111111111111';
export const patientId='22222222-2222-4222-8222-222222222222';
export async function startClinicFixture({ appointments = [], lastVisit = null, workspaceDates = false, patientWorkspaceReview = false, recoveryNoticeReview = false, schedulingReview = false, medicalUI = false, delegationPermissions = false, delegationDecisions = false, delegationReplay = false, mfaReview = false, mfaCleanupReview = false, mfaEnrollmentReview = false, mfaCancellationReview = false } = {}) {
  if(patientWorkspaceReview&&!workspaceDates)throw new Error('Patient workspace review requires workspace display data');
  if(recoveryNoticeReview&&(!workspaceDates||patientWorkspaceReview))throw new Error('Recovery notice review requires its isolated workspace fixture');
  if(schedulingReview&&(!workspaceDates||patientWorkspaceReview||recoveryNoticeReview))throw new Error('Scheduling review requires its isolated workspace fixture');
  let patientWorkspaceDenied=false;
  if(delegationDecisions&&!delegationPermissions)throw new Error('Delegation decisions require the permissions fixture');
  if(delegationReplay&&(!delegationPermissions||!delegationDecisions))throw new Error('Delegation replay requires the permissions and decision fixtures');
  if(mfaReview&&(workspaceDates||medicalUI||delegationPermissions||delegationDecisions||delegationReplay))throw new Error('MFA review is an isolated fixture');
  if(mfaCleanupReview&&!mfaReview)throw new Error('MFA cleanup review requires its MFA read fixture');
  if(mfaEnrollmentReview&&(!mfaReview||mfaCleanupReview))throw new Error('MFA enrollment requires isolated MFA reads without cleanup-denial mode');
  if(mfaCancellationReview&&!mfaEnrollmentReview)throw new Error('MFA cancellation requires the isolated enrollment fixture');
  const now=new Date().toISOString();
  const user={id:uid,email:'review@example.invalid',aud:'authenticated',role:'authenticated',created_at:now,email_confirmed_at:now,app_metadata:{provider:'email'},user_metadata:{},factors:[]};
  if(mfaReview)user.factors=['verified','verified','unverified'].map((status,index)=>({id:['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'][index],friendly_name:'Autenticador sintético '+['A','B','pendente'][index],factor_type:'totp',status,created_at:'2026-11-05T12:00:00Z',updated_at:'2026-11-05T12:00:00Z'}));
  const initialMfaFactors=structuredClone(user.factors),newMfaFactorId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const token=[{alg:'HS256',typ:'JWT'},{sub:uid,role:'authenticated',aud:'authenticated',aal:'aal1',exp:Math.floor(Date.now()/1000)+86400,iat:Math.floor(Date.now()/1000)}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.synthetic-signature';
  const patients=[{id:patientId,user_id:uid,name:'Paciente Exemplo A',age:0,date_of_birth:null,revision:0,profession:'',last_visit:lastVisit,status:'retorno',diagnoses:[],medications:[],allergies:[],clinical_notes:'',medical_history:'',social_anamnesis:'',phone:null,email:null,cpf:null,sex:null,health_insurance:null,archived_at:null}];
  const templates=[{id:'44444444-4444-4444-8444-444444444444',user_id:null,name:'Modelo sintético SOAP',description:'Estrutura para revisão visual',content:'**S (Subjetivo):** relato\n\n**O (Objetivo):** achados\n\n**A:** avaliação\n\n**P:** plano',created_at:now}];
  const settings={user_id:uid,specialty:'geral',daily_credit_limit:1500,live_copilot_enabled:false,doctor_name:'Profissional de Demonstração',crm_number:'00000',crm_uf:'PR',professional_address:'Ambiente sintético',active_template_id:null};
  const visits=[{id:'55555555-5555-4555-8555-555555555555',patient_id:patientId,user_id:uid,created_at:now,chief_complaint:'Consulta sintética',soap_note:'**S (Subjetivo):** relato sintético\n\n- Item revisado',revision:0}];
  const workItems=workspaceDates?[{id:'66666666-6666-4666-8666-666666666666',user_id:uid,patient_id:patientId,kind:'draft',status:'draft',title:'Registro sintético de horários',content:'Conteúdo sintético para revisão visual.',details:{},revision:1,due_date:null,updated_at:'2026-11-05T18:04:38Z'}]:[];
  const workRevisions=workspaceDates?[{id:'77777777-7777-4777-8777-777777777777',user_id:uid,item_id:workItems[0].id,revision:1,snapshot:{title:'Registro sintético anterior',content:'Versão sintética anterior.'},created_at:'2026-11-05T16:02:49Z'}]:[];
  const recordRevisions=workspaceDates?[{id:'88888888-8888-4888-8888-888888888888',patient_id:patientId,record_id:visits[0].id,revision:1,snapshot:{soap_note:'Versão sintética da consulta.'},created_at:'2026-11-05T19:05:51Z'}]:[];
  const drafts=workspaceDates?[{id:'99999999-9999-4999-8999-999999999999',user_id:uid,patient_id:patientId,status:'error',chief_complaint:'Consulta sintética recuperável',audio_storage_path:null,content:{audioMimeType:'audio/webm'},updated_at:'2026-11-05T17:03:27Z'}]:[];
  const recoveryNotice=recoveryNoticeReview?createRecoveryNoticeFixture({userId:uid,patients,drafts}):null;
  const scheduling=schedulingReview?createSchedulingFixture({userId:uid,patients,workItems}):null;
  const displayData={workItems,workRevisions,recordRevisions,drafts};
  if(medicalUI){
    templates.push({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',user_id:uid,name:'Modelo de revisão sintético',description:'Estrutura sintética particular',content:'Texto sintético do modelo.',created_at:'2026-11-04T12:00:00Z'});
    visits[0].created_at='2026-10-01T12:00:00Z';
    visits.push({...visits[0],id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',created_at:'2025-10-01T12:00:00Z',chief_complaint:'Consulta anterior sintética'});
  }
  const turns=[];const knowledge=medicalUI?[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',user_id:uid,title:'Fonte sintética revisada',source_text:'Texto original sintético para revisão visual.',source_reference:'Referência sintética',source_version:'2026',char_count:44,source_type:'text',status:'ready',review_status:'approved',created_at:'2026-11-04T18:20:31Z',reviewed_at:'2026-11-04T19:21:45Z',reviewer_name:'Profissional de Demonstração',indexed_at:'2026-11-04T19:22:48Z',supersedes_document_id:null}]:[];
  const metrics={briefings:0,checklists:0,chat:0,newSources:0,patientWrites:0,appointmentWrites:0,...(workspaceDates?{workspaceWrites:0}:{}),...(medicalUI?{medicalWrites:0}:{}),...(delegationPermissions?{delegationCalls:[],delegationRequests:[],delegationUnexpected:[]}:{}) ,...(delegationDecisions?{delegationWrites:[],delegationAttempts:[]}:{}) ,...(delegationReplay?{delegationReplies:[]}:{})};
  if(patientWorkspaceReview)metrics.patientWorkspaceReads=[];
  const medicalData={patients,templates,visits,knowledge,settings};
  if(mfaReview)Object.assign(metrics,{mfaRequests:[],mfaUnexpected:[]});
  const mfaAllowed=new Set(['POST /auth/v1/token','GET /auth/v1/user']);
  const mfaPendingPath=mfaReview?'/auth/v1/factors/'+user.factors[2].id:null;
  if(mfaCleanupReview){metrics.mfaCleanupCalls=[];mfaAllowed.add('DELETE '+mfaPendingPath);}
  if(mfaEnrollmentReview){metrics.mfaEnrollmentCalls=[];mfaAllowed.add('DELETE '+mfaPendingPath);mfaAllowed.add('POST /auth/v1/factors');}
  if(mfaCancellationReview)mfaAllowed.add('DELETE /auth/v1/factors/'+newMfaFactorId);
  const mfaEnrollmentInput=z.object({friendly_name:z.string().trim().min(1).max(200),factor_type:z.literal('totp'),issuer:z.literal('Haddad Nicola')}).strict();
  let delegationReadMode='valid';
  const delegationAllowed=new Set(['POST /auth/v1/token','GET /auth/v1/user','POST /rest/v1/rpc/clinic_access','POST /rest/v1/rpc/reception_delegation_requests']);
  if(delegationDecisions)for(const name of ['reception_decide_delegation','reception_revoke_delegation'])delegationAllowed.add('POST /rest/v1/rpc/'+name);
  const delegationRows=delegationPermissions?[
    {id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',staffId:'77777777-7777-4777-8777-777777777777',staffName:'Recepção pendente',state:'pending',revision:1,effective:false,canDecide:true,canRevoke:false},
    {id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',staffId:'88888888-8888-4888-8888-888888888888',staffName:'Recepção aprovada',state:'approved',revision:2,effective:true,canDecide:false,canRevoke:true},
    {id:'ffffffff-ffff-4fff-8fff-ffffffffffff',staffId:'99999999-9999-4999-8999-999999999999',staffName:'Recepção sem acesso',state:'approved',revision:2,effective:false,canDecide:false,canRevoke:true},
  ].map(row=>({...row,clinicId:'66666666-6666-4666-8666-666666666666',clinicName:'Clínica sintética',doctorId:uid,doctorName:'Profissional de Demonstração',createdAt:'2026-11-05T14:00:00Z',capabilityVersion:'clinic_reception_v1',canCancel:false})):[];
  const initialDelegations=structuredClone(delegationRows);
  const delegationReceipts=new Map(),lostDelegationReplies=new Set();
  const changeFields={p_request:z.string().uuid(),p_revision:z.number().int().positive(),p_operation:z.string().uuid()};
  const approveInput=z.object({...changeFields,p_decision:z.literal('approve')}).strict(),revokeInput=z.object(changeFields).strict();
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');let raw='';for await(const chunk of req)raw+=chunk;
    const input=raw?JSON.parse(raw):{};
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':mfaCleanupReview||mfaEnrollmentReview?'GET,POST,DELETE,OPTIONS':'GET,POST,PATCH,HEAD,OPTIONS','Content-Type':'application/json','Access-Control-Expose-Headers':'content-range'};
    const send=(data,status=200)=>{res.writeHead(status,headers);res.end(JSON.stringify(data));};
    if(req.method==='OPTIONS')return send({});
    if(mfaReview){
      const call={method:req.method,path:url.pathname};metrics.mfaRequests.push(call);
      if(!mfaAllowed.has(call.method+' '+call.path)){metrics.mfaUnexpected.push(call);return send({code:'TEST_UNEXPECTED_RESOURCE',message:'Unexpected MFA test resource'},403);}
      if(mfaCleanupReview&&call.method==='DELETE'&&call.path===mfaPendingPath){metrics.mfaCleanupCalls.push({factorId:user.factors[2].id,status:403});return send({code:'insufficient_aal',message:'Synthetic pending factor cleanup denied'},403);}
      if(mfaEnrollmentReview&&call.method==='DELETE'&&(call.path===mfaPendingPath||mfaCancellationReview&&call.path==='/auth/v1/factors/'+newMfaFactorId)){
        const index=user.factors.findIndex(factor=>call.path==='/auth/v1/factors/'+factor.id&&factor.status==='unverified');
        if(index<0)return send({code:'TEST_MFA_ORDER',message:'Synthetic pending setup already removed'},409);
        const [removed]=user.factors.splice(index,1);metrics.mfaEnrollmentCalls.push({kind:'remove',factorId:removed.id});return send({id:removed.id});
      }
      if(mfaEnrollmentReview&&call.method==='POST'&&call.path==='/auth/v1/factors'){
        const parsed=mfaEnrollmentInput.safeParse(input);if(!parsed.success)return send({code:'TEST_INVALID_INPUT',message:'Invalid synthetic enrollment'},400);
        if(user.factors.some(factor=>factor.status==='unverified'))return send({code:'TEST_MFA_ORDER',message:'Synthetic flow requires cleanup before enrollment'},409);
        const factor={...initialMfaFactors[2],id:newMfaFactorId,friendly_name:parsed.data.friendly_name};user.factors.push(factor);
        metrics.mfaEnrollmentCalls.push({kind:'enroll',factorId:factor.id,args:parsed.data});
        return send({id:factor.id,type:'totp',friendly_name:factor.friendly_name,totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg" width="208" height="208" viewBox="0 0 208 208"><rect width="208" height="208" fill="white"/><text x="20" y="104" fill="black">SYNTHETIC ONLY</text></svg>',secret:'SYNTHETIC-NOT-A-REAL-SECRET'}});
      }
    }
    if(delegationPermissions){
      const call={method:req.method,path:url.pathname};metrics.delegationRequests.push(call);
      if(!delegationAllowed.has(call.method+' '+call.path)){metrics.delegationUnexpected.push(call);return send({code:'TEST_UNEXPECTED_RESOURCE',message:'Unexpected delegation test resource'},403);}
    }
    if(delegationPermissions && url.pathname==='/rest/v1/rpc/reception_delegation_requests'){
      metrics.delegationCalls.push({args:input,mode:delegationReadMode});
      if(delegationReadMode==='denied')return send({code:'42501',message:'Synthetic delegation read denied'},403);
      return send(delegationReadMode==='invalid'?[]:{canManage:false,items:delegationRows,nextCursor:null});
    }
    if(delegationDecisions && ['/rest/v1/rpc/reception_decide_delegation','/rest/v1/rpc/reception_revoke_delegation'].includes(url.pathname)){
      const approve=url.pathname.endsWith('/reception_decide_delegation'),parsed=(approve?approveInput:revokeInput).safeParse(input);
      if(!parsed.success)return send({code:'22023',message:'Invalid synthetic decision input'},400);
      const row=delegationRows.find(row=>row.id===input.p_request&&row.doctorId===uid);
      if(!row)return send({code:'42501',message:'Synthetic physician scope denied'},403);
      const binding=JSON.stringify([url.pathname,input.p_request,input.p_revision,input.p_decision??null]),receipt=delegationReplay?delegationReceipts.get(input.p_operation):null;
      if(receipt){
        const matches=receipt.binding===binding;
        metrics.delegationAttempts.push({path:url.pathname,args:input,currentRevision:row.revision,status:matches?200:409,replay:matches});
        if(!matches)return send({code:'40001',message:'Synthetic operation binding conflict'},409);
        metrics.delegationReplies.push({kind:'replay',path:url.pathname,args:input,snapshot:{...receipt.snapshot}});return send(receipt.snapshot);
      }
      const conflict=row.revision!==input.p_revision||row.state!==(approve?'pending':'approved');
      metrics.delegationAttempts.push({path:url.pathname,args:input,currentRevision:row.revision,status:conflict?409:200});
      if(conflict)return send({code:'40001',message:'Synthetic revision conflict'},409);
      const beforeRevision=row.revision,snapshot={id:row.id,state:approve?'approved':'revoked',revision:row.revision+1,capabilityVersion:row.capabilityVersion};
      Object.assign(row,snapshot,{effective:approve,canDecide:false,canRevoke:approve});
      metrics.delegationWrites.push({path:url.pathname,args:input,beforeRevision,snapshot:{...snapshot}});
      if(delegationReplay){
        delegationReceipts.set(input.p_operation,{binding,snapshot:{...snapshot}});
        if(lostDelegationReplies.delete(row.id)){
          metrics.delegationReplies.push({kind:'truncated',path:url.pathname,args:input,snapshot:{...snapshot}});
          // Deliberately close an incomplete HTTP200 body after the synthetic write.
          res.writeHead(200,{...headers,'Content-Length':64,Connection:'close'});return res.end('{"id":');
        }
      }
      return send(snapshot);
    }
    if(url.pathname==='/__fixture/metrics')return send(metrics);
    if(url.pathname==='/auth/v1/token')return send({access_token:token,refresh_token:'synthetic-refresh',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,token_type:'bearer',user});
    if(url.pathname==='/auth/v1/user')return send(user);
    if(url.pathname==='/auth/v1/logout')return send({});
    if(url.pathname==='/rest/v1/rpc/clinic_access')return send({kind:'clinical',active:false,admin:false,actorId:uid,clinic:null,doctors:[],staff:[]});
    if(url.pathname==='/rest/v1/rpc/workspace_directory')return send({patients,counts:{total:patients.length,new:0,returns:1}});
    if(url.pathname==='/rest/v1/rpc/list_patient_chat_turns')return send(input.p_patient_id===patientId?turns:[]);
    if(url.pathname==='/rest/v1/rpc/get_integration_status')return send({google_connected:false});
    if(url.pathname==='/rest/v1/rpc/sharing_overview')return send({memberships:[],members:[],received:[],granted:[]});
    if(url.pathname==='/rest/v1/rpc/protocol_sharing_overview')return send({members:[],received:[],granted:[],received_count:0});
    if(url.pathname==='/rest/v1/rpc/create_knowledge_source'){
      metrics.newSources++;const id=crypto.randomUUID();knowledge.push({id,user_id:uid,title:input.p_title,source_text:input.p_text,source_reference:input.p_reference,source_version:input.p_version,char_count:input.p_text.length,source_type:'text',status:'draft',review_status:'pending',created_at:now,reviewed_at:null,reviewer_name:null,indexed_at:null});return send(id);
    }
    if(url.pathname==='/functions/v1/generate-prebriefing'){metrics.briefings++;return send({returnInfo:'Resumo sintético estável',previousComplaint:'Apenas dados de teste',pending:'',alert:''});}
    if(url.pathname==='/functions/v1/suggest-questions'){metrics.checklists++;return send({questions:['Como está seu sono?','Houve mudanças na rotina, nos sintomas ou nas atividades desde a última consulta que você gostaria de discutir hoje?','Há mais alguma questão?']});}
    if(url.pathname==='/functions/v1/chat-assistant'){
      metrics.chat++;const response={message:'O Cortex não tem uma base farmacológica validada conectada para confirmar ou descartar interações. Confira uma referência atualizada e revise a avaliação médica.',sources:[],credits:0,safety:{status:'verification_required',topic:'medication'}};
      if(input.patientId===patientId && input.conversationId && !turns.some(turn=>turn.id===input.conversationId))turns.unshift({id:input.conversationId,question:input.userMessage,response,status:'complete',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
      return send(response);
    }
    if(medicalUI && url.pathname==='/functions/v1/signature-session/state' && req.method==='GET')return send({configured:false,active:false,expiresAt:null});
    if(url.pathname.startsWith('/functions/'))return send({error:'Integração externa desativada no teste.'},503);
    if(medicalUI && url.pathname.startsWith('/rest/') && !['GET','HEAD'].includes(req.method)){metrics.medicalWrites++;return send({error:'Read-only medical UI fixture'},405);}
    const schedulingReply=scheduling?.read(req,url);if(schedulingReply)return send(schedulingReply.body,schedulingReply.status);
    const noticeReply=recoveryNotice?.read(req,url);if(noticeReply)return send(noticeReply.body,noticeReply.status);
    const table=url.pathname.split('/').pop();
    if(patientWorkspaceReview && ['patients','clinical_work_items','clinical_work_revisions','clinical_record_revisions','consultations'].includes(table)) {
      metrics.patientWorkspaceReads.push({table,method:req.method,query:Object.fromEntries(url.searchParams)});
      if(patientWorkspaceDenied && table==='patients' && url.searchParams.get('select')==='id,name' && url.searchParams.has('id'))return send({error:'Synthetic ownership check unavailable'},503);
    }
    const workspaceRows={clinical_work_items:workItems,clinical_work_revisions:workRevisions,clinical_record_revisions:recordRevisions,consultation_drafts:drafts};
    if(workspaceDates && Object.hasOwn(workspaceRows,table) && !['GET','HEAD'].includes(req.method)){metrics.workspaceWrites++;return send({error:'Read-only display fixture'},405);}
    let rows=workspaceRows[table]??(table==='patients'?patients:table==='appointments'?appointments:table==='consultations'?visits:table==='user_settings'?[settings]:table==='document_templates'?templates:table==='knowledge_documents'?knowledge:table==='usage_daily'?[{credits_used:0,calls:0}]:[]);
    for(const field of ['id','patient_id','revision','item_id','record_id','supersedes_document_id']){const filter=url.searchParams.get(field);if(filter?.startsWith('eq.'))rows=rows.filter(row=>String(row[field])===filter.slice(3));}
    if(table==='consultation_drafts' && url.searchParams.get('select')===recoverySelect) return send(rows.filter(row=>row.user_id===uid&&row.discard_requested_at==null&&['processing','review','error'].includes(row.status)).slice(0,51).map(row=>({id:row.id,patient_id:row.patient_id,status:row.status,updated_at:row.updated_at,patient:patients.filter(patient=>patient.user_id===uid).map(({id,name})=>({id,name})).find(patient=>patient.id===row.patient_id)??null})));
    if(table==='patients' && req.method==='PATCH'){metrics.patientWrites++;rows.forEach(row=>Object.assign(row,input,{revision:row.revision+1}));}
    if(table==='appointments' && req.method==='PATCH'){metrics.appointmentWrites++;rows.forEach(row=>Object.assign(row,input,{revision:row.revision+1}));}
    const offset=Number(url.searchParams.get('offset')??'0');const total=rows.length;rows=rows.slice(offset,offset+Number(url.searchParams.get('limit')??500));headers['content-range']=`0-${Math.max(0,rows.length-1)}/${total}`;
    if(req.method==='HEAD'){res.writeHead(200,headers);return res.end();}
    return send(req.headers.accept?.includes('application/vnd.pgrst.object+json')?(rows[0]??null):rows);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:`http://127.0.0.1:${server.address().port}`,metrics,recoveryNotice,scheduling,displayData:workspaceDates?displayData:null,medicalData:medicalUI?medicalData:null,mfaFactors:mfaReview?user.factors:null,delegationRows,
    setPatientWorkspaceDenied(denied){if(!patientWorkspaceReview||typeof denied!=='boolean')throw new Error('Patient workspace mode is not enabled');patientWorkspaceDenied=denied;},
    resetMfaEnrollment(){if(!mfaEnrollmentReview)throw new Error('MFA enrollment fixture is not enabled');user.factors.splice(0,user.factors.length,...structuredClone(initialMfaFactors));},
    setDelegationReadMode(mode){if(!delegationPermissions||!['valid','invalid','denied'].includes(mode))throw new Error('Unsupported delegation fixture mode');delegationReadMode=mode;},
    resetDelegationDecisions(){if(!delegationDecisions)throw new Error('Delegation decision fixture is not enabled');delegationRows.splice(0,delegationRows.length,...structuredClone(initialDelegations));delegationReceipts.clear();lostDelegationReplies.clear();},
    armDelegationLostReply(requestId){
      if(!delegationReplay)throw new Error('Delegation replay fixture is not enabled');
      z.string().uuid().parse(requestId);if(!delegationRows.some(row=>row.id===requestId&&row.state==='pending'))throw new Error('Expected an existing pending request');
      lostDelegationReplies.add(requestId);
    },
    // Test-only control: emulate a pending request changed after the browser read it.
    advanceDelegationRevision(requestId){
      if(!delegationDecisions)throw new Error('Delegation decision fixture is not enabled');
      z.string().uuid().parse(requestId);const row=delegationRows.find(row=>row.id===requestId&&row.state==='pending');
      if(!row)throw new Error('Expected an existing pending request');
      const beforeRevision=row.revision;row.revision++;return {requestId,beforeRevision,afterRevision:row.revision};
    },
    close:()=>new Promise(resolve=>server.close(resolve))};
}
