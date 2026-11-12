begin;
create temporary table billing_fixture(k text primary key,id uuid default gen_random_uuid());insert into billing_fixture(k) values('org'),('member');grant select on billing_fixture to authenticated;
insert into auth.users(id,email,raw_user_meta_data) select id,'billing-fixture@example.invalid','{}' from billing_fixture where k='member';
insert into public.acr_organizations(id,name) select id,'BILLING ROLLBACK TEST' from billing_fixture where k='org';
insert into public.acr_memberships(organization_id,user_id,email,role,status,requested_role) values((select id from billing_fixture where k='org'),(select id from billing_fixture where k='member'),'billing-fixture@example.invalid','admin','approved','admin');
set local role authenticated;
select set_config('request.jwt.claim.sub','056ddac8-3be8-4b98-b616-7c1f58f6583b',true);
insert into public.acr_client_subscriptions(organization_id,plan_name,monthly_amount,currency,updated_by) values((select id from billing_fixture where k='org'),'Piloto',123,'USD',auth.uid());
do $$begin if not exists(select 1 from public.acr_client_subscriptions where organization_id=(select id from billing_fixture where k='org') and monthly_amount=123) then raise exception 'FAIL platform save/read';end if;end $$;
select set_config('request.jwt.claim.sub',(select id::text from billing_fixture where k='member'),true);
do $$declare count_rows int;denied boolean:=false;begin
if exists(select 1 from public.acr_client_subscriptions where organization_id=(select id from billing_fixture where k='org')) then raise exception 'FAIL company admin commercial read';end if;
update public.acr_client_subscriptions set monthly_amount=999 where organization_id=(select id from billing_fixture where k='org');get diagnostics count_rows=row_count;if count_rows<>0 then raise exception 'FAIL company admin write';end if;
begin insert into public.acr_client_subscriptions(organization_id,updated_by) values((select id from billing_fixture where k='org'),auth.uid());exception when insufficient_privilege then denied:=true;end;
if not denied then raise exception 'FAIL unauthorized subscription creation';end if;end $$;
reset role;
rollback;
select 'PASS: platform administrator saves/reads, company administrator cannot read/write/create commercial data; fixtures rolled back.' as result;