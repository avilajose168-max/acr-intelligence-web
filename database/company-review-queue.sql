create or replace function acr_private.guard_company_review_decision() returns trigger language plpgsql set search_path='' as $$
declare source jsonb;owner uuid;org uuid;label text;
begin
 if new.kind<>'review' then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.investigation_id::text,0));
 select c.payload,c.owner_id,c.organization_id into source,owner,org from public.acr_corporate_investigations c where c.id=new.investigation_id;
 if source is null or auth.uid() is null or owner=auth.uid() or not acr_private.is_org_admin(org,auth.uid()) or coalesce(source->'reviewRequest'->>'id','')='' or coalesce(source->'reviewRequest'->>'version','')='' or source->'reviewRequest'->>'id' is distinct from new.data->>'requestId' or source->'reviewRequest'->>'version' is distinct from new.data->>'version'
 then raise exception 'La revisión requiere una solicitud vigente y otro administrador autorizado de la compañía.' using errcode='42501';end if;
 if coalesce(new.data->>'result','') not in ('En revisión','Solicitar ajustes','Validado') or length(trim(coalesce(new.data->>'notes','')))=0 then raise exception 'Indica una decisión válida y su fundamento.' using errcode='23514';end if;
 if exists(select 1 from public.acr_followup_events e where e.investigation_id=new.investigation_id and e.kind='review' and e.data->>'requestId'=new.data->>'requestId' and e.data->>'version'=new.data->>'version' and e.data->>'result' in ('Validado','Solicitar ajustes')) then raise exception 'Esta solicitud ya fue resuelta. Actualiza la bandeja.' using errcode='42501';end if;
 select x->>'label' into label from jsonb_array_elements(acr_private.company_reviewers(org)) x where x->>'id'=auth.uid()::text;
 new.data:=new.data||jsonb_build_object('reviewer',coalesce(label,'Administrador general'),'reviewerId',auth.uid());
 return new;
end $$;