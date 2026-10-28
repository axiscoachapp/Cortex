// Review-only loopback fixture. Synthetic data; no production calls or credentials.
import http from 'node:http';
const uid='11111111-1111-4111-8111-111111111111';
const now=new Date().toISOString();
const user={id:uid,email:'review@example.invalid',aud:'authenticated',role:'authenticated',created_at:now,app_metadata:{provider:'email'},user_metadata:{}};
const token=[{alg:'HS256',typ:'JWT'},{sub:uid,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+86400,iat:Math.floor(Date.now()/1000)}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.synthetic-signature';
const patients=['A','B'].map((s,i)=>({id:`22222222-2222-4222-8222-22222222222${i}`,user_id:uid,name:`Paciente Exemplo ${s}`,age:35+i,revision:0,profession:'Exemplo sintético',last_visit:'2026-10-28',created_at:now,updated_at:now,status:'retorno',diagnoses:[],medications:[],allergies:[],clinical_notes:'',medical_history:'',social_anamnesis:'',phone:null,email:null}));
const settings={user_id:uid,specialty:'ginecologia',daily_credit_limit:1500,live_copilot_enabled:false,doctor_name:'Profissional de Demonstração',crm_number:'00000',crm_uf:'PR',professional_address:'Ambiente de teste',active_template_id:null};
const work=[];const visits=[];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:54329'); let raw=''; for await(const chunk of req)raw+=chunk;
 const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:8081','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Content-Type':'application/json','Access-Control-Expose-Headers':'content-range'};
 const send=(body,status=200)=>{res.writeHead(status,headers);res.end(JSON.stringify(body));};
 if(req.method==='OPTIONS')return send({});
 if(url.pathname==='/rest/v1/rpc/workspace_directory')return send({patients,counts:{total:patients.length,new:0,returns:patients.length}});
 if(url.pathname==='/rest/v1/rpc/sharing_overview')return send({memberships:[],members:[],received:[],granted:[]});
 if(url.pathname==='/rest/v1/rpc/finalize_manual_encounter'){
   const input=JSON.parse(raw);const item=work.find(row=>row.id===input.p_item_id);if(!item)return send({error:'Draft unavailable'},404);
   const id=item.details.consultationId||crypto.randomUUID();if(!visits.some(row=>row.id===id))visits.push({id,user_id:uid,patient_id:item.patient_id,soap_note:item.content,created_at:new Date().toISOString(),chief_complaint:item.title,revision:0});
   item.status='done';item.details.consultationId=id;return send(id);
 }
 if(url.pathname==='/auth/v1/token')return send({access_token:token,refresh_token:'synthetic-review-refresh',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,token_type:'bearer',user});
 if(url.pathname==='/auth/v1/user')return send(user);
 if(url.pathname==='/auth/v1/logout')return send({});
 if(url.pathname==='/functions/v1/generate-prebriefing')return send({returnInfo:'Retorno de demonstração',previousComplaint:'Nenhuma informação clínica real.',pending:'Dados sintéticos para revisão visual.',alert:''});
 if(url.pathname.startsWith('/functions/'))return send({error:'Integração externa desativada no ambiente de revisão.'},503);
 const table=url.pathname.split('/').pop();
 let rows=table==='patients'?patients:table==='clinical_work_items'?work:table==='consultations'?visits:table==='user_settings'?[settings]:table==='usage_daily'?[{credits_used:0,credits_reserved:0,calls:0}]:[];
 if(table==='clinical_work_items'&&req.method==='POST'){const input=JSON.parse(raw);const row={...input,id:crypto.randomUUID(),revision:0,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};work.push(row);return send(req.headers.accept?.includes('object+json')?row:[row]);}
 const id=url.searchParams.get('id');if(id?.startsWith('eq.'))rows=rows.filter(r=>r.id===id.slice(3));
 const patientId=url.searchParams.get('patient_id');if(patientId?.startsWith('eq.'))rows=rows.filter(r=>r.patient_id===patientId.slice(3));
 if(table==='clinical_work_items'&&req.method==='PATCH'){const patch=JSON.parse(raw);for(const row of rows)Object.assign(row,patch,{revision:row.revision+1,updated_at:new Date().toISOString()});return send(req.headers.accept?.includes('object+json')?rows[0]:rows);}
 const offset=Number(url.searchParams.get('offset')??String(req.headers.range??'0').split('-')[0]);
 rows=rows.slice(offset,offset+Number(url.searchParams.get('limit')??500));
 headers['content-range']=`0-${Math.max(0,rows.length-1)}/${rows.length}`;
 if(req.method==='HEAD'){res.writeHead(200,headers);return res.end();}
 if(req.headers.accept?.includes('application/vnd.pgrst.object+json'))return send(rows[0]??null);
 return send(rows);
});
server.listen(Number(process.env.CORTEX_REVIEW_PORT??0),'127.0.0.1',()=>console.log(`Synthetic review API at 127.0.0.1:${server.address().port}`));
