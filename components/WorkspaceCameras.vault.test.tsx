import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock('../services/supabase',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
vi.mock('./VideoAnalysis',()=>({default:()=>null}));
vi.mock('./CameraChat',()=>({default:()=>null}));
import {WorkspaceCameras} from './WorkspaceCameras';
let root:ReturnType<typeof createRoot>|undefined,host:HTMLDivElement|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();vi.clearAllMocks();});
describe('Encrypted camera registration',()=>{
 it('does not offer playback for a source that is only stored in Vault',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  mock.from.mockImplementation(()=>({select:()=>({eq:()=>({order:()=>Promise.resolve({data:[{id:'pending-camera',name:'IP camera',location:'Gate',playback_url:null,source_configured:true,stream_type:'hls',minimum_clearance:0,revision:2}],error:null})})})}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<WorkspaceCameras workspaceId="workspace-id" canAdd={false} agency={false} initialCameraId="pending-camera"/>));
  const open=Array.from(host.querySelectorAll('button')).find(button=>button.textContent?.trim()==='Open feed')!;
  expect(open.disabled).toBe(true);expect(host.querySelector('video')).toBeNull();
  expect(host.textContent).toContain('gateway playback URL has not been configured');
 });
 it('saves source credentials through the Vault RPC and clears the password field after success',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  mock.rpc.mockResolvedValue({data:'camera-id',error:null});
  mock.from.mockImplementation(()=>({select:()=>({eq:()=>({order:()=>Promise.resolve({data:[],error:null})})})}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<WorkspaceCameras workspaceId="workspace-id" canAdd agency={false} role="owner"/>));
  const mode=host.querySelector('select')!;
  await act(async()=>{mode.value='source';mode.dispatchEvent(new Event('change',{bubbles:true}));});
  const form=host.querySelector('form')!;
  const set=(name:string,value:string)=>{(form.querySelector(`[name="${name}"]`) as HTMLInputElement).value=value;};
  set('name','North gate');set('location','Gate');set('source_url','rtsp://192.168.1.50:554/live');set('source_username','qa-user');set('source_password','qa-password');
  expect(form.querySelector('[name="source_password"]')?.getAttribute('type')).toBe('password');
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(mock.rpc).toHaveBeenCalledWith('lv_register_camera_source',expect.objectContaining({source_username:'qa-user',source_password:'qa-password',source_url:'rtsp://192.168.1.50:554/live'}));
  expect(host.textContent).toContain('Playback awaits gateway configuration');
  expect(host.textContent).not.toContain('qa-password');
  expect((form.querySelector('[name="source_password"]') as HTMLInputElement).value).toBe('');
 });
});
