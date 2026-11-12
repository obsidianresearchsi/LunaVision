import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const db=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}));
vi.mock('../services/supabase',()=>({workspaceEnabled:true,supabase:db}));
vi.mock('./VideoAnalysis',()=>({default:()=>null}));
vi.mock('./CameraChat',()=>({default:()=>null}));
import CameraControlCenter from './CameraControlCenter';
import {WorkspaceCameras} from './WorkspaceCameras';
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  db.rpc.mockResolvedValue({data:{},error:null});
  db.from.mockReturnValue({select:()=>({eq:()=>({order:()=>Promise.resolve({data:[],error:null})})})});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
describe('Camera registration navigation',()=>{
  it('takes a business owner from an empty camera-settings page to camera registration',async()=>{
    function Flow(){const [page,setPage]=React.useState('settings');return page==='settings'
      ? <CameraControlCenter workspaceId="business" role="owner" onManageCameras={()=>setPage('cameras')}/>
      : <WorkspaceCameras workspaceId="business" agency={false} canAdd role="owner"/>;}
    await act(async()=>root.render(<Flow/>));
    expect(host.textContent).toContain('No connected cameras yet');
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Add camera')!.click());
    expect(host.querySelector('form[aria-label="Register a camera"]')).not.toBeNull();
    expect(host.querySelector('[name=name]')).not.toBeNull();
    expect(host.textContent).toContain('Register camera');
    const registration=host.querySelector('form[aria-label="Register a camera"]')!;
    const scroll=vi.fn();Object.defineProperty(registration,'scrollIntoView',{value:scroll,configurable:true});
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Add camera')!.click());
    expect(scroll).toHaveBeenCalledOnce();expect(document.activeElement).toBe(registration.querySelector('[name=name]'));
  });
  it('explains view-only access without offering camera creation',async()=>{
    await act(async()=>root.render(<CameraControlCenter workspaceId="business" role="viewer" onManageCameras={vi.fn()}/>));
    expect(host.textContent).toContain('owner or administrator');
    expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='Add camera')).toBe(false);
    expect(host.textContent).toContain('View cameras');
    await act(async()=>root.render(<WorkspaceCameras workspaceId="business" agency={false} canAdd={false} role="viewer"/>));
    expect(host.querySelector('form')).toBeNull();expect(host.textContent).toContain('Ask your workspace owner');
  });
  it('reports inventory failures honestly and allows a retry',async()=>{
    const read=vi.fn().mockResolvedValueOnce({data:null,error:{message:'Inventory unavailable'}}).mockResolvedValue({data:[],error:null});
    db.from.mockReturnValue({select:()=>({eq:()=>({order:read})})});
    await act(async()=>root.render(<CameraControlCenter workspaceId="business" role="owner" onManageCameras={vi.fn()}/>));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Inventory unavailable');
    expect(host.textContent).not.toContain('No connected cameras yet');
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Retry camera inventory')!.click());
    expect(host.textContent).toContain('No connected cameras yet');expect(host.querySelector('[role=alert]')).toBeNull();
  });
  it('refreshes an agency member role after promotion and unlocks registration',async()=>{
    function AgencyFlow(){
      const [role,setRole]=React.useState('member');
      const [page,setPage]=React.useState('settings');
      return page==='settings'
        ? <CameraControlCenter workspaceId="agency" agency role={role} onRefreshAccess={async()=>{setRole('admin');}} onManageCameras={()=>setPage('cameras')}/>
        : <WorkspaceCameras workspaceId="agency" agency canAdd={role==='admin'} role={role}/>;
    }
    await act(async()=>root.render(<AgencyFlow/>));
    expect(host.textContent).toContain('owner or administrator');
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Refresh access')!.click());
    expect(host.textContent).not.toContain('owner or administrator');
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Add camera')!.click());
    expect(host.querySelector('form[aria-label="Register a camera"]')).not.toBeNull();
    const register=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Register camera')!;
    expect(register.disabled).toBe(false);
  });
});
