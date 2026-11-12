create table public.acr_shift_handover_notes (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.acr_organizations(id) on delete cascade,
 owner_id uuid not null default auth.uid() references auth.users(id),
 handover_key text not null check (length(handover_key) between 1 and 300),
 data jsonb not null check (jsonb_typeof(data)='object' and octet_length(data::text)<=120000 and length(data->>'notes') between 1 and 30000 and data->>'period' in ('daily','weekly','custom') and data->>'shift' in ('A','B','all')),
 created_at timestamptz not null default now()
);
create index acr_shift_handover_org_idx on public.acr_shift_handover_notes(organization_id,id desc);
create index acr_shift_handover_owner_idx on public.acr_shift_handover_notes(owner_id);
alter table public.acr_shift_handover_notes enable row level security;
revoke all on public.acr_shift_handover_notes from anon,authenticated;
grant select on public.acr_shift_handover_notes to authenticated;
grant insert(organization_id,handover_key,data) on public.acr_shift_handover_notes to authenticated;
grant usage,select on sequence public.acr_shift_handover_notes_id_seq to authenticated;
create policy "scoped handover consultation" on public.acr_shift_handover_notes for select to authenticated using (
 acr_private.is_org_admin(organization_id,(select auth.uid())) or (owner_id=(select auth.uid()) and acr_private.is_approved_member(organization_id,(select auth.uid())))
);
create policy "approved handover author" on public.acr_shift_handover_notes for insert to authenticated with check (
 owner_id=(select auth.uid()) and (acr_private.is_org_admin(organization_id,(select auth.uid())) or acr_private.is_approved_member(organization_id,(select auth.uid())))
);
alter table public.acr_shift_handover_notes add constraint acr_shift_handover_required_fields check(data ?& array['notes','period','shift','from','to','start','end','reporter'] and length(data->>'reporter') between 1 and 180 and (data->>'from') ~ '^\d{4}-\d{2}-\d{2}$' and (data->>'to') ~ '^\d{4}-\d{2}-\d{2}$' and (data->>'start') <= (data->>'end'));
