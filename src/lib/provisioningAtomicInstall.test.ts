// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {composeAtomicInstall,installWithLateFault,installLocks,overlayProfiles} from '../../scripts/test-provisioning-atomic-install.mjs';

const files={identity:'auth-identity',intent:'human-intent',membership:'membership-generation',composed:'clinic-intent',ledger:'ledger-bindings',birthProducer:'birth-producer',reservationKeys:'reservation-keys',confirmationProducer:'confirmation-producer',creationProducer:'creation-producer',confirmationBoundary:'confirmation-boundary'};
const overlays=()=>Object.fromEntries(Object.entries(files).map(([key,file])=>[key,readFileSync(new URL('../../supabase/tests/prototypes/provisioning-'+file+'.sql',import.meta.url),'utf8')]));
describe('atomic installer for reviewed lab overlays only',()=>{
 it('composes the actual ten profiles with one transaction and early nonwaiting gates',()=>{
  const inputs=overlays(),before=JSON.stringify(inputs),sql=composeAtomicInstall(inputs);
  expect(sql.match(/^begin;$/gm)).toHaveLength(1);expect(sql.match(/^commit;$/gm)).toHaveLength(1);
  expect(sql.match(/^set transaction isolation level read committed;$/gm)).toHaveLength(1);
  for(const lock of Object.values(installLocks)){expect(sql.indexOf(lock)).toBeGreaterThanOrEqual(0);expect(sql.indexOf(lock)).toBeLessThan(sql.indexOf('create schema provision_identity_lab'));}
  expect(sql).toContain("raise exception 'Creation body changed'");expect(JSON.stringify(inputs)).toBe(before);
 });
 it.each(Object.keys(overlayProfiles))('refuses a missing %s profile',key=>{const value=overlays();delete value[key];expect(()=>composeAtomicInstall(value)).toThrow();});
 it('refuses extra profiles and unreviewed SQL, even when syntactically plausible',()=>{
  expect(()=>composeAtomicInstall({...overlays(),unknown:'select 1;'})).toThrow();
  expect(()=>composeAtomicInstall({...overlays(),identity:overlays().identity+'\nselect 1;commit;'})).toThrow();
  expect(()=>composeAtomicInstall({...overlays(),identity:overlays().identity+'\nselect 1;'})).toThrow(/Unreviewed overlay/);
 });
 it('refuses nested transactions or a different isolation profile',()=>{
  expect(()=>composeAtomicInstall({...overlays(),membership:overlays().membership+'\nbegin;\ncommit;'})).toThrow(/transaction profile/);
  expect(()=>composeAtomicInstall({...overlays(),membership:overlays().membership.replace('read committed','repeatable read')})).toThrow();
 });
 it('accepts CRLF without changing the compiled SQL',()=>{
  const value=overlays();expect(composeAtomicInstall(Object.fromEntries(Object.entries(value).map(([key,sql])=>[key,sql.replace(/\r\n/g,'\n').replace(/\n/g,'\r\n')])))).toBe(composeAtomicInstall(value));
 });
 it('places the intentional failure after the final guard and before commit',()=>{
  const sql=installWithLateFault(composeAtomicInstall(overlays()));
  expect(sql.indexOf('Intentional late installation failure')).toBeGreaterThan(sql.indexOf('intent_creation_producer'));
  expect(sql.endsWith('\ncommit;')).toBe(true);expect(sql.match(/^commit;$/gm)).toHaveLength(1);
  expect(()=>installWithLateFault('select 1;')).toThrow();
 });
});
