create table public.acr_followup_events (
 id bigint generated always as identity primary key,
 investigation_id uuid not null references public.acr_corporate_investigations(id) on delete cascade,
 kind text not null check (kind in ('execution','effectiveness','review','lesson')),
 action_key text not null default '',
 data jsonb not null check (jsonb_typeof(data)='object' and octet_length(data::text)<=8000000),
 actor_id uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now()
);
create index acr_followup_events_investigation_idx on public.acr_followup_events(investigation_id,id desc);
create index acr_followup_events_actor_idx on public.acr_followup_events(actor_id);
alter table public.acr_followup_events enable row level security;
revoke all on public.acr_followup_events from anon,authenticated;
grant select,insert on public.acr_followup_events to authenticated;
grant usage,select on sequence public.acr_followup_events_id_seq to authenticated;
create policy "visible investigation followup" on public.acr_followup_events for select to authenticated using (
 exists(select 1 from public.acr_corporate_investigations c where c.id=investigation_id)
);
create policy "authorized followup append" on public.acr_followup_events for insert to authenticated with check (
 actor_id=(select auth.uid()) and
 exists(select 1 from public.acr_corporate_investigations c where c.id=investigation_id
 and ((kind='execution' and c.owner_id=(select auth.uid()) and acr_private.is_approved_member(c.organization_id,(select auth.uid())))
 or acr_private.is_org_admin(c.organization_id,(select auth.uid()))))
);
-- Server-owned identity and timestamp; attachment envelope supports three 2 MiB files.
revoke insert on public.acr_followup_events from authenticated;
grant insert(investigation_id,kind,action_key,data) on public.acr_followup_events to authenticated;
alter table public.acr_followup_events drop constraint acr_followup_events_data_check;
alter table public.acr_followup_events add constraint acr_followup_events_data_check check(jsonb_typeof(data)='object' and octet_length(data::text)<=9000000);
