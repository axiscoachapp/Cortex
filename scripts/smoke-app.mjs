// Synthetic public readiness check. No account, patient data or provider call.
const origin=new URL(process.argv[2]??'http://127.0.0.1:8080');
if(origin.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw new Error('Use HTTPS or an explicit loopback test server.');
if(origin.username||origin.password||origin.search||origin.hash)throw new Error('Supply only an origin, without credentials or query parameters.');
async function read(path,max=2*1024*1024){
 const target=new URL(path,origin);if(target.origin!==origin.origin)throw new Error('Readiness assets must stay on the configured origin.');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 try{const response=await fetch(target,{signal:controller.signal,redirect:'error'});if(!response.ok)throw new Error(`Readiness resource failed: ${response.status}`);
   const reader=response.body.getReader();let size=0;const chunks=[];while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>max){await reader.cancel();throw new Error('Readiness response exceeds limit');}chunks.push(chunk.value);}
   return Buffer.concat(chunks).toString('utf8');
 }finally{clearTimeout(timer);}
}
let html;
for(let attempt=0;attempt<10;attempt++){
 try{html=await read('/auth');break;}catch(error){if(error.cause?.code!=='ECONNREFUSED'||attempt===9)throw error;await new Promise(resolve=>setTimeout(resolve,250));}
}
if(!html.includes('Haddad Nicola')||!html.includes('id="root"'))throw new Error('Unexpected application document');
const entry=html.match(/<script[^>]+src="([^"]+)"/i)?.[1];if(!entry)throw new Error('Application entrypoint missing');
await read(entry);await read('/brand/haddad-nicola.png');await read('/brand/fonts.css');
console.log('Passed public page, entrypoint and local brand-asset readiness checks. Auth, database, Storage and provider workflows require their separate suites.');
