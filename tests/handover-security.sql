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
do $$
declare oa uuid;ob uuid;denied boolean;cnt int;payload jsonb;
begin
select id into oa from followup_ids where k='org_a';select id into ob from followup_ids where k='org_b';
payload:='{"notes":"Novedad de prueba","reporter":"QA","period":"daily","shift":"B","from":"2026-11-11","to":"2026-11-12","start":"2026-11-11T20:00","end":"2026-11-12T07:59"}'::jsonb;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='owner'),true);
insert into public.acr_shift_handover_notes(organization_id,handover_key,data) values(oa,'daily|B|QA',payload);
if not exists(select 1 from public.acr_shift_handover_notes where owner_id=(select id from followup_ids where k='owner') and created_at is not null) then raise exception 'FAIL saved identity/date';end if;
denied:=false;begin insert into public.acr_shift_handover_notes(organization_id,handover_key,data) values(ob,'bad',payload);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL cross-company insert';end if;
denied:=false;begin insert into public.acr_shift_handover_notes(organization_id,handover_key,data,owner_id) values(oa,'bad',payload,(select id from followup_ids where k='admin_a'));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL forged owner';end if;
denied:=false;begin insert into public.acr_shift_handover_notes(organization_id,handover_key,data) values(oa,'bad','{}');exception when check_violation then denied:=true;end;if not denied then raise exception 'FAIL blank payload';end if;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='admin_a'),true);
select count(*) into cnt from public.acr_shift_handover_notes;if cnt<>1 then raise exception 'FAIL company supervisor access';end if;
denied:=false;begin update public.acr_shift_handover_notes set data=payload;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL history rewrite';end if;
denied:=false;begin delete from public.acr_shift_handover_notes;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL history delete';end if;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='admin_b'),true);
select count(*) into cnt from public.acr_shift_handover_notes;if cnt<>0 then raise exception 'FAIL cross-company read';end if;
perform set_config('request.jwt.claim.sub',(select id::text from followup_ids where k='outsider'),true);
select count(*) into cnt from public.acr_shift_handover_notes;if cnt<>0 then raise exception 'FAIL outsider read';end if;
end $$;
reset role;
rollback;
select 'PASS: approved member save, admin company consultation, tenant isolation, immutable author/date, append-only history, required fields; all test data rolled back.' as result;
