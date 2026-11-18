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
do $$
declare oid constant uuid:='ad100000-0000-4000-8000-000000000001';doc jsonb;v2 jsonb;denied boolean;counted integer;input jsonb:='{"category":"protocolo","code":"PR-QA-001","title":"Protocolo de cambio de sello","revision":"1.0","area":"Área Húmeda","sector":"AGUAS CALAMA","equipment":"BBA AGUA CALAMA #1","equipment_sap":"51 PMP001","extension":"pdf","original_name":"protocolo.pdf","byte_size":9,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"}';
begin
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000001","role":"authenticated"}',true);set local role authenticated;
 doc:=public.acr_manage_work_document('reserve',oid,null,input);
 denied:=false;begin perform public.acr_manage_work_document('publish',null,(doc->>'id')::uuid);exception when others then denied:=true;end;if not denied then raise exception 'published missing file';end if;
 insert into storage.objects(bucket_id,name,metadata) values('acr-work-documents',doc->>'storage_path','{"size":9,"mimetype":"application/pdf"}');
 doc:=public.acr_manage_work_document('publish',null,(doc->>'id')::uuid);
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 select count(*) into counted from public.acr_work_documents where organization_id=oid;if counted<>1 then raise exception 'member cannot see published protocol';end if;
 select count(*) into counted from storage.objects where bucket_id='acr-work-documents' and name=doc->>'storage_path';if counted<>1 then raise exception 'member cannot read published file';end if;
 denied:=false;begin perform public.acr_manage_work_document('reserve',oid,null,input);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'member can upload';end if;
 denied:=false;begin insert into storage.objects(bucket_id,name,metadata) values('acr-work-documents',oid::text||'/unauthorized.pdf','{"size":9,"mimetype":"application/pdf"}');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'unreserved upload allowed';end if;
 denied:=false;begin update public.acr_work_documents set organization_id='ad100000-0000-4000-8000-000000000002' where id=(doc->>'id')::uuid;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'direct metadata update allowed';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
 denied:=false;begin perform public.acr_manage_work_document('withdraw',null,(doc->>'id')::uuid);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'company admin can manage platform library';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
 select count(*) into counted from public.acr_work_documents where organization_id=oid;if counted<>0 then raise exception 'cross company metadata exposed';end if;
 select count(*) into counted from storage.objects where bucket_id='acr-work-documents' and name=doc->>'storage_path';if counted<>0 then raise exception 'cross company file exposed';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 v2:=public.acr_manage_work_document('reserve',oid,null,input||'{"revision":"2.0"}');
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 select count(*) into counted from public.acr_work_documents where id=(v2->>'id')::uuid;if counted<>0 then raise exception 'draft metadata exposed';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 insert into storage.objects(bucket_id,name,metadata) values('acr-work-documents',v2->>'storage_path','{"size":9,"mimetype":"application/pdf"}');
 v2:=public.acr_manage_work_document('publish',null,(v2->>'id')::uuid);
 select count(*) into counted from public.acr_work_documents where organization_id=oid and status='published';if counted<>1 then raise exception 'multiple current revisions';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 select count(*) into counted from storage.objects where bucket_id='acr-work-documents' and name=doc->>'storage_path';if counted<>0 then raise exception 'retired file still readable';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform public.acr_manage_work_document('restore',null,(doc->>'id')::uuid);
 denied:=false;begin perform public.acr_manage_work_document('reserve',oid,null,input||'{"revision":"3.0","extension":"html"}');exception when others then denied:=true;end;if not denied then raise exception 'active HTML upload allowed';end if;
 denied:=false;begin perform public.acr_manage_work_document('reserve',oid,null,input||'{"revision":"3.0","byte_size":10485761}');exception when others then denied:=true;end;if not denied then raise exception 'oversize upload allowed';end if;
 reset role;
 if exists(select 1 from storage.buckets where id='acr-work-documents' and public) then raise exception 'public bucket';end if;
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
 update public.acr_memberships set status='rejected' where organization_id=oid and user_id='ad000000-0000-4000-8000-000000000002';
 perform set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated"}',true);set local role authenticated;
 select count(*) into counted from public.acr_work_documents where organization_id=oid;if counted<>0 then raise exception 'removed member retains access';end if;
 set local role anon;
 denied:=false;begin perform public.acr_manage_work_document('reserve',oid,null,input);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'anonymous management';end if;
 reset role;
end $$;
select 'PASS: platform-only publishing, file reservation, version replacement/restore, company isolation, member consultation, revoked access and private storage' as result;
rollback;
