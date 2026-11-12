create table if not exists public.acr_independent_subscriptions(
 user_id uuid primary key references auth.users(id) on delete cascade,
 plan_name text not null default 'Prueba gratuita · 30 días' check(length(plan_name) between 1 and 100),
 trial_start date,
 trial_end date generated always as (trial_start+30) stored,
 monthly_amount numeric(14,2) check(monthly_amount>=0),
 currency text not null default 'CLP' check(currency in ('CLP','USD','UF')),
 internal_notes text not null default '' check(length(internal_notes)<=2000),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id));
alter table public.acr_independent_subscriptions enable row level security;
revoke all on public.acr_independent_subscriptions from anon,authenticated;
grant select,insert,update on public.acr_independent_subscriptions to authenticated;
create policy "platform manages independent subscription reads" on public.acr_independent_subscriptions for select to authenticated using(acr_private.is_platform_admin((select auth.uid())));
create policy "platform manages independent subscription inserts" on public.acr_independent_subscriptions for insert to authenticated with check(acr_private.is_platform_admin((select auth.uid())) and updated_by=(select auth.uid()));
create policy "platform manages independent subscription updates" on public.acr_independent_subscriptions for update to authenticated using(acr_private.is_platform_admin((select auth.uid()))) with check(acr_private.is_platform_admin((select auth.uid())) and updated_by=(select auth.uid()));
create or replace function acr_private.independent_client_directory(p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not acr_private.is_platform_admin(auth.uid()) then raise exception 'Solo administración general' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(v)) from (
 select u.id as user_id,coalesce(nullif(p.display_name,''),nullif(u.raw_user_meta_data->>'display_name',''),nullif(u.raw_user_meta_data->>'full_name',''),'Nombre no registrado') as name,u.email,u.created_at as registered_at,
 coalesce((select string_agg(o.name,' · ' order by o.name) from public.acr_memberships m join public.acr_organizations o on o.id=m.organization_id where m.user_id=u.id and m.status='approved'),'') as companies,
 coalesce(s.plan_name,'Prueba gratuita · 30 días') as plan_name,s.trial_start,s.trial_end,s.monthly_amount,coalesce(s.currency,'CLP') as currency,coalesce(s.internal_notes,'') as internal_notes
 from auth.users u left join public.acr_profiles p on p.user_id=u.id left join public.acr_independent_subscriptions s on s.user_id=u.id
 where not exists(select 1 from public.acr_platform_admins a where a.user_id=u.id)
 and (coalesce(u.raw_user_meta_data->>'acr_organization_id','')='' or s.user_id is not null or not exists(select 1 from public.acr_memberships m where m.user_id=u.id and m.status='approved'))
 order by u.created_at desc,u.id limit 100 offset greatest(coalesce(p_offset,0),0)
 ) v),'[]'::jsonb);
end $$;
revoke all on function acr_private.independent_client_directory(integer) from public,anon;
grant execute on function acr_private.independent_client_directory(integer) to authenticated;
create or replace function public.acr_independent_clients(p_offset integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select acr_private.independent_client_directory(p_offset)$$;
revoke all on function public.acr_independent_clients(integer) from public,anon;
grant execute on function public.acr_independent_clients(integer) to authenticated;
notify pgrst,'reload schema';