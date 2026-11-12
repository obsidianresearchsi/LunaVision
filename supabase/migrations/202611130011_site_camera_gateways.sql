begin;

create table public.lv_camera_gateways (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.lv_workspaces on delete cascade,
 name text not null check(length(btrim(name)) between 2 and 100),
 endpoint text not null check(endpoint ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' or endpoint ~ '^http://(127[.]0[.]0[.]1|localhost):[0-9]{2,5}$'),
 token_hash bytea not null unique check(octet_length(token_hash)=32),
 clearance integer not null check(clearance between 0 and 3), enabled boolean not null default true,
 last_seen_at timestamptz, created_at timestamptz not null default now()
);
alter table public.lv_camera_gateways enable row level security;
revoke all on public.lv_camera_gateways from public,anon,authenticated;
grant select(id,workspace_id,name,endpoint,clearance,enabled,last_seen_at,created_at) on public.lv_camera_gateways to authenticated;
create policy lv_gateway_read on public.lv_camera_gateways for select to authenticated using(public.lv_has_scope(workspace_id,'monitor'));
alter table public.lv_cameras add column gateway_id uuid references public.lv_camera_gateways on delete set null;
create index lv_camera_gateway_assignment on public.lv_cameras(gateway_id,id);

create table public.lv_camera_connection_health (
 camera_id uuid primary key references public.lv_cameras on delete cascade,
 gateway_id uuid not null references public.lv_camera_gateways on delete cascade, source_revision bigint not null,
 state text not null check(state in ('checking','ready','authentication_failed','unreachable','invalid_stream','unsupported_source','capacity_wait')),
 video_codec text, checked_at timestamptz not null default now()
);
alter table public.lv_camera_connection_health enable row level security;
revoke all on public.lv_camera_connection_health from public,anon,authenticated;

create table public.lv_camera_playback_tickets (
 token_hash bytea primary key, camera_id uuid not null references public.lv_cameras on delete cascade,
 viewer_id uuid not null references auth.users on delete cascade, gateway_id uuid not null references public.lv_camera_gateways on delete cascade,
 source_revision bigint not null, created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index lv_playback_ticket_expiry on public.lv_camera_playback_tickets(expires_at);
create index lv_playback_ticket_viewer on public.lv_camera_playback_tickets(viewer_id,created_at);
alter table public.lv_camera_playback_tickets enable row level security;
revoke all on public.lv_camera_playback_tickets from public,anon,authenticated;

-- Pairing stores only a hash. The installed gateway keeps the raw 256-bit token.
create function public.lv_pair_camera_gateway(target_workspace uuid,gateway_name text,gateway_endpoint text,token_hash_hex text) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid; access_level integer;
begin
 select m.clearance into access_level from public.lv_memberships m where m.workspace_id=target_workspace and m.user_id=auth.uid() and m.role in ('owner','admin');
 if access_level is null or not public.lv_has_scope(target_workspace,'monitor') then raise exception 'Gateway management unavailable' using errcode='42501'; end if;
 if token_hash_hex is null or token_hash_hex !~ '^[0-9a-f]{64}$' then raise exception 'Invalid gateway pairing'; end if;
 insert into public.lv_camera_gateways(workspace_id,name,endpoint,token_hash,clearance)
 values(target_workspace,btrim(gateway_name),rtrim(gateway_endpoint,'/'),pg_catalog.decode(token_hash_hex,'hex'),access_level) returning id into saved;
 update public.lv_cameras set gateway_id=saved where workspace_id=target_workspace and gateway_id is null and source_configured and minimum_clearance<=access_level;
 insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action) values(target_workspace,auth.uid(),saved,'gateway.paired');
 return saved;
end $$;
revoke all on function public.lv_pair_camera_gateway(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.lv_pair_camera_gateway(uuid,text,text,text) to authenticated;

create function public.lv_assign_camera_gateway(target uuid,expected_revision bigint,selected_gateway uuid) returns void
language plpgsql security definer set search_path='' as $$
declare camera public.lv_cameras;
begin
 select * into camera from public.lv_cameras where id=target for update;
 if camera.id is null or not public.lv_has_scope(camera.workspace_id,'monitor',camera.minimum_clearance)
 or not exists(select 1 from public.lv_memberships where workspace_id=camera.workspace_id and user_id=auth.uid() and role in ('owner','admin'))
 then raise exception 'Gateway management unavailable' using errcode='42501'; end if;
 if camera.revision<>expected_revision or expected_revision is null then raise exception 'Camera changed. Refresh before editing.'; end if;
 if selected_gateway is not null and not exists(select 1 from public.lv_camera_gateways where id=selected_gateway and workspace_id=camera.workspace_id and enabled and clearance>=camera.minimum_clearance)
 then raise exception 'Gateway unavailable for this camera'; end if;
 update public.lv_cameras set gateway_id=selected_gateway where id=target;
 delete from public.lv_camera_playback_tickets where camera_id=target;
 delete from public.lv_camera_connection_health where camera_id=target;
end $$;
revoke all on function public.lv_assign_camera_gateway(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.lv_assign_camera_gateway(uuid,bigint,uuid) to authenticated;

create function public.lv_disable_camera_gateway(target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_camera_gateways;
begin
 select * into item from public.lv_camera_gateways where id=target for update;
 if item.id is null or not public.lv_has_scope(item.workspace_id,'monitor',item.clearance)
 or not exists(select 1 from public.lv_memberships where workspace_id=item.workspace_id and user_id=auth.uid() and role in ('owner','admin'))
 then raise exception 'Gateway management unavailable' using errcode='42501'; end if;
 update public.lv_camera_gateways set enabled=false where id=target;
 delete from public.lv_camera_playback_tickets where gateway_id=target;
 insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action) values(item.workspace_id,auth.uid(),target,'gateway.disabled');
end $$;
revoke all on function public.lv_disable_camera_gateway(uuid) from public,anon,authenticated;
grant execute on function public.lv_disable_camera_gateway(uuid) to authenticated;

-- This helper is never executable by browser roles. Other definer RPCs use it.
create function public.lv_gateway_for_token(gateway_token text) returns public.lv_camera_gateways
language plpgsql security definer set search_path='' as $$
declare item public.lv_camera_gateways;
begin
 if gateway_token is null or gateway_token !~ '^[0-9a-f]{64}$' then raise exception 'Gateway authentication failed' using errcode='42501'; end if;
 select g.* into item from public.lv_camera_gateways g join public.lv_workspaces w on w.id=g.workspace_id
 where g.token_hash=pg_catalog.sha256(pg_catalog.convert_to(gateway_token,'UTF8')) and g.enabled and w.active;
 if item.id is null then raise exception 'Gateway authentication failed' using errcode='42501'; end if;
 return item;
end $$;
revoke all on function public.lv_gateway_for_token(text) from public,anon,authenticated;

create function public.lv_gateway_heartbeat(gateway_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare item public.lv_camera_gateways;
begin
 item:=public.lv_gateway_for_token(gateway_token);
 update public.lv_camera_gateways set last_seen_at=now() where id=item.id;
 return item.id;
end $$;
revoke all on function public.lv_gateway_heartbeat(text) from public,anon,authenticated;
grant execute on function public.lv_gateway_heartbeat(text) to anon;

-- Only the site token can retrieve sources assigned to that gateway and clearance.
create function public.lv_gateway_sources(gateway_token text,after_camera uuid default null) returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare item public.lv_camera_gateways;
begin
 item:=public.lv_gateway_for_token(gateway_token);
 return query select jsonb_build_object('camera_id',c.id,'source_revision',s.source_revision,'connection',v.decrypted_secret::jsonb)
 from public.lv_cameras c join public.lv_camera_source_secrets s on s.camera_id=c.id and s.workspace_id=c.workspace_id
 join vault.decrypted_secrets v on v.id=s.secret_id
 where c.gateway_id=item.id and c.workspace_id=item.workspace_id and c.minimum_clearance<=item.clearance
 and (after_camera is null or c.id>after_camera) order by c.id limit 100;
end $$;
revoke all on function public.lv_gateway_sources(text,uuid) from public,anon,authenticated;
grant execute on function public.lv_gateway_sources(text,uuid) to anon;

create function public.lv_gateway_report_camera(gateway_token text,target uuid,checked_revision bigint,new_state text,codec text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare item public.lv_camera_gateways;
begin
 item:=public.lv_gateway_for_token(gateway_token);
 if new_state is null or new_state not in ('checking','ready','authentication_failed','unreachable','invalid_stream','unsupported_source','capacity_wait') then raise exception 'Invalid camera state'; end if;
 if not exists(select 1 from public.lv_cameras c join public.lv_camera_source_secrets s on s.camera_id=c.id
 where c.id=target and c.gateway_id=item.id and c.workspace_id=item.workspace_id and c.minimum_clearance<=item.clearance and s.source_revision=checked_revision) then return false; end if;
 insert into public.lv_camera_connection_health(camera_id,gateway_id,source_revision,state,video_codec,checked_at)
 values(target,item.id,checked_revision,new_state,case when codec in ('h264','hevc','mjpeg','mpeg4','vp8','vp9','av1') then codec else null end,now())
 on conflict(camera_id) do update set gateway_id=excluded.gateway_id,source_revision=excluded.source_revision,state=excluded.state,video_codec=excluded.video_codec,checked_at=excluded.checked_at;
 return true;
end $$;
revoke all on function public.lv_gateway_report_camera(text,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.lv_gateway_report_camera(text,uuid,bigint,text,text) to anon;

create function public.lv_camera_connection_states(target_workspace uuid)
returns table(camera_id uuid,gateway_id uuid,gateway_name text,gateway_origin text,last_seen_at timestamptz,state text,checked_at timestamptz)
language sql stable security definer set search_path='' as $$
 select c.id,g.id,g.name,g.endpoint,g.last_seen_at,
 case when g.id is null then 'awaiting_gateway' when not g.enabled then 'gateway_disabled'
 when g.last_seen_at is null or g.last_seen_at<now()-interval '45 seconds' then 'gateway_offline'
 when h.source_revision=s.source_revision then h.state else 'unverified' end,h.checked_at
 from public.lv_cameras c left join public.lv_camera_gateways g on g.id=c.gateway_id
 left join public.lv_camera_source_secrets s on s.camera_id=c.id left join public.lv_camera_connection_health h on h.camera_id=c.id
 where c.workspace_id=target_workspace and public.lv_has_scope(c.workspace_id,'monitor',c.minimum_clearance)
$$;
revoke all on function public.lv_camera_connection_states(uuid) from public,anon,authenticated;
grant execute on function public.lv_camera_connection_states(uuid) to authenticated;

create function public.lv_open_camera_stream(target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare camera public.lv_cameras; gateway public.lv_camera_gateways; source_rev bigint; ticket text;
begin
 select * into camera from public.lv_cameras where id=target;
 if camera.id is null or not public.lv_has_scope(camera.workspace_id,'monitor',camera.minimum_clearance) then raise exception 'Camera playback unavailable' using errcode='42501'; end if;
 select * into gateway from public.lv_camera_gateways where id=camera.gateway_id and workspace_id=camera.workspace_id and enabled and clearance>=camera.minimum_clearance;
 if gateway.id is null or gateway.last_seen_at is null or gateway.last_seen_at<now()-interval '45 seconds' then raise exception 'Site gateway is offline or not configured'; end if;
 select source_revision into source_rev from public.lv_camera_source_secrets where camera_id=target;
 if source_rev is null then raise exception 'Camera source is not configured'; end if;
 delete from public.lv_camera_playback_tickets where expires_at<now();
 if (select count(*) from public.lv_camera_playback_tickets where viewer_id=auth.uid() and created_at>now()-interval '1 minute')>=30 then raise exception 'Too many playback requests. Wait a moment and try again.'; end if;
 ticket:=replace(pg_catalog.gen_random_uuid()::text,'-','')||replace(pg_catalog.gen_random_uuid()::text,'-','');
 insert into public.lv_camera_playback_tickets(token_hash,camera_id,viewer_id,gateway_id,source_revision,expires_at)
 values(pg_catalog.sha256(pg_catalog.convert_to(ticket,'UTF8')),camera.id,auth.uid(),gateway.id,source_rev,now()+interval '5 minutes');
 return jsonb_build_object('origin',gateway.endpoint,'camera_id',camera.id,'source_revision',source_rev,'ticket',ticket,'expires_at',now()+interval '5 minutes');
end $$;
revoke all on function public.lv_open_camera_stream(uuid) from public,anon,authenticated;
grant execute on function public.lv_open_camera_stream(uuid) to authenticated;

create function public.lv_gateway_validate_playback(gateway_token text,target uuid,source_rev bigint,playback_ticket text) returns boolean
language plpgsql security definer set search_path='' as $$
declare gateway public.lv_camera_gateways;
begin
 gateway:=public.lv_gateway_for_token(gateway_token);
 if playback_ticket is null or playback_ticket !~ '^[0-9a-f]{64}$' then return false; end if;
 return exists(select 1 from public.lv_camera_playback_tickets t
 join public.lv_cameras c on c.id=t.camera_id join public.lv_camera_source_secrets s on s.camera_id=c.id
 join public.lv_memberships m on m.user_id=t.viewer_id and m.workspace_id=c.workspace_id
 join public.lv_workspaces w on w.id=c.workspace_id and w.active
 where t.token_hash=pg_catalog.sha256(pg_catalog.convert_to(playback_ticket,'UTF8')) and t.expires_at>now()
 and t.camera_id=target and t.gateway_id=gateway.id and c.gateway_id=gateway.id and c.workspace_id=gateway.workspace_id
 and c.minimum_clearance<=gateway.clearance and m.clearance>=c.minimum_clearance
 and t.source_revision=source_rev and s.source_revision=source_rev
 and (m.role in ('owner','admin') or m.allowed_modules && array['monitor','command','cameras','camera_config','alerts','fleet','intel']::text[]));
end $$;
revoke all on function public.lv_gateway_validate_playback(text,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.lv_gateway_validate_playback(text,uuid,bigint,text) to anon;

create function public.lv_reset_source_gateway_state() returns trigger language plpgsql security definer set search_path='' as $$
declare eligible uuid;
begin
 if new.gateway_id is null then
   select (array_agg(id))[1] into eligible from public.lv_camera_gateways
   where workspace_id=new.workspace_id and enabled and clearance>=new.minimum_clearance having count(*)=1;
   new.gateway_id:=eligible;
 end if;
 delete from public.lv_camera_connection_health where camera_id=new.id;
 delete from public.lv_camera_playback_tickets where camera_id=new.id;
 return new;
end $$;
revoke all on function public.lv_reset_source_gateway_state() from public,anon,authenticated;
create trigger lv_reset_source_gateway_state before update of source_configured on public.lv_cameras for each row execute function public.lv_reset_source_gateway_state();

commit;
