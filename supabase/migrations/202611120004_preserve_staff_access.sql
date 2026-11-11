begin;
-- Older deployed clients can still change a role without silently erasing a staff member's explicit permissions.
create or replace function public.lv_manage_workspace_access(target uuid,email_address text,access_role text) returns void
language plpgsql security definer set search_path='' as $$
declare saved public.lv_memberships;
begin
 select m.* into saved from public.lv_memberships m join auth.users u on u.id=m.user_id
 where m.workspace_id=target and lower(u.email)=lower(btrim(email_address));
 perform public.lv_set_staff_access(target,email_address,access_role,coalesce(saved.clearance,0),coalesce(saved.allowed_modules,array['monitor']));
end $$;
revoke all on function public.lv_manage_workspace_access(uuid,text,text) from public,anon,authenticated;
grant execute on function public.lv_manage_workspace_access(uuid,text,text) to authenticated;
commit;
