import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({createClient:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:mocks.createClient}));
import { issueAgencyAccount } from './agency-accounts';
const env={VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-server',AGENCY_SETUP_ORIGIN:'https://app.example.com'};
const workspace='10000000-0000-4000-8000-000000000001';
function request(input:object){return new Request('https://app.example.com/api/agency-accounts',{method:'POST',headers:{Authorization:'Bearer test-session','Content-Type':'application/json'},body:JSON.stringify({workspaceId:workspace,email:'staff@example.com',role:'viewer',clearance:0,modules:['monitor'],verified:true,...input})});}
describe('Staff account provisioning',()=>{
 beforeEach(()=>vi.resetAllMocks());
 function setup(role='owner',clearance=3){
  const rpc=vi.fn().mockResolvedValue({error:null});
  const caller={auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'owner-id'}},error:null})},rpc,
    from:vi.fn((table:string)=>{const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({error:null,data:table==='lv_platform_admins'?null:table==='lv_workspaces'?{id:workspace,kind:'business'}:{role,clearance}})};return query;})};
  const admin={auth:{admin:{createUser:vi.fn().mockResolvedValue({data:{user:{id:'new-id'}},error:null}),generateLink:vi.fn().mockResolvedValue({data:{properties:{action_link:'https://auth.example.com/setup'}},error:null})}}};
  mocks.createClient.mockReturnValueOnce(caller).mockReturnValueOnce(admin);return {caller,admin,rpc};
 }
 it('requires authentication',async()=>expect((await issueAgencyAccount(new Request('https://app.example.com'),env)).status).toBe(401));
 it('rejects non-manager callers before creating an account',async()=>{const {admin}=setup('member');expect((await issueAgencyAccount(request({}),env)).status).toBe(403);expect(admin.auth.admin.createUser).not.toHaveBeenCalled();});
 it('rejects clearance escalation',async()=>{const {admin}=setup('admin',1);expect((await issueAgencyAccount(request({clearance:3}),env)).status).toBe(403);expect(admin.auth.admin.createUser).not.toHaveBeenCalled();});
 it('creates a business staff account with a business setup callback and explicit permissions',async()=>{const {admin,rpc}=setup();const result=await issueAgencyAccount(request({}),env);expect(result.status).toBe(201);expect(admin.auth.admin.generateLink).toHaveBeenCalledWith(expect.objectContaining({options:{redirectTo:'https://app.example.com/business'}}));expect(rpc).toHaveBeenCalledWith('lv_set_staff_access',expect.objectContaining({access_clearance:0,modules:['monitor']}));});
 it('does not reset an existing user password',async()=>{const {admin}=setup();admin.auth.admin.createUser.mockResolvedValue({data:{user:null},error:{code:'email_exists'}});expect((await issueAgencyAccount(request({}),env)).status).toBe(200);expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();});
 it('accepts granular non-admin sidebar page modules and falls back to coarse DB scopes if needed',async()=>{
  const {rpc}=setup();
  rpc
    .mockResolvedValueOnce({error:{message:'Invalid role, clearance or module access'}})
    .mockResolvedValueOnce({error:null});
  const res=await issueAgencyAccount(request({modules:['command','cameras','gallery']}),env);
  expect(res.status).toBe(201);
  expect(rpc).toHaveBeenNthCalledWith(1,'lv_set_staff_access',expect.objectContaining({modules:['command','cameras','gallery']}));
  expect(rpc).toHaveBeenNthCalledWith(2,'lv_set_staff_access',expect.objectContaining({modules:['monitor','records']}));
 });
 it('rejects empty modules array',async()=>{setup();expect((await issueAgencyAccount(request({modules:[]}),env)).status).toBe(400);});
});
