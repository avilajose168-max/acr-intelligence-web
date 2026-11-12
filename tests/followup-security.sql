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
update public.acr_corporate_investigations set payload=jsonb_build_object('reviewRequest',jsonb_build_object('id','request-a','reviewerId',(select id::text from followup_ids where k='admin_a'),'version','v1')) where id=(select id from followup_ids where k='case_a');
set local role authenticated;
do $$
declare ca uuid;cb uuid;u uuid;denied boolean;cnt int;
begin
select id into ca from followup_ids where k='case_a';select id into cb from followup_ids where k='case_b';select id into u from followup_ids where k='owner';
perform set_config('request.jwt.claim.sub',u::text,true);
insert into public.acr_followup_events(investigation_id,kind,action_key,data) values(ca,'execution','0:test','{"performed":"Test","date":"2026-11-11"}');
if not exists(select 1 from public.acr_followup_events where actor_id=u and created_at is not null) then raise exception 'FAIL actor/date';end if;
denied:=false;begin insert into public.acr_followup_events(investigation_id,kind,data) values(ca,'review','{}');exception when insufficient_privilege then denied:=true;end;
if not denied then raise exception 'FAIL member corporate validation';end if;
denied:=false;begin insert into public.acr_followup_events(investigation_id,kind,data,actor_id) values(ca,'execution','{}',(select id from followup_ids where k='admin_a'));exception when insufficient_privilege then denied:=true;end;
if not denied then raise exception 'FAIL forged actor';end if;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='admin_a'),true);
insert into public.acr_followup_events(investigation_id,kind,data) values(ca,'review','{"requestId":"request-a","version":"v1","result":"Validado","notes":"Evidencia revisada"}'),(ca,'lesson','{"active":true}'),(ca,'effectiveness','{"result":"Efectiva"}');
select count(*) into cnt from public.acr_followup_events;if cnt<>4 then raise exception 'FAIL admin read';end if;
denied:=false;begin insert into public.acr_followup_events(investigation_id,kind,data) values(cb,'review','{}');exception when insufficient_privilege then denied:=true;end;
if not denied then raise exception 'FAIL cross company append';end if;
denied:=false;begin update public.acr_followup_events set data='{}';exception when insufficient_privilege then denied:=true;end;
if not denied then raise exception 'FAIL journal modification';end if;
denied:=false;begin delete from public.acr_followup_events;exception when insufficient_privilege then denied:=true;end;
if not denied then raise exception 'FAIL journal deletion';end if;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='admin_b'),true);
select count(*) into cnt from public.acr_followup_events;if cnt<>0 then raise exception 'FAIL cross company read';end if;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='outsider'),true);
select count(*) into cnt from public.acr_followup_events;if cnt<>0 then raise exception 'FAIL outsider read';end if;
end $$;
reset role;
set local role anon;
do $$ declare denied boolean:=false;begin begin perform * from public.acr_followup_events;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL anonymous access';end if;end $$;
reset role;
rollback;
select 'PASS: author execution; admin review/effectiveness/lesson; cross-company and outsider isolation; server actor/date; append-only journal; anonymous denial. Fixtures rolled back.' as result;
