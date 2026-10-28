begin;
insert into auth.users(id,email) values
 ('d0000000-0000-4000-8000-000000000001','protocol-share-owner@example.invalid'),
 ('d0000000-0000-4000-8000-000000000002','protocol-share-reader@example.invalid'),
 ('d0000000-0000-4000-8000-000000000003','protocol-share-outsider@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('test.protocol_clinic',public.create_clinic('Synthetic protocol clinic')::text,true);
select public.invite_clinic_doctor(current_setting('test.protocol_clinic')::uuid,'protocol-share-reader@example.invalid');
select set_config('test.protocol_source',public.create_knowledge_source('Shared source v1','Original shared protocol source text.','Synthetic society','v1')::text,true);
select set_config('test.private_source',public.create_knowledge_source('Private source','Private library protocol source text.','Other synthetic society','v1')::text,true);
do $$ begin
  begin perform public.grant_protocol_share(current_setting('test.protocol_source')::uuid,'d0000000-0000-4000-8000-000000000002'); raise exception 'Unapproved source shared'; exception when insufficient_privilege then null; end;
end $$;
select public.review_knowledge_source(current_setting('test.protocol_source')::uuid,true);
select public.review_knowledge_source(current_setting('test.private_source')::uuid,true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('test.protocol_vector',('[1,'||repeat('0,',766)||'0]'),true);
select public.begin_knowledge_index('d0000000-0000-4000-8000-000000000001',current_setting('test.protocol_source')::uuid);
select public.finish_knowledge_index('d0000000-0000-4000-8000-000000000001',current_setting('test.protocol_source')::uuid,1,jsonb_build_array(jsonb_build_object('content','Original shared protocol source text.','embedding',current_setting('test.protocol_vector')::jsonb)));
select public.begin_knowledge_index('d0000000-0000-4000-8000-000000000001',current_setting('test.private_source')::uuid);
select public.finish_knowledge_index('d0000000-0000-4000-8000-000000000001',current_setting('test.private_source')::uuid,1,jsonb_build_array(jsonb_build_object('content','Private library protocol source text.','embedding',current_setting('test.protocol_vector')::jsonb)));
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
do $$ declare access jsonb; begin
  access:=public.check_shared_protocol_access(current_setting('test.protocol_source')::uuid);
  assert access->>'authorization_revision'='0','Owner source authorization revision incorrect';
  assert access->>'source_review_revision'=access->>'review_revision' and (access->>'source_review_revision')::integer>0,'Owner review revision missing';
end $$;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
select public.respond_clinic_invitation(current_setting('test.protocol_clinic')::uuid,true);
do $$ begin
  begin perform public.get_shared_protocol(current_setting('test.protocol_source')::uuid); raise exception 'Membership exposed protocol'; exception when insufficient_privilege then null; end;
  assert (select count(*) from public.match_knowledge('d0000000-0000-4000-8000-000000000002',current_setting('test.protocol_vector')::public.vector))=0,'Membership exposed library through RAG';
  assert (select count(*) from public.match_knowledge('d0000000-0000-4000-8000-000000000001',current_setting('test.protocol_vector')::public.vector))=0,'Caller selected a foreign RAG actor';
end $$;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('test.protocol_grant',public.grant_protocol_share(current_setting('test.protocol_source')::uuid,'d0000000-0000-4000-8000-000000000002')::text,true);
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
do $$ declare source jsonb; begin
  source:=public.get_shared_protocol(current_setting('test.protocol_source')::uuid);
  assert source->>'source_text'='Original shared protocol source text.','Original shared source unavailable';
  assert source->>'source_version'='v1' and nullif(source->>'source_author','') is not null,'Citation metadata missing';
  assert (select count(*) from public.knowledge_documents)=0,'Owner-only library table policy widened';
  assert (select count(*) from public.match_knowledge('d0000000-0000-4000-8000-000000000002',current_setting('test.protocol_vector')::public.vector))=1,'Exact granted source not available to recipient RAG';
  assert (select source_version='v1' and source_owner_user_id='d0000000-0000-4000-8000-000000000001' and source_title='Shared source v1' from public.match_knowledge('d0000000-0000-4000-8000-000000000002',current_setting('test.protocol_vector')::public.vector)),'RAG source author/version attribution lost';
  begin perform public.get_shared_protocol(current_setting('test.private_source')::uuid); raise exception 'Whole library exposed'; exception when insufficient_privilege then null; end;
  begin perform public.review_knowledge_source(current_setting('test.protocol_source')::uuid,false); raise exception 'Recipient retired source'; exception when insufficient_privilege then null; end;
  begin perform public.begin_knowledge_index('d0000000-0000-4000-8000-000000000001',current_setting('test.protocol_source')::uuid); raise exception 'Recipient reindexed source'; exception when insufficient_privilege then null; end;
  begin perform public.grant_protocol_share(current_setting('test.protocol_source')::uuid,'d0000000-0000-4000-8000-000000000003'); raise exception 'Recipient reshared source'; exception when insufficient_privilege then null; end;
  begin perform public.revoke_protocol_share(current_setting('test.protocol_grant')::uuid); raise exception 'Recipient revoked owner grant'; exception when insufficient_privilege then null; end;
  begin perform public.authorize_protocol_sources('d0000000-0000-4000-8000-000000000001','[]'::jsonb); raise exception 'Recipient invoked privileged source validation'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.protocol_shares; raise exception 'Private grants readable directly'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000003',true);
do $$ begin
  begin perform public.get_shared_protocol(current_setting('test.protocol_source')::uuid); raise exception 'Outsider read source'; exception when insufficient_privilege then null; end;
  assert (select count(*) from public.match_knowledge('d0000000-0000-4000-8000-000000000002',current_setting('test.protocol_vector')::public.vector))=0,'Outsider impersonated recipient through RAG';
end $$;
reset role;
insert into auth.mfa_factors(user_id,status,factor_type) values('d0000000-0000-4000-8000-000000000002','verified','totp');
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
do $$ begin
  begin perform public.get_shared_protocol(current_setting('test.protocol_source')::uuid); raise exception 'Shared source bypassed MFA'; exception when insufficient_privilege then null; end;
  assert (select count(*) from public.match_knowledge('d0000000-0000-4000-8000-000000000002',current_setting('test.protocol_vector')::public.vector))=0,'RAG bypassed MFA';
end $$;
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select public.get_shared_protocol(current_setting('test.protocol_source')::uuid);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('test.retrieved_protocol_sources',(select jsonb_agg(jsonb_build_object('document_id',document_id,'authorization_revision',authorization_revision,'source_review_revision',source_review_revision))::text from public.match_knowledge('d0000000-0000-4000-8000-000000000002',current_setting('test.protocol_vector')::public.vector)),true);
do $$ begin
  assert public.authorize_protocol_sources('d0000000-0000-4000-8000-000000000002',current_setting('test.retrieved_protocol_sources')::jsonb),'Fresh RAG authorization rejected';
  assert not public.authorize_protocol_sources('d0000000-0000-4000-8000-000000000002',jsonb_build_array(jsonb_build_object('document_id',current_setting('test.protocol_source'),'authorization_revision',1))),'Missing review revision accepted';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select public.revoke_protocol_share(current_setting('test.protocol_grant')::uuid);
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.check_shared_protocol_access(current_setting('test.protocol_source')::uuid); raise exception 'Revoked source still readable'; exception when insufficient_privilege then null; end;
  assert (select count(*) from public.match_knowledge('d0000000-0000-4000-8000-000000000002',current_setting('test.protocol_vector')::public.vector))=0,'Revoked source still used by RAG';
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin assert not public.authorize_protocol_sources('d0000000-0000-4000-8000-000000000002',current_setting('test.retrieved_protocol_sources')::jsonb),'Revocation during generation did not block derived delivery'; end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select public.grant_protocol_share(current_setting('test.protocol_source')::uuid,'d0000000-0000-4000-8000-000000000002');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin assert not public.authorize_protocol_sources('d0000000-0000-4000-8000-000000000002',current_setting('test.retrieved_protocol_sources')::jsonb),'Regrant restored a stale RAG result'; end $$;
select set_config('test.owned_protocol_sources',(select jsonb_agg(jsonb_build_object('document_id',document_id,'authorization_revision',authorization_revision,'source_review_revision',source_review_revision))::text from public.match_knowledge('d0000000-0000-4000-8000-000000000001',current_setting('test.protocol_vector')::public.vector) where document_id=current_setting('test.protocol_source')::uuid),true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select public.review_knowledge_source(current_setting('test.protocol_source')::uuid,false);
select public.review_knowledge_source(current_setting('test.protocol_source')::uuid,true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin assert not public.authorize_protocol_sources('d0000000-0000-4000-8000-000000000001',current_setting('test.owned_protocol_sources')::jsonb),'Source retirement/reapproval restored stale owned RAG authorization'; end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select public.review_knowledge_source(current_setting('test.protocol_source')::uuid,false);
select set_config('test.protocol_next',public.create_knowledge_source('Shared source v2','New original reviewed protocol source.','Synthetic society','v2',current_setting('test.protocol_source')::uuid)::text,true);
select public.review_knowledge_source(current_setting('test.protocol_next')::uuid,true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.begin_knowledge_index('d0000000-0000-4000-8000-000000000001',current_setting('test.protocol_next')::uuid);
select public.finish_knowledge_index('d0000000-0000-4000-8000-000000000001',current_setting('test.protocol_next')::uuid,1,jsonb_build_array(jsonb_build_object('content','New original reviewed protocol source.','embedding',current_setting('test.protocol_vector')::jsonb)));
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.get_shared_protocol(current_setting('test.protocol_source')::uuid); raise exception 'Retired source still readable'; exception when insufficient_privilege then null; end;
  begin perform public.get_shared_protocol(current_setting('test.protocol_next')::uuid); raise exception 'Successor version inherited permission'; exception when insufficient_privilege then null; end;
  assert (select count(*) from public.match_knowledge('d0000000-0000-4000-8000-000000000002',current_setting('test.protocol_vector')::public.vector))=0,'Successor version inherited RAG permission';
end $$;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select public.grant_protocol_share(current_setting('test.protocol_next')::uuid,'d0000000-0000-4000-8000-000000000002');
select public.offboard_clinic_doctor(current_setting('test.protocol_clinic')::uuid,'d0000000-0000-4000-8000-000000000002');
select public.invite_clinic_doctor(current_setting('test.protocol_clinic')::uuid,'protocol-share-reader@example.invalid');
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
select public.respond_clinic_invitation(current_setting('test.protocol_clinic')::uuid,true);
do $$ begin
  begin perform public.get_shared_protocol(current_setting('test.protocol_next')::uuid); raise exception 'Offboarding/reactivation resurrected old access'; exception when insufficient_privilege then null; end;
  assert jsonb_array_length(public.protocol_sharing_overview()->'received')=0,'Offboarded protocol remains in overview';
end $$;
rollback;
