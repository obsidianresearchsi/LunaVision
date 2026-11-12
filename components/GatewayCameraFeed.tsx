import React,{useEffect,useState,useRef} from 'react';
import {openGatewayStream} from '../services/cameraGateway';
import {CameraStream} from './CameraStream';
import CameraPresenceAlerts from './CameraPresenceAlerts';

export default function GatewayCameraFeed({cameraId,name,onClose,workspaceId}:{cameraId:string;name:string;onClose:()=>void;workspaceId?:string}){
  const video=useRef<HTMLVideoElement>(null);
  const [url,setUrl]=useState<string>();const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
  const [status,setStatus]=useState('Requesting authorized camera playback…');
  useEffect(()=>{
    let mounted=true;
    async function renew(){
      try{const next=await openGatewayStream(cameraId);if(mounted){setUrl(next);setError('');setStatus('Connecting to site gateway…');}}
      catch(failure){if(mounted){setUrl(undefined);setError(failure instanceof Error?failure.message:'Gateway playback failed.');}}
    }
    void renew();const interval=setInterval(()=>void renew(),4*60*1000);
    return()=>{mounted=false;clearInterval(interval);};
  },[cameraId,attempt]);
  return <article aria-label={`Live gateway feed: ${name}`}>
    <h3>{name}</h3>
    {url&&<CameraStream ref={video} src={url} streamType="hls" controls autoPlay muted playsInline crossOrigin="anonymous" style={{width:'100%',maxHeight:500}}
      onPlaying={()=>setStatus('Live video playing through the site gateway.')}
      onWaiting={()=>setStatus('Waiting for camera video…')}
      onStreamError={()=>setError('The gateway could not deliver video. Check the camera’s connection status above, then retry.')}/>}
    {error?<p role="alert">{error}</p>:<p role="status">{status}</p>}
    {workspaceId&&url&&<CameraPresenceAlerts video={video} cameraId={cameraId} workspaceId={workspaceId} cameraName={name} sourceRevision={Number(new URL(url).pathname.split('/')[4])}/>}
    <div className="lv-video-actions">
      <button className="lv-secondary" type="button" onClick={()=>{setError('');setUrl(undefined);setStatus('Requesting fresh playback access…');setAttempt(value=>value+1);}}>Retry gateway feed</button>
      <button className="lv-secondary" type="button" onClick={onClose}>Close gateway feed</button>
    </div>
  </article>;
}
