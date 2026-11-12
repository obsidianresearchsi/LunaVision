import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),detect:vi.fn(),popup:vi.fn(),changed:vi.fn()}));
vi.mock('../services/supabase',()=>({supabase:{rpc:mocks.rpc}}));
vi.mock('../services/presenceDetection',async()=>{const original=await vi.importActual<typeof import('../services/presenceDetection')>('../services/presenceDetection');return{...original,getPresenceDetector:async()=>mocks.detect};});
vi.mock('../services/liveAlertBus',()=>({emitLiveAlert:mocks.popup,notifyAlertsChanged:mocks.changed}));
import CameraPresenceAlerts from './CameraPresenceAlerts';
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,video:HTMLVideoElement;
const options={workspace_id:'workspace',people:true,vehicles:true,minimum_score:0.65,cooldown_seconds:60,revision:0,can_record:true,can_manage:true};
const objects=[{class:'person',score:0.8,bbox:[0,0,20,20]},{class:'car',score:0.9,bbox:[20,20,30,30]}];
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();vi.clearAllMocks();
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as any);
 host=document.createElement('div');document.body.append(host);root=createRoot(host);video=document.createElement('video');
 for(const [key,value] of Object.entries({paused:false,ended:false,readyState:2,videoWidth:1280,videoHeight:720}))Object.defineProperty(video,key,{value,configurable:true});
 mocks.detect.mockResolvedValue(objects);
 mocks.rpc.mockImplementation(async(name:string)=>name==='lv_get_camera_presence_options'?{data:options,error:null}:{data:{alerts:[{id:'alert-id',event_id:'event-id',kind:'person_presence',title:'Person presence detected',count:1}]},error:null});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers();});
async function render(){await act(async()=>root.render(<CameraPresenceAlerts video={{current:video}} cameraId="camera" cameraName="V380" workspaceId="workspace" sourceRevision={2}/>));}
const records=()=>mocks.rpc.mock.calls.filter(call=>call[0]==='lv_record_camera_presence');
describe('Live camera presence alerts',()=>{
 it('requires consecutive video detections, saves camera-bound observations, and emits only persisted alerts',async()=>{
  await render();expect(records()).toHaveLength(0);expect(mocks.popup).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTimeAsync(750));
  expect(records()).toHaveLength(1);expect(records()[0][1]).toMatchObject({target:'camera',source_revision:2,people_count:1,vehicle_count:1,confidence:0.8});
  expect(mocks.popup).toHaveBeenCalledWith(expect.objectContaining({id:'alert-id',kind:'person_presence',cameraId:'camera'}));
 });
 it('does not alert on an isolated positive frame',async()=>{
  mocks.detect.mockResolvedValue([]).mockResolvedValueOnce(objects);await render();await act(async()=>vi.advanceTimersByTimeAsync(3000));
  expect(records()).toHaveLength(0);expect(mocks.popup).not.toHaveBeenCalled();
 });
 it('does not inspect paused video or record viewer-only sessions',async()=>{
  Object.defineProperty(video,'paused',{value:true,configurable:true});await render();await act(async()=>vi.advanceTimersByTimeAsync(1500));expect(mocks.detect).not.toHaveBeenCalled();
  await act(async()=>root.unmount());root=createRoot(host);
  mocks.rpc.mockResolvedValue({data:{...options,can_record:false},error:null});await render();
  expect(records()).toHaveLength(0);expect(host.textContent).toContain('View-only');
 });
 it('retries a failed write using the same idempotency key and does not announce unsaved alerts',async()=>{
  let calls=0;mocks.rpc.mockImplementation(async(name:string)=>name==='lv_get_camera_presence_options'?{data:options,error:null}:++calls===1?{data:null,error:{message:'Connection unavailable'}}:{data:{alerts:[]},error:null});
  await render();await act(async()=>vi.advanceTimersByTimeAsync(750));expect(records()).toHaveLength(1);expect(mocks.popup).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTimeAsync(11000));expect(records()).toHaveLength(2);expect(records()[0][1].sample_id).toBe(records()[1][1].sample_id);
 });
});
