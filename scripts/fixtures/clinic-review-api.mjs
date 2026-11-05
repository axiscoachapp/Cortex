// Loopback-only synthetic API for browser regression tests. Never use real keys/data.
import http from 'node:http';
export const uid='11111111-1111-4111-8111-111111111111';
export const patientId='22222222-2222-4222-8222-222222222222';
export async function startClinicFixture({ appointments = [], lastVisit = null } = {}) {
  const now=new Date().toISOString();
  const user={id:uid,email:'review@example.invalid',aud:'authenticated',role:'authenticated',created_at:now,email_confirmed_at:now,app_metadata:{provider:'email'},user_metadata:{},factors:[]};
  const token=[{alg:'HS256',typ:'JWT'},{sub:uid,role:'authenticated',aud:'authenticated',aal:'aal1',exp:Math.floor(Date.now()/1000)+86400,iat:Math.floor(Date.now()/1000)}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.synthetic-signature';
  const patients=[{id:patientId,user_id:uid,name:'Paciente Exemplo A',age:0,date_of_birth:null,revision:0,profession:'',last_visit:lastVisit,status:'retorno',diagnoses:[],medications:[],allergies:[],clinical_notes:'',medical_history:'',social_anamnesis:'',phone:null,email:null,cpf:null,sex:null,health_insurance:null,archived_at:null}];
  const templates=[{id:'44444444-4444-4444-8444-444444444444',user_id:null,name:'Modelo sintético SOAP',description:'Estrutura para revisão visual',content:'**S (Subjetivo):** relato\n\n**O (Objetivo):** achados\n\n**A:** avaliação\n\n**P:** plano',created_at:now}];
  const settings={user_id:uid,specialty:'geral',daily_credit_limit:1500,live_copilot_enabled:false,doctor_name:'Profissional de Demonstração',crm_number:'00000',crm_uf:'PR',professional_address:'Ambiente sintético',active_template_id:null};
  const visits=[{id:'55555555-5555-4555-8555-555555555555',patient_id:patientId,user_id:uid,created_at:now,chief_complaint:'Consulta sintética',soap_note:'**S (Subjetivo):** relato sintético\n\n- Item revisado',revision:0}];
  const turns=[];const knowledge=[];const metrics={briefings:0,checklists:0,chat:0,newSources:0,patientWrites:0,appointmentWrites:0};
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');let raw='';for await(const chunk of req)raw+=chunk;
    const input=raw?JSON.parse(raw):{};
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,HEAD,OPTIONS','Content-Type':'application/json','Access-Control-Expose-Headers':'content-range'};
    const send=(data,status=200)=>{res.writeHead(status,headers);res.end(JSON.stringify(data));};
    if(req.method==='OPTIONS')return send({});
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
    if(url.pathname.startsWith('/functions/'))return send({error:'Integração externa desativada no teste.'},503);
    const table=url.pathname.split('/').pop();
    let rows=table==='patients'?patients:table==='appointments'?appointments:table==='consultations'?visits:table==='user_settings'?[settings]:table==='document_templates'?templates:table==='knowledge_documents'?knowledge:table==='usage_daily'?[{credits_used:0,calls:0}]:[];
    for(const field of ['id','patient_id','revision']){const filter=url.searchParams.get(field);if(filter?.startsWith('eq.'))rows=rows.filter(row=>String(row[field])===filter.slice(3));}
    if(table==='patients' && req.method==='PATCH'){metrics.patientWrites++;rows.forEach(row=>Object.assign(row,input,{revision:row.revision+1}));}
    if(table==='appointments' && req.method==='PATCH'){metrics.appointmentWrites++;rows.forEach(row=>Object.assign(row,input,{revision:row.revision+1}));}
    const offset=Number(url.searchParams.get('offset')??'0');const total=rows.length;rows=rows.slice(offset,offset+Number(url.searchParams.get('limit')??500));headers['content-range']=`0-${Math.max(0,rows.length-1)}/${total}`;
    if(req.method==='HEAD'){res.writeHead(200,headers);return res.end();}
    return send(req.headers.accept?.includes('application/vnd.pgrst.object+json')?(rows[0]??null):rows);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:`http://127.0.0.1:${server.address().port}`,metrics,close:()=>new Promise(resolve=>server.close(resolve))};
}
