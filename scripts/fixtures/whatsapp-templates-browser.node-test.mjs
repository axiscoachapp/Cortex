import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTemplateReadRequests} from './whatsapp-templates-browser.mjs';
test('template browser guard permits only authentication and scoped reads',()=>{
 assert.doesNotThrow(()=>assertTemplateReadRequests([{method:'POST',path:'/auth/v1/token'},{method:'GET',path:'/auth/v1/user'},{method:'POST',path:'/rest/v1/rpc/clinic_access'},{method:'POST',path:'/functions/v1/whatsapp-api'}]));
});
test('template browser guard rejects fixture writes and unrelated readers',()=>{
 for(const path of ['/functions/v1/create-clinic-receptionist','/rest/v1/rpc/reception_block_time','/rest/v1/rpc/reception_unblock_time','/rest/v1/rpc/reception_queue','/rest/v1/patients'])assert.throws(()=>assertTemplateReadRequests([{method:'POST',path}]),/Unexpected route request/);
 assert.throws(()=>assertTemplateReadRequests([{method:'GET',path:'/functions/v1/whatsapp-api'}]),/Unexpected route request/);
});
