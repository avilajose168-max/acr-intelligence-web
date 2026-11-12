begin;
create temporary table independent_test(k text primary key,id uuid default gen_random_uuid());insert into independent_test(k) values('independent'),('dual'),('company'),('org');grant select on independent_test to authenticated;
insert into auth.users(id,email,raw_user_meta_data,created_at) select id,k||'@ind-fixture.invalid',jsonb_build_object('display_name','Fixture '||k)||case when k='company' then jsonb_build_object('acr_organization_id',(select id::text from independent_test where k='org')) else '{}'::jsonb end,now() from independent_test where k<>'org';
insert into public.acr_organizations(id,name) select id,'INDEPENDENT ROLLBACK' from independent_test where k='org';
insert into public.acr_memberships(organization_id,user_id,email,role,status,requested_role) select (select id from independent_test where k='org'),id,k||'@ind-fixture.invalid','admin','approved','admin' from independent_test where k in ('dual','company');
set local role authenticated;
select set_config('request.jwt.claim.sub','056ddac8-3be8-4b98-b616-7c1f58f6583b',true);
insert into public.acr_independent_subscriptions(user_id,trial_start,updated_by) values((select id from independent_test where k='independent'),'2026-11-12',auth.uid());
do $$declare names jsonb;begin
names:=public.acr_independent_clients(0);
if not exists(select 1 from jsonb_array_elements(names) x where x->>'user_id'=(select id::text from independent_test where k='independent') and x->>'trial_end'='2026-12-12') then raise exception 'FAIL independent automatic 30 days';end if;
if not exists(select 1 from jsonb_array_elements(names) x where x->>'user_id'=(select id::text from independent_test where k='dual') and x->>'companies'='INDEPENDENT ROLLBACK') then raise exception 'FAIL dual account';end if;
if exists(select 1 from jsonb_array_elements(names) x where x->>'user_id'=(select id::text from independent_test where k='company')) then raise exception 'FAIL company signup conflated';end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from independent_test where k='dual'),true);
do $$declare denied boolean:=false;n int;begin
if exists(select 1 from public.acr_independent_subscriptions where user_id=(select id from independent_test where k='independent')) then raise exception 'FAIL company admin subscription visibility';end if;
begin perform public.acr_independent_clients(0);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL unauthorized directory';end if;
denied:=false;begin insert into public.acr_independent_subscriptions(user_id,updated_by) values(auth.uid(),auth.uid());exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL self modification';end if;
end $$;
reset role;rollback;
select 'PASS: platform-only directory/write, company administrator and self-service denied, exact generated 30 days, independent+company dual context preserved. Fixtures rolled back.' as result;