import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import VideoViewport from './VideoViewport';
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);Object.defineProperty(document,'fullscreenElement',{configurable:true,value:null});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();Object.defineProperty(document,'fullscreenElement',{configurable:true,value:null});});
async function render(){await act(async()=>root.render(<VideoViewport width={640} height={360}><video/><svg viewBox="0 0 640 360"><rect width={100} height={100}/></svg><canvas/></VideoViewport>));}
describe('Detection fullscreen',()=>{
 it('requests fullscreen on the shared container and preserves the video, overlay and canvas',async()=>{
  await render();const frame=host.querySelector('.lv-video-frame')!;const video=host.querySelector('video');const overlay=host.querySelector('svg');
  const request=vi.fn(async()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:frame});document.dispatchEvent(new Event('fullscreenchange'));});
  Object.defineProperty(frame,'requestFullscreen',{configurable:true,value:request});
  await act(async()=>host.querySelector('button')!.click());expect(request).toHaveBeenCalledOnce();expect(frame.contains(overlay)).toBe(true);
  expect(host.querySelector('video')).toBe(video);expect(host.querySelector('svg')).toBe(overlay);expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
  Object.defineProperty(document,'exitFullscreen',{configurable:true,value:vi.fn(async()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:null});document.dispatchEvent(new Event('fullscreenchange'));})});
  await act(async()=>host.querySelector('button')!.click());expect(document.exitFullscreen).toHaveBeenCalledOnce();expect(host.querySelector('button')?.textContent).toBe('Fullscreen');
 });
 it('uses an expanded viewport when fullscreen is unavailable and restores scrolling on Escape',async()=>{
  document.body.style.overflow='auto';await render();Object.defineProperty(host.querySelector('.lv-video-frame'),'requestFullscreen',{configurable:true,value:undefined});
  await act(async()=>host.querySelector('button')!.click());expect(host.querySelector('[data-expanded=true]')).not.toBeNull();expect(document.body.style.overflow).toBe('hidden');
  await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(host.querySelector('[data-expanded=true]')).toBeNull();expect(document.body.style.overflow).toBe('auto');
 });
 it('keeps an exit control when the browser rejects fullscreen and restores scrolling on unmount',async()=>{
  document.body.style.overflow='';await render();Object.defineProperty(host.querySelector('.lv-video-frame'),'requestFullscreen',{configurable:true,value:vi.fn().mockRejectedValue(new Error('Unavailable'))});
  await act(async()=>host.querySelector('button')!.click());expect(host.querySelector('button')?.textContent).toBe('Exit fullscreen');
  await act(async()=>root.render(<div/>));expect(document.body.style.overflow).toBe('');
 });
});
