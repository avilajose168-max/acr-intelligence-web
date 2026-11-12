create function acr_private.company_reviewers(p_org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not(acr_private.is_approved_member(p_org,auth.uid()) or acr_private.is_org_admin(p_org,auth.uid())) then raise exception 'No autorizado para consultar revisores de esta compañía' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'label',coalesce(nullif(m.display_name,''),'Administrador de compañía')) order by m.display_name) from public.acr_memberships m join public.acr_organizations o on o.id=m.organization_id where m.organization_id=p_org and m.role='admin' and m.status='approved' and o.active),'[]'::jsonb);
end $$;
revoke all on function acr_private.company_reviewers(uuid) from public;
grant execute on function acr_private.company_reviewers(uuid) to authenticated;
create function public.acr_company_reviewers(p_org uuid) returns jsonb language sql stable security invoker set search_path='' as $$select acr_private.company_reviewers(p_org)$$;
revoke all on function public.acr_company_reviewers(uuid) from public,anon;
grant execute on function public.acr_company_reviewers(uuid) to authenticated;
create function acr_private.guard_company_review_decision() returns trigger language plpgsql security invoker set search_path='' as $$
declare source jsonb;owner uuid;
begin
 if new.kind<>'review' then return new;end if;
 select c.payload,c.owner_id into source,owner from public.acr_corporate_investigations c where c.id=new.investigation_id;
 if source is null or owner=auth.uid() or source->'reviewRequest'->>'reviewerId' is distinct from auth.uid()::text or source->'reviewRequest'->>'id' is distinct from new.data->>'requestId' or source->'reviewRequest'->>'version' is distinct from new.data->>'version'
 then raise exception 'La revisión debe corresponder a una solicitud asignada a otro administrador. Actualiza el informe y la solicitud.' using errcode='42501';end if;
 if coalesce(new.data->>'result','') not in ('En revisión','Solicitar ajustes','Validado') or length(coalesce(new.data->>'notes',''))=0 then raise exception 'Indica una decisión válida y su fundamento.' using errcode='23514';end if;
 return new;
end $$;
revoke all on function acr_private.guard_company_review_decision() from public;
grant execute on function acr_private.guard_company_review_decision() to authenticated;
create trigger guard_company_review_decision before insert on public.acr_followup_events for each row execute function acr_private.guard_company_review_decision();