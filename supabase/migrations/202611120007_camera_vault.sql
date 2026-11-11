begin;
-- Vault is managed by Supabase. Do not store a root encryption key in the frontend or camera rows.
do $$ begin
 if to_regclass('vault.decrypted_secrets') is null then raise exception 'Supabase Vault must be enabled before installing camera source storage'; end if;
 if has_table_privilege('anon','vault.decrypted_secrets','SELECT') or has_table_privilege('authenticated','vault.decrypted_secrets','SELECT')
 or has_table_privilege('anon','vault.secrets','SELECT') or has_table_privilege('authenticated','vault.secrets','SELECT')
 then raise exception 'Vault browser-role access must be disabled before installing camera source storage'; end if;
end $$;

alter table public.lv_cameras alter column playback_url drop not null;
alter table public.lv_cameras add column source_configured boolean not null default false;

create table public.lv_camera_source_secrets (
 camera_id uuid primary key references public.lv_cameras on delete cascade,
 workspace_id uuid not null references public.lv_workspaces on delete cascade,
 secret_id uuid not null unique,
 source_protocol text not null check(source_protocol in ('rtsp','rtsps','http','https')),
 source_revision bigint not null default 1,
 updated_by uuid not null,
 updated_at timestamptz not null default now()
);
alter table public.lv_camera_source_secrets enable row level security;
revoke all on public.lv_camera_source_secrets from public,anon,authenticated;

create function public.lv_store_camera_source(target uuid,expected_revision bigint,source_url text,source_username text,source_password text) returns uuid
language plpgsql security definer set search_path='' as $$
declare camera public.lv_cameras; saved public.lv_camera_source_secrets; encrypted_id uuid; protocol text; payload text;
begin
 select * into camera from public.lv_cameras where id=target for update;
 if camera.id is null or not public.lv_has_scope(camera.workspace_id,'monitor',camera.minimum_clearance)
 or not exists(select 1 from public.lv_memberships m where m.workspace_id=camera.workspace_id and m.user_id=auth.uid() and m.role in ('owner','admin'))
 then raise exception 'Camera source management unavailable'; end if;
 if expected_revision is null or camera.revision<>expected_revision then raise exception 'Camera changed. Refresh before replacing its source.'; end if;
 if source_url is null or length(source_url) not between 8 and 2048
 or source_url !~ '^(rtsp|rtsps|http|https)://[a-zA-Z0-9.-]+(:[0-9]+)?(/[^[:space:]#]*)?$'
 or source_username is null or length(source_username)>256 or source_password is null or length(source_password)>2048
 then raise exception 'Invalid source connection. Supply credentials in their separate fields.'; end if;
 protocol:=split_part(source_url,':',1);
 payload:=jsonb_build_object('source_url',source_url,'username',source_username,'password',source_password)::text;
 select * into saved from public.lv_camera_source_secrets where camera_id=target;
 if saved.camera_id is null then
   encrypted_id:=vault.create_secret(payload,'lv-camera:'||target::text,'Private camera source; never return to browser roles');
   insert into public.lv_camera_source_secrets(camera_id,workspace_id,secret_id,source_protocol,updated_by)
     values(target,camera.workspace_id,encrypted_id,protocol,auth.uid());
 else
   perform vault.update_secret(saved.secret_id,payload);
   update public.lv_camera_source_secrets set source_protocol=protocol,source_revision=source_revision+1,updated_by=auth.uid(),updated_at=now() where camera_id=target;
 end if;
 -- Replacing the source invalidates the previous playback binding; it must not show an old camera.
 update public.lv_cameras set source_configured=true,playback_url=null,stream_type='hls' where id=target;
 insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action)
 values(camera.workspace_id,auth.uid(),target,'camera.source_saved');
 return target;
end $$;
revoke all on function public.lv_store_camera_source(uuid,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.lv_store_camera_source(uuid,bigint,text,text,text) to authenticated;

create function public.lv_register_camera_source(target_workspace uuid,camera_name text,camera_location text,clearance integer,
 source_url text,source_username text,source_password text) returns uuid
language plpgsql security definer set search_path='' as $$
declare camera uuid;
begin
 if not public.lv_has_scope(target_workspace,'monitor',clearance) or not exists(select 1 from public.lv_memberships m
 where m.workspace_id=target_workspace and m.user_id=auth.uid() and m.role in ('owner','admin')) then raise exception 'Camera registration unavailable'; end if;
 insert into public.lv_cameras(workspace_id,name,location,playback_url,stream_type,minimum_clearance)
 values(target_workspace,btrim(camera_name),btrim(camera_location),null,'hls',clearance) returning id into camera;
 perform public.lv_store_camera_source(camera,1,source_url,source_username,source_password);
 return camera;
end $$;
revoke all on function public.lv_register_camera_source(uuid,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.lv_register_camera_source(uuid,text,text,integer,text,text,text) to authenticated;

-- Trusted backend/gateway connector only. Authenticated users cannot call this RPC or read the mapping table.
create function public.lv_camera_source_for_gateway(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('camera_id',c.id,'workspace_id',c.workspace_id,'source_revision',s.source_revision,
   'connection',v.decrypted_secret::jsonb)
 from public.lv_cameras c join public.lv_workspaces w on w.id=c.workspace_id and w.active
 join public.lv_camera_source_secrets s on s.camera_id=c.id and s.workspace_id=c.workspace_id
 join vault.decrypted_secrets v on v.id=s.secret_id where c.id=target
$$;
revoke all on function public.lv_camera_source_for_gateway(uuid) from public,anon,authenticated;
grant execute on function public.lv_camera_source_for_gateway(uuid) to service_role;

create function public.lv_cleanup_camera_source() returns trigger language plpgsql security definer set search_path='' as $$
begin delete from vault.secrets where id=old.secret_id; return old; end $$;
revoke all on function public.lv_cleanup_camera_source() from public,anon,authenticated;
create trigger lv_cleanup_camera_source after delete on public.lv_camera_source_secrets for each row execute function public.lv_cleanup_camera_source();
commit;
