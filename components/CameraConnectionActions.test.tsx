import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const db = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock('../services/supabase', () => ({supabase: db}));
import CameraConnectionActions from './CameraConnectionActions';
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const camera = {id:'camera-id',name:'North gate',location:'Gate',revision:4,minimum_clearance:0,playback_url:null,stream_type:'hls'};
const changed = vi.fn();
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  vi.clearAllMocks(); vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {cb(0); return 1;});
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  await act(async () => root.render(<CameraConnectionActions camera={camera} onChanged={changed}/>));
});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();});
function button(text: string) {return Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!;}
describe('Camera connection management', () => {
  it('saves an unconnected camera’s details without inventing a playback URL', async () => {
    db.rpc.mockResolvedValue({data:null,error:null});
    await act(async () => button('Edit camera').click());
    const form=host.querySelector('form')!;
    (form.querySelector('[name=name]') as HTMLInputElement).value='Corrected camera';
    await act(async () => form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(db.rpc).toHaveBeenCalledWith('lv_configure_camera_connection',expect.objectContaining({target:'camera-id',expected_revision:4,device_name:'Corrected camera',endpoint:null}));
    expect(changed).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('credentials have not been tested');
  });
  it('replaces a wrong password securely and clears it only after successful storage', async () => {
    db.rpc.mockResolvedValue({data:'camera-id',error:null});
    await act(async () => button('Edit camera').click());
    const form=host.querySelector('form[aria-label="Replace credentials for North gate"]')!;
    (form.querySelector('[name=source_url]') as HTMLInputElement).value='rtsp://user:replacement@192.0.2.10:554/live';
    await act(async () => form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(db.rpc).toHaveBeenCalledWith('lv_store_camera_source',{target:'camera-id',expected_revision:4,source_url:'rtsp://192.0.2.10:554/live',source_username:'user',source_password:'replacement'});
    expect((form.querySelector('[name=source_url]') as HTMLInputElement).value).toBe('');
    expect(host.textContent).toContain('Connection unverified');
    expect(host.textContent).not.toContain('replacement@');
  });
  it('allows cancelling removal without calling the database', async () => {
    await act(async () => button('Remove camera').click());
    expect(host.textContent).toContain('Previously saved observations remain');
    await act(async () => button('Cancel removal').click());
    expect(db.rpc).not.toHaveBeenCalled();
    expect(button('Confirm remove camera')).toBeUndefined();
  });
  it('removes only the confirmed camera revision and refreshes the inventory', async () => {
    db.rpc.mockResolvedValue({data:'camera-id',error:null});
    await act(async () => button('Remove camera').click());
    await act(async () => button('Confirm remove camera').click());
    expect(db.rpc).toHaveBeenCalledWith('lv_remove_camera',{target:'camera-id',expected_revision:4});
    expect(changed).toHaveBeenCalledWith('Camera removed.');
  });
  it('keeps the camera when a stale removal is rejected and offers a refresh', async () => {
    db.rpc.mockResolvedValue({data:null,error:{message:'Camera changed. Refresh.'}});
    await act(async () => button('Remove camera').click());
    await act(async () => button('Confirm remove camera').click());
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Refresh the camera list');
    expect(changed).not.toHaveBeenCalled();
    await act(async () => button('Refresh camera').click());
    expect(changed).toHaveBeenCalledOnce();
  });
});
