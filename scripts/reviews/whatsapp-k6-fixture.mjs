// Compatibility for frozen pre/post-revision reservation contracts. No production source edits.
export function adaptReservationFixture(sql,revisioned) {
  if(!revisioned)return sql;
  let result=sql.replaceAll('public.whatsapp_automation_begin((select id from rule),',
    'public.whatsapp_automation_begin((select id from rule),(select revision from public.whatsapp_automations where id=(select id from rule)),');
  for(const [literal,replacement] of [
    ["'2099-12-10T15:00Z'","(now()+interval '45 hours')"],
    ["'2099-12-10T15:30Z'","(now()+interval '45 hours 30 minutes')"],
    ["'2099-12-10T16:00Z'","(now()+interval '46 hours')"],
    ["'2099-12-10T16:30Z'","(now()+interval '46 hours 30 minutes')"],
    ["'2099-12-10T17:00Z'","(now()+interval '47 hours')"],
    ["'2099-12-10T17:30Z'","(now()+interval '47 hours 30 minutes')"],
    ["'2099-12-08T16:00Z'",'now()'],
  ])result=result.replaceAll(literal,replacement);
  return result;
}
