import assert from 'node:assert/strict';

export const schedulingSelect='id,patient_id,title,status,due_date,updated_at,workflow:details->>workflow,stage:details->>stage,availability:details->>availability,patient:patients!clinical_work_items_patient_id_user_id_fkey(id,name)';
export function createSchedulingFixture({userId,patients,workItems}) {
  const base=patients[0];assert.ok(base);
  const second={...structuredClone(base),id:'cccccccc-cccc-4ccc-8ccc-000000000001',name:'Paciente sintético '+'NomeSemEspaços'.repeat(12)};patients.push(second);
  const task={...structuredClone(workItems[0]),kind:'task',status:'open',details:{workflow:'waitlist',stage:'requested',availability:'Terças e quintas pela manhã'},title:'Espera sintética preservada'};
  workItems.push({...task,id:'dddddddd-dddd-4ddd-8ddd-000000000001'});
  workItems.push({...task,id:'dddddddd-dddd-4ddd-8ddd-000000000002',patient_id:second.id,status:'draft',title:'Confirmação sintética preservada',details:{workflow:'confirmation',stage:'contacted'}});
  workItems.push({...task,id:'dddddddd-dddd-4ddd-8ddd-000000000003',status:'done',title:'Espera já concluída'});
  workItems.push({...task,id:'dddddddd-dddd-4ddd-8ddd-000000000004',details:{workflow:'result'},title:'Resultado fora da fila de agenda'});
  let mode='valid';const calls=[],allReads=[],unexpected=[];
  return{calls,allReads,unexpected,setMode(value){assert.ok(['valid','empty','unavailable'].includes(value));mode=value;},
    read(req,url){
      if(url.pathname!=='/rest/v1/clinical_work_items')return null;
      allReads.push({method:req.method,query:Object.fromEntries(url.searchParams)});
      if(!url.searchParams.get('select')?.includes('workflow:'))return null;
      const q=Object.fromEntries(url.searchParams);calls.push(allReads.at(-1));
      if(req.method!=='GET'||Object.keys(q).length!==7||q.select!==schedulingSelect||q.user_id!=='eq.'+userId||q.kind!=='eq.task'||q.status!=='in.(open,draft)'||q['details->>workflow']!=='in.(waitlist,confirmation)'||q.order!=='updated_at.desc,id.asc'||q.limit!=='51'){
        unexpected.push(calls.at(-1));return{status:400,body:{error:'Unexpected scheduling metadata read'}};
      }
      if(mode==='unavailable')return{status:503,body:{error:'Synthetic scheduling metadata unavailable'}};
      const rows=mode==='empty'?[]:workItems.filter(row=>row.user_id===userId&&row.kind==='task'&&['open','draft'].includes(row.status)&&['waitlist','confirmation'].includes(row.details.workflow));
      return{status:200,body:rows.slice(0,51).map(({id,patient_id,title,status,due_date,updated_at,details})=>({id,patient_id,title,status,due_date,updated_at,workflow:details.workflow,stage:details.stage??null,availability:details.availability??null,patient:patients.filter(patient=>patient.user_id===userId).map(({id,name})=>({id,name})).find(patient=>patient.id===patient_id)??null}))};
    },
  };
}
