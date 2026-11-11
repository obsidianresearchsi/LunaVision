-- Step 01/17: 202611100001_workspaces.sql
begin;
create table public.lv_workspaces (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 2 and 100),
 kind text not null check (kind in ('agency','business'))
);
create table public.lv_memberships (
 workspace_id uuid references public.lv_workspaces on delete cascade,
 user_id uuid references auth.users on delete cascade,
 role text not null check (role in ('owner','member')),
 primary key(workspace_id,user_id)
);
create table public.lv_platform_admins (user_id uuid primary key references auth.users on delete cascade);
create table public.lv_records (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.lv_workspaces on delete cascade,
 category text not null check (category in ('investigation','incident','site')),
 title text not null check (length(trim(title)) between 2 and 140),
 details text not null default '' check(length(details)<=4000),
 created_at timestamptz not null default now()
);
create index lv_records_workspace on public.lv_records(workspace_id,created_at desc);
alter table public.lv_workspaces enable row level security;
alter table public.lv_memberships enable row level security;
alter table public.lv_platform_admins enable row level security;
alter table public.lv_records enable row level security;
revoke all on public.lv_workspaces, public.lv_memberships, public.lv_platform_admins, public.lv_records from public, anon, authenticated;
grant select on public.lv_workspaces, public.lv_memberships, public.lv_platform_admins, public.lv_records to authenticated;
grant insert(workspace_id,category,title,details) on public.lv_records to authenticated;
create policy lv_own_membership on public.lv_memberships for select to authenticated using (user_id=(select auth.uid()));
create policy lv_own_admin on public.lv_platform_admins for select to authenticated using (user_id=(select auth.uid()));
create policy lv_workspace_read on public.lv_workspaces for select to authenticated using (
 exists(select 1 from public.lv_memberships m where m.workspace_id=id and m.user_id=(select auth.uid()))
 or (kind='agency' and exists(select 1 from public.lv_platform_admins a where a.user_id=(select auth.uid())))
);
create policy lv_record_read on public.lv_records for select to authenticated using (
 exists(select 1 from public.lv_memberships m where m.workspace_id=lv_records.workspace_id and m.user_id=(select auth.uid()))
);
create policy lv_record_create on public.lv_records for insert to authenticated with check (
 exists(select 1 from public.lv_memberships m join public.lv_workspaces w on w.id=m.workspace_id
 where m.workspace_id=lv_records.workspace_id and m.user_id=(select auth.uid())
 and ((w.kind='agency' and category='investigation') or (w.kind='business' and category in ('incident','site'))))
);
create function public.lv_create_business(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid; actor uuid := auth.uid();
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null)
 then raise exception 'A confirmed account is required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
 if exists(select 1 from public.lv_memberships m join public.lv_workspaces w on w.id=m.workspace_id where m.user_id=actor and w.kind='business' and m.role='owner')
 then raise exception 'This account already owns a business workspace'; end if;
 insert into public.lv_workspaces(name,kind) values(trim(workspace_name),'business') returning id into new_id;
 insert into public.lv_memberships values(new_id,actor,'owner');
 return new_id;
end $$;
create function public.lv_create_agency(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not exists(select 1 from public.lv_platform_admins where user_id=auth.uid())
 then raise exception 'Platform administrator required'; end if;
 insert into public.lv_workspaces(name,kind) values(trim(workspace_name),'agency') returning id into new_id;
 return new_id;
end $$;
create function public.lv_agency_access(agency_id uuid, account_email text, allow_access boolean) returns void
language plpgsql security definer set search_path='' as $$
declare member_id uuid;
begin
 if not exists(select 1 from public.lv_platform_admins where user_id=auth.uid())
 then raise exception 'Platform administrator required'; end if;
 if not exists(select 1 from public.lv_workspaces where id=agency_id and kind='agency')
 then raise exception 'Agency workspace required'; end if;
 select id into member_id from auth.users where lower(email)=lower(trim(account_email)) and email_confirmed_at is not null;
 if member_id is null then raise exception 'A confirmed Auth account is required'; end if;
 if allow_access then insert into public.lv_memberships values(agency_id,member_id,'member') on conflict do nothing;
 else delete from public.lv_memberships where workspace_id=agency_id and user_id=member_id; end if;
end $$;
revoke all on function public.lv_create_business(text),public.lv_create_agency(text),public.lv_agency_access(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.lv_create_business(text),public.lv_create_agency(text),public.lv_agency_access(uuid,text,boolean) to authenticated;
commit;
