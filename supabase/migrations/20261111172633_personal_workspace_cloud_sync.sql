-- Personal workspace storage, isolated from corporate publication.
create table public.acr_personal_workspaces (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null,
 revision integer not null default 1 check (revision > 0),
 updated_at timestamptz not null default now(),
 constraint valid_personal_workspace check (
  jsonb_typeof(payload) = 'object' and payload ?& array['cases','settings']
  and jsonb_typeof(payload->'cases') = 'array'
  and jsonb_typeof(payload->'settings') = 'object'
  and octet_length(payload::text) <= 15000000
 )
);
alter table public.acr_personal_workspaces enable row level security;
revoke all on public.acr_personal_workspaces from public, anon, authenticated;
grant select, insert, update on public.acr_personal_workspaces to authenticated;
create policy personal_workspace_read on public.acr_personal_workspaces
 for select to authenticated using ((select auth.uid()) = owner_id);
create policy personal_workspace_create on public.acr_personal_workspaces
 for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy personal_workspace_update on public.acr_personal_workspaces
 for update to authenticated using ((select auth.uid()) = owner_id)
 with check ((select auth.uid()) = owner_id);

create function public.acr_save_personal_workspace(workspace_payload jsonb, expected_revision integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved_revision integer;
begin
 if auth.uid() is null then raise insufficient_privilege using message = 'Inicia sesión para guardar.'; end if;
 if expected_revision is null or expected_revision < 0 then
  raise invalid_parameter_value using message = 'Revisión inválida.';
 end if;
 if expected_revision = 0 then
  insert into public.acr_personal_workspaces(owner_id,payload,revision)
   values (auth.uid(),workspace_payload,1)
   on conflict (owner_id) do nothing returning revision into saved_revision;
 else
  update public.acr_personal_workspaces set payload=workspace_payload,
   revision=revision+1,updated_at=now()
   where owner_id=auth.uid() and revision=expected_revision
   returning revision into saved_revision;
 end if;
 if saved_revision is null then
  raise sqlstate '40001' using message = 'Otra sesión guardó cambios. Conserva ambas copias antes de continuar.';
 end if;
 return jsonb_build_object('revision',saved_revision);
end $$;
revoke all on function public.acr_save_personal_workspace(jsonb,integer) from public, anon;
grant execute on function public.acr_save_personal_workspace(jsonb,integer) to authenticated;
