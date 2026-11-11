begin;
create temporary table audit_test_ids(key text primary key,id uuid not null default gen_random_uuid());
insert into audit_test_ids(key) values('org_a'),('org_b'),('admin_a'),('admin_b'),('member_a'),('outsider');
grant select on audit_test_ids to authenticated;
insert into public.acr_organizations(id,name) select id,'AUDIT ROLLBACK TEST '||key||' '||id from audit_test_ids where key like 'org_%';
insert into auth.users(id,email,created_at,raw_user_meta_data)
 select id,key||'@audit-test.invalid',now(),'{}'::jsonb from audit_test_ids where key not like 'org_%';
insert into public.acr_memberships(organization_id,user_id,email,role,status,requested_role)
 select (select id from audit_test_ids where key='org_a'),id,key||'@audit-test.invalid',case when key='admin_a' then 'admin' else 'member' end,
 case when key='admin_a' then 'approved' else 'pending' end,case when key='admin_a' then 'admin' else 'member' end
 from audit_test_ids where key in ('admin_a','member_a');
insert into public.acr_memberships(organization_id,user_id,email,role,status,requested_role)
 select (select id from audit_test_ids where key='org_b'),id,key||'@audit-test.invalid','admin','approved','admin' from audit_test_ids where key='admin_b';
update auth.users set last_sign_in_at=now() where id=(select id from audit_test_ids where key='member_a');
set local role authenticated;
do $$
declare data jsonb; denied boolean; oa uuid; ob uuid; ma uuid;
begin
 select id into oa from audit_test_ids where key='org_a';select id into ob from audit_test_ids where key='org_b';select id into ma from audit_test_ids where key='member_a';
 perform set_config('request.jwt.claim.sub',(select id::text from audit_test_ids where key='outsider'),true);
 denied:=false;begin perform public.acr_read_access_console('users',oa);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL ordinary user could read directory';end if;
 perform set_config('request.jwt.claim.sub',(select id::text from audit_test_ids where key='admin_a'),true);
 data:=public.acr_read_access_console('users',oa);
 if (data->>'total')::int<>2 or jsonb_array_length(data->'rows')<>2 then raise exception 'FAIL company scope: %',data;end if;
 if exists(select 1 from jsonb_array_elements(data->'rows') r where r->>'email'='admin_b@audit-test.invalid') then raise exception 'FAIL cross-company leak';end if;
 denied:=false;begin perform public.acr_read_access_console('users',ob);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL admin could read other company';end if;
 denied:=false;begin perform public.acr_read_access_console('events',null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL company admin could read global events';end if;
 update public.acr_memberships set status='approved',approved_at=now() where user_id=ma and organization_id=oa;
 if not exists(select 1 from public.acr_access_audit where target_user_id=ma and event_type='membership_updated' and actor_label='admin_a@audit-test.invalid' and old_state->>'status'='pending' and new_state->>'status'='approved') then raise exception 'FAIL access change not captured';end if;
 if exists(select 1 from public.acr_access_audit where organization_id is distinct from oa) then raise exception 'FAIL direct RLS leak';end if;
 denied:=false;begin insert into public.acr_access_audit(event_type,target_user_id,actor_label) values('login',ma,'Forged');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL journal forgery permitted';end if;
 denied:=false;begin update public.acr_access_audit set actor_label='Forged' where target_user_id=ma;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL journal editing permitted';end if;
 denied:=false;begin delete from public.acr_access_audit where target_user_id=ma;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL journal deletion permitted';end if;
 delete from public.acr_memberships where user_id=ma and organization_id=oa;
 if not exists(select 1 from public.acr_access_audit where target_user_id=ma and event_type='membership_removed' and old_state->>'status'='approved' and new_state is null) then raise exception 'FAIL unlink not journaled';end if;
end $$;
reset role;
do $$
declare data jsonb;platform_id uuid;ma uuid;
begin
 select user_id into platform_id from public.acr_platform_admins limit 1;
 select id into ma from audit_test_ids where key='member_a';
 perform set_config('request.jwt.claim.sub',platform_id::text,true);
 data:=public.acr_read_access_console('users',null,'@audit-test.invalid');
 if (data->>'total')::int<>4 then raise exception 'FAIL platform cannot see independent user';end if;
 if not exists(select 1 from public.acr_access_audit where target_user_id=ma and event_type='registration') or not exists(select 1 from public.acr_access_audit where target_user_id=ma and event_type='login') then raise exception 'FAIL authentication triggers';end if;
 if (public.acr_read_access_console('events',null,'@audit-test.invalid','login')->>'total')::int<>1 then raise exception 'FAIL event filter';end if;
 if jsonb_array_length(public.acr_read_access_console('users',null,'@audit-test.invalid','',null,null,50)->'rows')<>0 then raise exception 'FAIL pagination';end if;
end $$;
set local role anon;
do $$
declare denied boolean:=false;
begin
 begin perform public.acr_read_access_console('users');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL anonymous directory access';end if;
end $$;
reset role;
rollback;
select 'PASS: registration/login, directory scope, cross-company denial, actor + before/after, journal immutability, event filter and pagination; all fixtures rolled back' as verification;
