begin;
create temporary table followup_ids(k text primary key,id uuid default gen_random_uuid());
insert into followup_ids(k) values('org_a'),('org_b'),('admin_a'),('admin_b'),('owner'),('outsider'),('case_a'),('case_b');
grant select on followup_ids to authenticated;
insert into public.acr_organizations(id,name) select id,'FOLLOWUP ROLLBACK '||k||id from followup_ids where k like 'org_%';
insert into auth.users(id,email,created_at,raw_user_meta_data) select id,k||'@followup.invalid',now(),'{}'::jsonb from followup_ids where k in ('admin_a','admin_b','owner','outsider');
insert into public.acr_memberships(organization_id,user_id,email,role,status,requested_role)
select (select id from followup_ids where k='org_a'),id,k||'@followup.invalid',case when k='admin_a' then 'admin' else 'member' end,'approved',case when k='admin_a' then 'admin' else 'member' end from followup_ids where k in ('admin_a','owner');
insert into public.acr_memberships(organization_id,user_id,email,role,status,requested_role)
select (select id from followup_ids where k='org_b'),id,k||'@followup.invalid','admin','approved','admin' from followup_ids where k='admin_b';
insert into public.acr_corporate_investigations(id,organization_id,owner_id,local_case_id,title,equipment,payload)
select (select id from followup_ids where k='case_a'),(select id from followup_ids where k='org_a'),(select id from followup_ids where k='owner'),'followup-test','Test','Test','{}'::jsonb;
insert into public.acr_corporate_investigations(id,organization_id,owner_id,local_case_id,title,equipment,payload)
select (select id from followup_ids where k='case_b'),(select id from followup_ids where k='org_b'),(select id from followup_ids where k='admin_b'),'followup-test-b','Test','Test','{}'::jsonb;
set local role authenticated;
do $$ declare data jsonb;oa uuid;ob uuid;denied boolean;begin
select id into oa from followup_ids where k='org_a';select id into ob from followup_ids where k='org_b';
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='owner'),true);
data:=public.acr_company_reviewers(oa);
if jsonb_array_length(data)<>1 or data->0->>'id'<>(select id::text from followup_ids where k='admin_a') then raise exception 'FAIL approved administrator directory';end if;
if data->0 ? 'email' then raise exception 'FAIL unnecessary email disclosure';end if;
denied:=false;begin perform public.acr_company_reviewers(ob);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL other company reviewer directory';end if;
denied:=false;begin insert into public.acr_followup_events(investigation_id,kind,data) values((select id from followup_ids where k='case_a'),'review','{"result":"Validado"}');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL creator corporate validation';end if;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='outsider'),true);
denied:=false;begin perform public.acr_company_reviewers(oa);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL outsider directory';end if;
end $$;
reset role;
set local role anon;
do $$ declare denied boolean:=false;begin begin perform public.acr_company_reviewers((select id from followup_ids where k='org_a'));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL anonymous access';end if;end $$;
reset role;
rollback;
select 'PASS: approved company reviewer names only, cross-company and unaffiliated denial, creator cannot validate corporate analysis, anonymous denial; fixtures rolled back.' as result;
