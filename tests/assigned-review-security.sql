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

insert into followup_ids(k) values('admin_alt');
insert into auth.users(id,email,created_at,raw_user_meta_data) select id,'admin-alt@followup.invalid',now(),'{}'::jsonb from followup_ids where k='admin_alt';
insert into public.acr_memberships(organization_id,user_id,email,role,status,requested_role) select (select id from followup_ids where k='org_a'),id,'admin-alt@followup.invalid','admin','approved','admin' from followup_ids where k='admin_alt';
update public.acr_corporate_investigations set payload=jsonb_build_object('reviewRequest',jsonb_build_object('id','request-a','reviewerId',(select id::text from followup_ids where k='admin_a'),'version','v1')) where id=(select id from followup_ids where k='case_a');
update public.acr_corporate_investigations set payload=jsonb_build_object('reviewRequest',jsonb_build_object('id','self-request','reviewerId',(select id::text from followup_ids where k='admin_b'),'version','v1')) where id=(select id from followup_ids where k='case_b');
set local role authenticated;
do $$ declare ca uuid;cb uuid;denied boolean;payload jsonb;begin
select id into ca from followup_ids where k='case_a';select id into cb from followup_ids where k='case_b';
payload:='{"requestId":"request-a","version":"v1","result":"Validado","notes":"Evidencia revisada"}'::jsonb;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='owner'),true);
denied:=false;begin insert into public.acr_followup_events(investigation_id,kind,data) values(ca,'review',payload);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL author self approval';end if;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='admin_alt'),true);
denied:=false;begin insert into public.acr_followup_events(investigation_id,kind,data) values(ca,'review',payload);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL unassigned same-company administrator';end if;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='admin_a'),true);
denied:=false;begin insert into public.acr_followup_events(investigation_id,kind,data) values(ca,'review',payload||'{"version":"old"}');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL version mismatch';end if;
denied:=false;begin insert into public.acr_followup_events(investigation_id,kind,data) values(ca,'review',payload-'result');exception when check_violation then denied:=true;end;if not denied then raise exception 'FAIL blank decision';end if;
insert into public.acr_followup_events(investigation_id,kind,data) values(ca,'review',payload);
if not exists(select 1 from public.acr_followup_events where investigation_id=ca and actor_id=(select id from followup_ids where k='admin_a')) then raise exception 'FAIL assigned reviewer decision';end if;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='admin_b'),true);
denied:=false;begin insert into public.acr_followup_events(investigation_id,kind,data) values(cb,'review','{"requestId":"self-request","version":"v1","result":"Validado","notes":"Own report"}');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL administrator approved own report';end if;
end $$;
reset role;rollback;
select 'PASS: creators cannot self-approve; only assigned company administrator decides; request/version/result required; administrator cannot approve own report; all fixtures rolled back.' as result;
