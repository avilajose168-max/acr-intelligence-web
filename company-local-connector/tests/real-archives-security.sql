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
insert into public.acr_corporate_investigations(id,organization_id,owner_id,local_case_id,title,equipment,payload) values
('ac200000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002','qa-closed','QA closed','QA pump',jsonb_build_object('id','qa-closed','title','QA closed','actions',jsonb_build_array(jsonb_build_object('description','Cambiar rodamiento','status','Completado')),'photos',jsonb_build_array(jsonb_build_object('data','data:image/png;base64,'||repeat('QUFB',80000))))),
('ac200000-0000-4000-8000-000000000002','ac100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002','qa-active','QA active','QA motor','{"id":"qa-active","actions":[{"description":"Inspeccionar motor","status":"En curso"}]}');
do $$
declare org constant uuid:='ac100000-0000-4000-8000-000000000001';admin constant uuid:='ac000000-0000-4000-8000-000000000001';member constant uuid:='ac000000-0000-4000-8000-000000000002';rid constant uuid:='ac200000-0000-4000-8000-000000000001';
 pair jsonb;bind jsonb;aid uuid;job jsonb;result jsonb;data bytea:=''::bytea;chunk text;off integer;denied boolean;retrieval uuid;previous integer;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated')::text,true);set local role authenticated;
 perform public.acr_local_storage_configure(org,'QA version 2','C:\ACR_Prueba_Servidor\Empresa_Demo');pair:=public.acr_local_storage_pairing(org);
 set local role anon;bind:=public.acr_local_connector_pair(pair->>'code');
 perform public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','poll');
 denied:=false;begin perform public.acr_real_archives('list',org);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'anonymous archive API access';end if;
 set local role authenticated;
 result:=public.acr_real_archives('auto',org,null,0,true);
 if result->>'queued'<>'1' then raise exception 'automatic copy included active case: %',result;end if;
 result:=public.acr_real_archives('copy',org,rid);aid:=(result->>'id')::uuid;
 if jsonb_array_length(public.acr_real_archives('list',org))<>1 then raise exception 'idempotent queue failed';end if;
 denied:=false;begin perform public.acr_real_archives('copy','ac100000-0000-4000-8000-000000000002',rid);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'cross-company copy allowed';end if;
 set local role anon;job:=public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','poll')->'job';
 if job->>'kind'<>'write_archive' or (job->>'size')::integer<=262144 then raise exception 'expected multi-chunk write';end if;
 for off in 0..(((job->>'size')::integer-1)/262144) loop
  chunk:=public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','download',(job->>'id')::uuid,(job->>'lease_id')::uuid,off*262144)->>'data';data:=data||decode(chunk,'base64');
 end loop;
 denied:=false;begin perform public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','complete',(job->>'id')::uuid,(job->>'lease_id')::uuid,0,null,job->>'checksum');exception when others then denied:=true;end;if not denied then raise exception 'empty disk verification accepted';end if;
 denied:=false;begin perform public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','upload',(job->>'id')::uuid,(job->>'lease_id')::uuid,262144,encode(substring(data from 1 for 5),'base64'));exception when others then denied:=true;end;if not denied then raise exception 'out of order block accepted';end if;
 for off in 0..((octet_length(data)-1)/262144) loop
  chunk:=encode(substring(data from off*262144+1 for 262144),'base64');
  perform public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','upload',(job->>'id')::uuid,(job->>'lease_id')::uuid,off*262144,chunk);
  perform public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','upload',(job->>'id')::uuid,(job->>'lease_id')::uuid,off*262144,chunk);
 end loop;
 perform public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','complete',(job->>'id')::uuid,(job->>'lease_id')::uuid,0,null,job->>'checksum');
 denied:=false;begin perform public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','complete',(job->>'id')::uuid,(job->>'lease_id')::uuid,0,null,job->>'checksum');exception when others then denied:=true;end;if not denied then raise exception 'replayed complete accepted';end if;
 reset role;
 if exists(select 1 from acr_connector_private.archives where id=aid and package_bytes is not null) then raise exception 'write staging copy retained';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);set local role authenticated;
 result:=public.acr_real_archives('list',null);if jsonb_array_length(result)<>1 then raise exception 'owner cannot find local archive';end if;
 if result->0 ? 'relative_path' then raise exception 'filesystem path exposed to normal user';end if;
 denied:=false;begin perform public.acr_real_archives('copy',org,rid);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'member can queue copies';end if;
 retrieval:=(public.acr_real_archives('retrieve',null,aid)->>'id')::uuid;
 set local role anon;job:=public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','poll')->'job';
 if job->>'kind'<>'read_archive' then raise exception 'expected disk retrieval';end if;
 denied:=false;begin perform public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','download',(job->>'id')::uuid,(job->>'lease_id')::uuid);exception when others then denied:=true;end;if not denied then raise exception 'read can download cloud data';end if;
 for off in 0..((octet_length(data)-1)/262144) loop perform public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','upload',(job->>'id')::uuid,(job->>'lease_id')::uuid,off*262144,encode(substring(data from off*262144+1 for 262144),'base64'));end loop;
 perform public.acr_archive_worker((bind->>'connector_id')::uuid,bind->>'token','complete',(job->>'id')::uuid,(job->>'lease_id')::uuid,0,null,job->>'checksum');
 set local role authenticated;result:=public.acr_real_archives('read',null,aid,0);
 if decode(result->>'data','base64')<>substring(data from 1 for 262144) then raise exception 'retrieved bytes changed';end if;
 perform set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
 if jsonb_array_length(public.acr_real_archives('list',org))<>0 then raise exception 'outsider can list';end if;
 denied:=false;begin perform public.acr_real_archives('read',null,aid);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'outsider can read';end if;
 reset role;
 select count(*) into previous from acr_connector_private.archives;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 insert into public.acr_followup_events(investigation_id,kind,action_key,actor_id,data) values('ac200000-0000-4000-8000-000000000002','execution','0:inspeccionar motor',member,'{"date":"2026-11-15","performed":"Inspección realizada","files":[{"data":"data:application/pdf;base64,JVBERi0xLjQK"}]}');
 if (select count(*) from acr_connector_private.archives)<>previous+1 then raise exception 'execution did not queue completed report';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated')::text,true);
 update public.acr_memberships set status='rejected' where organization_id=org and user_id=member;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);set local role authenticated;
 denied:=false;begin perform public.acr_real_archives('read',null,aid);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'removed member retains document access';end if;
 reset role;
 if (select count(*) from public.acr_corporate_investigations where organization_id=org)<>2 or (select octet_length(payload::text) from public.acr_corporate_investigations where id=rid)<262144 then raise exception 'cloud original modified';end if;
 if has_table_privilege('authenticated','acr_connector_private.archives','select') or has_table_privilege('anon','acr_connector_private.archive_jobs','select') then raise exception 'private archive table exposed';end if;
end $$;
select 'PASS: multichunk disk verification, no cloud copy on retrieval, owner/admin permissions, revocation, auto completed-only, idempotency, private paths and cloud originals preserved' as result;
rollback;
