import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({instances:[] as any[]}));
vi.mock('hls.js',()=>({default:class{
 static isSupported(){return true;}static Events={ERROR:'error'};static ErrorTypes={NETWORK_ERROR:'network',MEDIA_ERROR:'media'};
 handlers:Record<string,Function>={};attachMedia=vi.fn();loadSource=vi.fn();destroy=vi.fn();startLoad=vi.fn();recoverMediaError=vi.fn();
 constructor(){mock.instances.push(this);}on(event:string,handler:Function){this.handlers[event]=handler;}
}}));
import {CameraStream} from './CameraStream';
describe('IP camera playback',()=>{
 let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
 beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;mock.instances.length=0;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
 it('attaches HLS and preserves signed URL parameters, then destroys the player on unmount',async()=>{
  await act(async()=>root.render(<CameraStream src="https://gateway.example/camera.m3u8?signature=test" streamType="hls"/>));
  const player=mock.instances[0];expect(player.loadSource).toHaveBeenCalledWith('https://gateway.example/camera.m3u8?signature=test');expect(player.attachMedia).toHaveBeenCalledWith(host.querySelector('video'));
  await act(async()=>root.render(<div/>));expect(player.destroy).toHaveBeenCalled();
 });
 it('bounds fatal network recovery and reports an actionable error',async()=>{
  const error=vi.fn();await act(async()=>root.render(<CameraStream src="https://gateway.example/live.m3u8" onStreamError={error}/>));
  const player=mock.instances[0];await act(async()=>{for(let i=0;i<3;i++)player.handlers.error('error',{fatal:true,type:'network'});});
  expect(player.startLoad).toHaveBeenCalledTimes(2);expect(player.destroy).toHaveBeenCalled();expect(error).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Check gateway availability');
 });
 it('renders MJPEG as an image stream and reports readiness',async()=>{
  const ready=vi.fn();await act(async()=>root.render(<CameraStream src="https://camera.example/mjpeg" streamType="mjpeg" onStreamReady={ready}/>));
  expect(host.querySelector('video')).toBeNull();await act(async()=>host.querySelector('img')!.dispatchEvent(new Event('load')));expect(ready).toHaveBeenCalled();
 });
});
