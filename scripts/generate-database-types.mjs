import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const container=`cortex-types-${randomUUID().slice(0,8)}`;
const run=(cmd,args,input)=>{const result=spawnSync(cmd,args,{input,encoding:'utf8',maxBuffer:16*1024*1024});if(result.status!==0)throw new Error(result.stderr||result.stdout||result.error?.message);return result.stdout;};
try{
  run('docker',['run','--detach','--rm','--name',container,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']);
  let ready=false;
  for(let i=0;i<60;i++){if(spawnSync('docker',['exec',container,'pg_isready','-U','postgres'],{stdio:'ignore'}).status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}
  if(!ready)throw new Error('Disposable database unavailable');
  const sql=input=>run('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','--quiet'],input);
  sql(readFileSync('supabase/tests/bootstrap.sql','utf8'));
  for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort())sql(readFileSync(`supabase/migrations/${name}`,'utf8'));
  const types=run('docker',['run','--rm','--network',`container:${container}`,
    '--env','PG_META_DB_HOST=127.0.0.1','--env','PG_META_GENERATE_TYPES=typescript',
    '--env','PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public','--env','PG_META_POSTGREST_VERSION=12',
    '--env','PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true',
    'public.ecr.aws/supabase/postgres-meta:v0.95.2']);
  if(!types.includes('export type Database'))throw new Error('CLI did not return database types');
  writeFileSync('src/integrations/supabase/types.ts',types.trimEnd()+'\n');
  process.stdout.write('Generated types from all local migrations in a disposable database.\n');
}finally{run('docker',['stop',container]);}
