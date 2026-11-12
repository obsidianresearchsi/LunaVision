import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const playback=vi.hoisted(()=>vi.fn());
vi.mock('../services/cameraGateway',()=>({openGatewayStream:playback}));
vi.mock('./CameraStream',()=>({CameraStream:({src}:{src:string})=><video src={src}/>}));
import GatewayCameraFeed from './GatewayCameraFeed';
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
describe('Authorized gateway camera viewer',()=>{
 it('requests fresh playback access and renews it before the ticket expires',async()=>{
  playback.mockResolvedValueOnce('https://gateway.example/first.m3u8').mockResolvedValue('https://gateway.example/renewed.m3u8');
  await act(async()=>root.render(<GatewayCameraFeed cameraId="camera-id" name="Site camera" onClose={()=>{}}/>));
  expect(playback).toHaveBeenCalledWith('camera-id');expect(host.querySelector('video')?.getAttribute('src')).toContain('first.m3u8');
  await act(async()=>vi.advanceTimersByTimeAsync(4*60*1000));
  expect(host.querySelector('video')?.getAttribute('src')).toContain('renewed.m3u8');
 });
 it('shows an access error and does not render video when no ticket is issued',async()=>{
  playback.mockRejectedValue(new Error('Site gateway offline'));
  await act(async()=>root.render(<GatewayCameraFeed cameraId="camera-id" name="Site camera" onClose={()=>{}}/>));
  expect(host.querySelector('video')).toBeNull();expect(host.querySelector('[role=alert]')?.textContent).toContain('offline');
 });
});
