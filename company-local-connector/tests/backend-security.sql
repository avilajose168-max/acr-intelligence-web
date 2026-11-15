begin;
insert into auth.users(id,email,aud,role) values
('ac000000-0000-4000-8000-000000000001','acr-connector-admin-qa@example.invalid','authenticated','authenticated'),
('ac000000-0000-4000-8000-000000000002','acr-connector-user-qa@example.invalid','authenticated','authenticated'),
('ac000000-0000-4000-8000-000000000003','acr-connector-outsider-qa@example.invalid','authenticated','authenticated');
insert into public.acr_platform_access(user_id,status) values
('ac000000-0000-4000-8000-000000000001','approved'),('ac000000-0000-4000-8000-000000000002','approved'),('ac000000-0000-4000-8000-000000000003','approved')
on conflict(user_id) do update set status='approved';
insert into public.acr_organizations(id,name,active) values
('ac100000-0000-4000-8000-000000000001','QA connector company A',true),('ac100000-0000-4000-8000-000000000002','QA connector company B',true);
insert into public.acr_memberships(organization_id,user_id,display_name,email,role,status) values
('ac100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000001','QA Admin','acr-connector-admin-qa@example.invalid','admin','approved'),
('ac100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002','QA User','acr-connector-user-qa@example.invalid','member','approved'),
('ac100000-0000-4000-8000-000000000002','ac000000-0000-4000-8000-000000000003','QA Outsider','acr-connector-outsider-qa@example.invalid','admin','approved');
do $$
declare a constant uuid:='ac100000-0000-4000-8000-000000000001';b constant uuid:='ac100000-0000-4000-8000-000000000002';
 pairing jsonb;linked jsonb;job jsonb;probe jsonb;retrieval jsonb;body text;result jsonb;denied boolean;
begin
 perform set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 set local role authenticated;
 result:=public.acr_local_storage_configure(a,'QA server','C:\ACR_Prueba_Servidor\Empresa_Demo');
 if not (result->>'configured')::boolean then raise exception 'configuration failed';end if;
 if result ? 'token_hash' or result ? 'pairing_hash' then raise exception 'secret leak';end if;
 denied:=false;begin perform public.acr_local_storage_status(b);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'cross-company admin access';end if;
 perform set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 denied:=false;begin perform public.acr_local_storage_status(a);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'normal member can see server';end if;
 denied:=false;begin perform public.acr_local_storage_configure(a,'Bad server','C:\Other');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'normal member can configure';end if;
 perform set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 pairing:=public.acr_local_storage_pairing(a);
 set local role anon;
 denied:=false;begin perform public.acr_local_storage_status(a);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'anonymous admin RPC';end if;
 denied:=false;begin perform public.acr_local_connector_pair('ACR1-'||repeat('0',48));exception when invalid_authorization_specification then denied:=true;end;if not denied then raise exception 'invalid code accepted';end if;
 linked:=public.acr_local_connector_pair(pairing->>'code');
 if length(linked->>'token')<>64 then raise exception 'weak connector secret';end if;
 denied:=false;begin perform public.acr_local_connector_pair(pairing->>'code');exception when invalid_authorization_specification then denied:=true;end;if not denied then raise exception 'reused pairing accepted';end if;
 denied:=false;begin perform public.acr_local_connector_poll((linked->>'connector_id')::uuid,repeat('0',64));exception when invalid_authorization_specification then denied:=true;end;if not denied then raise exception 'invalid secret accepted';end if;
 set local role authenticated;
 probe:=public.acr_local_storage_probe(a);
 set local role anon;
 job:=public.acr_local_connector_poll((linked->>'connector_id')::uuid,linked->>'token')->'job';
 if job->>'kind'<>'write_probe' or job->>'id'<>probe->>'id' then raise exception 'wrong lease';end if;
 body:=convert_from(decode(job->>'content_base64','base64'),'UTF8');
 denied:=false;begin perform public.acr_local_connector_complete((linked->>'connector_id')::uuid,linked->>'token',(job->>'id')::uuid,(job->>'lease_id')::uuid,'changed',job->>'expected_hash');exception when others then denied:=true;end;if not denied then raise exception 'false save acknowledgement accepted';end if;
 perform public.acr_local_connector_complete((linked->>'connector_id')::uuid,linked->>'token',(job->>'id')::uuid,(job->>'lease_id')::uuid,body,job->>'expected_hash');
 denied:=false;begin perform public.acr_local_connector_complete((linked->>'connector_id')::uuid,linked->>'token',(job->>'id')::uuid,(job->>'lease_id')::uuid,body,job->>'expected_hash');exception when others then denied:=true;end;if not denied then raise exception 'replay accepted';end if;
 set local role authenticated;
 retrieval:=public.acr_local_storage_retrieve(a,(probe->>'id')::uuid);
 set local role anon;
 job:=public.acr_local_connector_poll((linked->>'connector_id')::uuid,linked->>'token')->'job';
 if job->>'kind'<>'read_probe' or job->>'content_base64' is not null then raise exception 'read supplied from cloud rather than disk';end if;
 perform public.acr_local_connector_complete((linked->>'connector_id')::uuid,linked->>'token',(job->>'id')::uuid,(job->>'lease_id')::uuid,body,job->>'expected_hash');
 set local role authenticated;
 result:=public.acr_local_storage_status(a);
 if not exists(select 1 from jsonb_array_elements(result->'jobs')j where j->>'kind'='read_probe' and j->>'state'='verified' and j->>'returned_content'=body) then raise exception 'retrieval not visible';end if;
 perform public.acr_local_storage_revoke(a);
 set local role anon;
 denied:=false;begin perform public.acr_local_connector_poll((linked->>'connector_id')::uuid,linked->>'token');exception when invalid_authorization_specification then denied:=true;end;if not denied then raise exception 'revoked secret accepted';end if;
 reset role;
 if has_table_privilege('anon','acr_connector_private.settings','select') or has_table_privilege('authenticated','acr_connector_private.settings','select') then raise exception 'private configuration exposed';end if;
end $$;
select 'PASS: admin-only configuration, company isolation, anonymous denial, one-use pairing, secret validation, leased save, checksum rejection, replay rejection, disk-read retrieval, revocation and private table ACLs' as result;
rollback;
