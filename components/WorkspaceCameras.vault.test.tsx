import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock('../services/supabase',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
vi.mock('./VideoAnalysis',()=>({default:()=>null}));
vi.mock('./CameraChat',()=>({default:()=>null}));
vi.mock('./RecordLocation',()=>({LocationPicker:({onChange}:{onChange:(pin:{latitude:number;longitude:number})=>void})=><button type="button" onClick={()=>onChange({latitude:6.45,longitude:3.39})}>Select test location</button>}));
import {WorkspaceCameras} from './WorkspaceCameras';
let root:ReturnType<typeof createRoot>|undefined,host:HTMLDivElement|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();vi.clearAllMocks();});
describe('Encrypted camera registration',()=>{
 it.each([false,true])('persists an optional camera location and reports a partial save when location fails: %s',async(locationFails)=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  mock.rpc.mockResolvedValue({data:'camera-id',error:null});
  const update=vi.fn();const filters:string[][]=[];
  mock.from.mockImplementation(()=>({
   select:()=>({eq:()=>({order:()=>Promise.resolve({data:[],error:null})})}),
   update:(pin:unknown)=>{update(pin);const builder={eq:(key:string,value:string)=>{filters.push([key,value]);return builder;},select:()=>({single:()=>Promise.resolve({data:locationFails?null:{id:'camera-id'},error:locationFails?{message:'private database details'}:null})})};return builder;}
  }));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<WorkspaceCameras workspaceId="workspace-id" canAdd agency={false} role="owner"/>));
  const form=host.querySelector('form')!;
  await act(async()=>Array.from(form.querySelectorAll('button')).find(button=>button.textContent==='Select test location')!.click());
  (form.querySelector('[name=name]') as HTMLInputElement).value='IP camera';
  (form.querySelector('[name=source_url]') as HTMLInputElement).value='rtsp://192.0.2.10:554/live';
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(update).toHaveBeenCalledWith({latitude:6.45,longitude:3.39});
  expect(filters).toEqual([['workspace_id','workspace-id'],['id','camera-id']]);
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  expect(form.textContent).not.toContain('private database details');
  if(locationFails)expect(form.querySelector('[role=alert]')?.textContent).toContain('do not register it again');
  else expect(form.querySelector('[role=status]')?.textContent).toContain('Camera source saved');
 });
 it('shows a failed registration beside the submit button and preserves the entered details',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  mock.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'private backend error'}});
  mock.from.mockImplementation(()=>({select:()=>({eq:()=>({order:()=>Promise.resolve({data:[],error:null})})})}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<WorkspaceCameras workspaceId="workspace-id" canAdd agency={false} role="owner"/>));
  const form=host.querySelector('form')!;
  (form.querySelector('[name=name]') as HTMLInputElement).value='Real IP camera';
  (form.querySelector('[name=source_url]') as HTMLInputElement).value='rtsp://192.0.2.10:554/live';
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(form.querySelector('[role=alert]')?.textContent).toContain('administrator');
  expect(document.activeElement).toBe(form.querySelector('[role=alert]'));
  expect((form.querySelector('[name=source_url]') as HTMLInputElement).value).toContain('rtsp://');
 });
 it('accepts RTSP pasted into playback mode and stores it encrypted',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;mock.rpc.mockResolvedValue({data:'camera-id',error:null});
  mock.from.mockImplementation(()=>({select:()=>({eq:()=>({order:()=>Promise.resolve({data:[],error:null})})})}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<WorkspaceCameras workspaceId="workspace-id" canAdd agency={false} role="owner"/>));
  await act(async()=>{const mode=host!.querySelector('select')!;mode.value='playback';mode.dispatchEvent(new Event('change',{bubbles:true}));});
  const form=host.querySelector('form')!;(form.querySelector('[name=name]') as HTMLInputElement).value='IP camera';
  (form.querySelector('[name=url]') as HTMLInputElement).value='rtsp://user:secret@192.0.2.10:554/live';
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(mock.rpc).toHaveBeenCalledWith('lv_register_camera_source',expect.objectContaining({source_url:'rtsp://192.0.2.10:554/live',source_username:'user',source_password:'secret'}));
  expect(form.textContent).toContain('Playback awaits gateway configuration');
 });
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
