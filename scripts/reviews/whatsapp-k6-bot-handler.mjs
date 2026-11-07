// Establish that the SQL restart probes are reachable through the frozen production handler.
import assert from 'node:assert/strict';
import ts from 'typescript';

export async function probeBotHandler({source}) {
  const moduleUrl=text=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
  let runBot;
  try {
    let handlers=source('supabase/functions/_shared/whatsappHandlers.ts');
    for(const name of ['psc','whatsapp','whatsappFlow'])handlers=handlers.replaceAll(`'./${name}.ts'`,JSON.stringify(moduleUrl(source(`supabase/functions/_shared/${name}.ts`))));
    ({runBot}=await import(moduleUrl(handlers)));
    assert.equal(typeof runBot,'function','Frozen handler export missing');
  } catch(error){return [{name:'handler_initialization',passed:false,category:'fixture_failure',error:error.message}];}
  const now=new Date('2026-11-06T23:00:00Z');
  const id='e6400000-0000-4000-8000-000000000001';
  const current={conversation_id:id,flow_revision:1,node:'inicio',attempts:0,path:[],status:'active',outcome:null,revision:1,started_at:'2026-11-06T21:00:00Z',updated_at:'2026-11-06T22:00:00Z'};
  const definition={start:'inicio',nodes:{inicio:{title:'Synthetic menu',text:'Synthetic choice',options:[{label:'Synthetic route',goto:'queue:agenda'}]}}};
  const proofs=[];
  for(const scenario of [
    {name:'first_cycle',session:null,revision:1,expectedNewCycle:true},
    {name:'flow_restart',session:current,revision:2,expectedNewCycle:true},
    {name:'idle_restart',session:{...current,started_at:'2026-11-05T20:00:00Z',updated_at:'2026-11-05T21:00:00Z'},revision:1,expectedNewCycle:true},
    {name:'expired_window',session:null,revision:1,expectedNewCycle:true,lastInboundAt:'2026-11-05T21:00:00Z'},
    {name:'active_continuation',session:current,revision:1,expectedNewCycle:false},
    {name:'already_handed_off',session:{...current,status:'handed_off'},revision:1,expectQuiet:true},
    {name:'quiet_opt_out',session:null,revision:1,body:'SAIR',expectQuiet:true},
  ]) {
    const calls=[];
    const deps={now:()=>now,store:{
      conversationById:async()=>({id,clinic_id:'e6200000-0000-4000-8000-000000000001',status:'open',assigned_to:null,opened_at:'2026-11-05T19:00:00Z',last_inbound_at:scenario.lastInboundAt??now.toISOString()}),
      flowForClinic:async()=>({enabled:true,definition,hours:{},after_hours_text:'',handoff_text:'Synthetic handoff',default_queue:'geral',revision:scenario.revision}),
      botSession:async()=>scenario.session,
      channelForClinic:async()=>{throw new Error('Rejected SQL step must never request a channel');},
    },rpc:async(name,args)=>{calls.push({name,args});return {applied:false,reason:'synthetic_guard'};},log:()=>{throw new Error('Handler fixture must not be swallowed');}};
    try {
      await runBot(deps,{kind:'text',body:scenario.body??'Synthetic',wamid:'wamid.K6BOT_A',providerAt:scenario.lastInboundAt??now.toISOString(),replyId:null},id);
      if(scenario.expectQuiet)assert.equal(calls.length,0,scenario.name);
      else {
        assert.equal(calls.length,1,scenario.name);assert.equal(calls[0].name,'whatsapp_bot_apply');
        assert.equal(calls[0].args.p_new_cycle,scenario.expectedNewCycle,scenario.name);
        assert.equal(calls[0].args.p_session_revision,scenario.session?.revision??0,scenario.name);
        assert.equal(calls[0].args.p_flow_revision,scenario.revision,scenario.name);
        assert.ok(calls[0].args.p_messages.length>0,'A real output step must reach the SQL guard');
      }
      proofs.push({name:scenario.name,passed:true,category:'pass',guardCalled:calls.length===1,newCycle:calls[0]?.args.p_new_cycle??null,messageCount:calls[0]?.args.p_messages.length??0});
    } catch(error){proofs.push({name:scenario.name,passed:false,category:'contract_failure',error:error.message});}
  }
  return proofs;
}
