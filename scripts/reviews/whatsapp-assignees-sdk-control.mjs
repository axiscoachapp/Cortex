// Negative control: FunctionsClient must not turn fixture assertion failures into accepted unavailable samples.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const path='scripts/reviews/whatsapp-assignees-sdk.mjs',original=readFileSync(path,'utf8');
const sourceHash=createHash('sha256').update(original).digest('hex');
const checks=[];
function replaceOnce(text,from,to){assert.equal(text.split(from).length,2,`Control marker changed: ${from}`);return text.replace(from,to);}
for(const suppressRecording of [false,true]){
  let source=original;
  for(const name of ['typescript','@supabase/supabase-js'])source=replaceOnce(source,`'${name}'`,JSON.stringify(import.meta.resolve(name)));
  source=replaceOnce(source,"import.meta.resolve('zod')",JSON.stringify(import.meta.resolve('zod')));
  source=replaceOnce(source,"assert.deepEqual(body,mode==='next'?","assert.deepEqual(body,(mode==='lost'||mode==='truncated')?{action:'synthetic_wrong_expected_body'}:mode==='next'?");
  const record="unexpected.push({kind:'request-contract',method:request.method,path:url.pathname});";
  if(suppressRecording)source=replaceOnce(source,record,'void error;');
  const slot=`__cortexAssigneesControl_${process.pid}_${suppressRecording}`;
  source=replaceOnce(source,"const slot='__cortexAssigneesSdk_'+process.pid;",`const slot=${JSON.stringify(slot)};`);
  const reportSlot=slot+'_report';
  source=replaceOnce(source,"writeFileSync('docs/reviews/2026-11-07/whatsapp-assignees/SDK.json',JSON.stringify(report,null,2)+'\\n');",`globalThis[${JSON.stringify(reportSlot)}]=report;`);
  source=replaceOnce(source,"console.log(JSON.stringify({checks:checks.length,calls:calls.length,sourceHashesStable,unexpected:unexpected.length}));",'void report;');
  let failure;
  try{await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}catch(error){failure=error;}
  try{
    if(!suppressRecording){
      assert.equal(failure?.code,'ERR_ASSERTION');assert.equal(failure.actual?.length,2);assert.ok(failure.actual.every(x=>x.kind==='request-contract'));
      assert.equal(globalThis[reportSlot],undefined);checks.push({case:'injected_contract_failures_are_rejected',passed:true,detected:2});
    }else{
      assert.equal(failure,undefined);const report=globalThis[reportSlot];assert.equal(report.checks.length,16);assert.equal(report.calls.length,14);assert.deepEqual(report.unexpected,[]);
      checks.push({case:'removing_recording_reproduces_false_acceptance',passed:true,masked:2,apparentChecks:16,apparentCalls:14});
    }
  }finally{delete globalThis[reportSlot];}
}
assert.equal(createHash('sha256').update(readFileSync(path,'utf8')).digest('hex'),sourceHash);
const report={syntheticOnly:true,nativeNetworkCalls:0,source:{path,sha256:sourceHash},checks,sourceUnchanged:true,sdkReportNotWrittenByControl:true};
writeFileSync('docs/reviews/2026-11-07/whatsapp-assignees/SDK_CONTROL.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
