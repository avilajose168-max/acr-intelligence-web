-- Disposable fixtures. Always execute in a transaction ending with ROLLBACK.
insert into auth.users(id,email,aud,role) values
('ad000000-0000-4000-8000-000000000001','work-doc-admin@example.invalid','authenticated','authenticated'),
('ad000000-0000-4000-8000-000000000002','work-doc-member@example.invalid','authenticated','authenticated'),
('ad000000-0000-4000-8000-000000000003','work-doc-outsider@example.invalid','authenticated','authenticated'),
('ad000000-0000-4000-8000-000000000004','work-doc-company-admin@example.invalid','authenticated','authenticated');
insert into public.acr_platform_admins(user_id) values('ad000000-0000-4000-8000-000000000001');
insert into public.acr_platform_access(user_id,status) values('ad000000-0000-4000-8000-000000000002','approved'),('ad000000-0000-4000-8000-000000000003','approved'),('ad000000-0000-4000-8000-000000000004','approved') on conflict(user_id) do update set status='approved';
insert into public.acr_organizations(id,name,active) values('ad100000-0000-4000-8000-000000000001','Work docs QA A',true),('ad100000-0000-4000-8000-000000000002','Work docs QA B',true);
insert into public.acr_memberships(organization_id,user_id,role,status,display_name,email) values
('ad100000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000002','member','approved','QA supervisor','work-doc-member@example.invalid'),
('ad100000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-000000000003','member','approved','QA outsider','work-doc-outsider@example.invalid'),
('ad100000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000004','admin','approved','QA company admin','work-doc-company-admin@example.invalid');
insert into acr_connector_private.settings(organization_id,connector_id,server_name,root_path,configured_by,token_hash,token_expires_at) values
('ad100000-0000-4000-8000-000000000001','ad200000-0000-4000-8000-000000000001','QA','C:\QA','ad000000-0000-4000-8000-000000000004',extensions.digest(convert_to(repeat('a',64),'UTF8'),'sha256'),now()+interval '1 day');
do $$
declare oid constant uuid:='ad100000-0000-4000-8000-000000000001';cid constant uuid:='ad200000-0000-4000-8000-000000000001';secret text:=repeat('a',64);doc jsonb;job jsonb;jid uuid;readjob uuid;denied boolean;n integer;raw bytea:=convert_to('%PDF QA binary','UTF8');hash text:=encode(extensions.digest(raw,'sha256'),'hex');input jsonb:='{"category":"protocolo","code":"PR-QA-001","title":"Protocolo de cambio de sello","revision":"1.0","area":"Área Húmeda","extension":"pdf","original_name":"protocolo.pdf"}';
begin
 input:=input||jsonb_build_object('byte_size',octet_length(raw),'sha256',hash);
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000001","role":"authenticated"}',true);set local role authenticated;
 denied:=false;begin perform public.acr_manage_work_document('reserve',oid,null,input);exception when others then denied:=true;end;if not denied then raise exception 'offline upload allowed';end if;
 set local role anon;
 denied:=false;begin perform public.acr_work_document_worker(cid,repeat('b',64),'poll');exception when sqlstate '28000' then denied:=true;end;if not denied then raise exception 'invalid connector allowed';end if;
 perform public.acr_work_document_worker(cid,secret,'poll');
 set local role authenticated;
 doc:=public.acr_manage_work_document('reserve',oid,null,input);
 if doc->>'storage_backend'<>'local' then raise exception 'not local default';end if;
 denied:=false;begin perform public.acr_manage_work_document('publish',null,(doc->>'id')::uuid);exception when others then denied:=true;end;if not denied then raise exception 'unverified published';end if;
 denied:=false;begin insert into storage.objects(bucket_id,name,metadata) values('acr-work-documents',doc->>'storage_path','{"size":14,"mimetype":"application/pdf"}');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'local file cloud storage allowed';end if;
 perform public.acr_work_document_transfer('begin_upload',(doc->>'id')::uuid);
 denied:=false;begin perform public.acr_work_document_transfer('append_upload',(doc->>'id')::uuid,null,null,1,encode(raw,'base64'));exception when others then denied:=true;end;if not denied then raise exception 'out of sequence accepted';end if;
 perform public.acr_work_document_transfer('append_upload',(doc->>'id')::uuid,null,null,0,encode(raw,'base64'));
 jid:=(public.acr_work_document_transfer('queue_upload',(doc->>'id')::uuid)->>'id')::uuid;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 select count(*) into n from public.acr_work_documents where id=(doc->>'id')::uuid;if n<>0 then raise exception 'draft exposed';end if;
 denied:=false;begin perform public.acr_work_document_transfer('begin_upload',(doc->>'id')::uuid);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'member upload';end if;
 set local role anon;job:=public.acr_work_document_worker(cid,secret,'poll')->'job';
 if job->>'kind'<>'work_write' or (job->>'id')::uuid<>jid then raise exception 'wrong job';end if;
 if decode(public.acr_work_document_worker(cid,secret,'download',jid,(job->>'lease_id')::uuid,0)->>'data','base64')<>raw then raise exception 'write bytes mismatch';end if;
 denied:=false;begin perform public.acr_work_document_worker(cid,secret,'complete',jid,(job->>'lease_id')::uuid,0,null,hash);exception when others then denied:=true;end;if not denied then raise exception 'ack without readback';end if;
 perform public.acr_work_document_worker(cid,secret,'upload',jid,(job->>'lease_id')::uuid,0,encode(raw,'base64'));
 perform public.acr_work_document_worker(cid,secret,'complete',jid,(job->>'lease_id')::uuid,0,null,hash);
 reset role;
 if exists(select 1 from acr_connector_private.work_files where document_id=(doc->>'id')::uuid and upload_bytes is not null) or exists(select 1 from acr_connector_private.work_jobs where id=jid and octet_length(received)>0) then raise exception 'write staging not cleared';end if;
 set local role authenticated;
 select count(*) into n from public.acr_work_documents where id=(doc->>'id')::uuid and status='published';if n<>1 then raise exception 'verified doc not visible';end if;
 readjob:=(public.acr_work_document_transfer('retrieve',(doc->>'id')::uuid)->>'id')::uuid;
 set local role anon;job:=public.acr_work_document_worker(cid,secret,'poll')->'job';
 denied:=false;begin perform public.acr_work_document_worker(cid,secret,'download',readjob,(job->>'lease_id')::uuid,0);exception when others then denied:=true;end;if not denied then raise exception 'read cloud fallback';end if;
 perform public.acr_work_document_worker(cid,secret,'upload',readjob,(job->>'lease_id')::uuid,0,encode(raw,'base64'));
 perform public.acr_work_document_worker(cid,secret,'complete',readjob,(job->>'lease_id')::uuid,0,null,hash);
 set local role authenticated;
 if decode(public.acr_work_document_transfer('read_chunk',(doc->>'id')::uuid,null,readjob,0)->>'data','base64')<>raw then raise exception 'retrieved bytes differ';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
 denied:=false;begin perform public.acr_work_document_transfer('read_chunk',(doc->>'id')::uuid,null,readjob,0);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'other user read job';end if;
 denied:=false;begin perform public.acr_manage_work_document('withdraw',null,(doc->>'id')::uuid);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'company admin manages general library';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
 denied:=false;begin perform public.acr_work_document_transfer('retrieve',(doc->>'id')::uuid);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'cross company read';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 perform public.acr_work_document_transfer('consume',(doc->>'id')::uuid,null,readjob);
 reset role;
 if exists(select 1 from acr_connector_private.work_jobs where id=readjob and octet_length(received)>0) then raise exception 'read staging not cleared';end if;
 update acr_connector_private.work_files set upload_bytes=raw,upload_started_at=now()-interval '25 hours' where document_id=(doc->>'id')::uuid;
 insert into acr_connector_private.work_jobs(document_id,organization_id,kind,requested_by,state,received,verified_at) values((doc->>'id')::uuid,oid,'work_read','ad000000-0000-4000-8000-000000000002','verified',raw,now()-interval '16 minutes');
 perform acr_connector_private.work_document_gc(null);
 if exists(select 1 from acr_connector_private.work_files where document_id=(doc->>'id')::uuid and upload_bytes is not null) or exists(select 1 from acr_connector_private.work_jobs where document_id=(doc->>'id')::uuid and octet_length(received)>0) then raise exception 'expiry failed';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
 update public.acr_memberships set status='rejected' where organization_id=oid and user_id='ad000000-0000-4000-8000-000000000002';
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated"}',true);set local role authenticated;
 denied:=false;begin perform public.acr_work_document_transfer('retrieve',(doc->>'id')::uuid);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'revoked user access';end if;
 reset role;
end $$;
select 'PASS: local binary transfer, disk readback proof, metadata publication, no Storage upload, company and requester isolation, expiry and consumption cleanup' as result;
rollback;
