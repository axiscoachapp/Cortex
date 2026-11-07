import assert from 'node:assert/strict';
import {z} from 'zod';

export function createMfaVerificationFixture(factors){
  const calls=[],latest=new Map(),allowed=new Set(factors.filter(f=>f.factor_type==='totp'&&f.status==='verified').map(f=>f.id));
  let sequence=0,format='modern',failure='mfa_verification_failed',challengeFailure=null;
  const challenge=z.object({factorId:z.string().uuid()}).strict(),verify=z.object({challenge_id:z.string().uuid(),code:z.string().regex(/^\d{6}$/)}).strict();
  const headers=()=>format==='modern'?{'X-Supabase-Api-Version':'2024-01-01','Access-Control-Expose-Headers':'content-range,x-supabase-api-version'}:{};
  const fail=(code,status)=>({status,headers:{...headers(),...(status===429?{'Retry-After':'120'}:{})},body:{[format==='modern'?'code':'error_code']:code,message:'Synthetic MFA refusal'}});
  const refusal=code=>fail(code,code==='over_request_rate_limit'?429:code==='unexpected_failure'?503:422);
  return {calls,reset(){latest.clear();failure='mfa_verification_failed';challengeFailure=null;},setFormat(value){assert.ok(['modern','legacy'].includes(value));format=value;},setChallengeFailure(value){assert.ok([null,'over_request_rate_limit','unexpected_failure'].includes(value));challengeFailure=value;},setFailure(value){assert.ok(['mfa_verification_failed','mfa_challenge_expired','over_request_rate_limit','unexpected_failure'].includes(value));failure=value;},read(req,url,input){
    const match=/^\/auth\/v1\/factors\/([^/]+)\/(challenge|verify)$/.exec(url.pathname);
    if(!match)return null;
    const [,factorId,action]=match,call={action,factorId,format,valid:false};calls.push(call);
    if(req.method!=='POST'||!allowed.has(factorId))return fail('TEST_INVALID_FACTOR',400);
    if(action==='challenge'){
      const parsed=challenge.safeParse(input);if(!parsed.success||parsed.data.factorId!==factorId)return fail('TEST_INVALID_CHALLENGE',400);
      if(challengeFailure){latest.delete(factorId);Object.assign(call,{valid:true,errorCode:challengeFailure});return refusal(challengeFailure);}
      const id='e1000000-0000-4000-8000-'+String(++sequence).padStart(12,'0');latest.set(factorId,{id,used:false});Object.assign(call,{valid:true,challengeId:id});
      return {status:200,headers:headers(),body:{id,type:'totp',expires_at:Math.floor(Date.now()/1000)+60}};
    }
    const parsed=verify.safeParse(input),current=latest.get(factorId);
    if(!parsed.success||!current||current.used||current.id!==parsed.data.challenge_id)return fail('TEST_INVALID_VERIFY_BINDING',400);
    current.used=true;Object.assign(call,{valid:true,challengeId:current.id,codeLength:parsed.data.code.length,errorCode:failure});return refusal(failure);
  }};
}
