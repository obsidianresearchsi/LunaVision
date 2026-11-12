import {useEffect,useState} from 'react';
import {supabase} from './supabase';

export type CameraConnectionState={camera_id:string;gateway_id:string|null;gateway_name:string|null;gateway_origin:string|null;last_seen_at:string|null;state:string;checked_at:string|null};
const labels:Record<string,string>={
  awaiting_gateway:'Connection unverified — assign a site gateway to check the camera password and provide video.',
  gateway_disabled:'Site gateway disabled — playback access has been revoked.',
  gateway_offline:'Site gateway offline — the computer at the camera site must be running and connected.',
  unverified:'Connection unverified — waiting for the site gateway to check this source.',
  checking:'Checking camera connection and credentials…',
  ready:'Camera connection verified by the site gateway. Open the feed to start live playback.',
  authentication_failed:'Camera rejected the login. Use Edit camera to correct its username or password.',
  unreachable:'Camera could not be reached from the site gateway. Check its IP address, port and network connection.',
  invalid_stream:'Camera did not provide a usable video stream. Check the RTSP stream path and camera settings.',
  unsupported_source:'Source is outside this gateway’s allowed camera network or uses an unsupported protocol. Configure the site gateway for this camera.',
  capacity_wait:'Gateway stream capacity reached. Close an unused feed or add gateway capacity.',
};
export function cameraConnectionLabel(state?:string){return labels[state??'unverified']??labels.unverified;}

export function useCameraConnectionStates(workspaceId:string){
  const [states,setStates]=useState<Record<string,CameraConnectionState>>({});
  const [unavailable,setUnavailable]=useState(false);
  useEffect(()=>{
    let mounted=true;
    setStates({});setUnavailable(false);
    async function refresh(){
      if(document.visibilityState==='hidden')return;
      try{
        const result=await supabase.rpc('lv_camera_connection_states',{target_workspace:workspaceId});
        if(!mounted)return;
        if(result?.error){setUnavailable(true);return;}
        const next:Record<string,CameraConnectionState>={};
        for(const row of Array.isArray(result?.data)?result.data:[])next[row.camera_id]=row;
        setStates(next);setUnavailable(false);
      }catch{if(mounted)setUnavailable(true);}
    }
    void refresh();const interval=setInterval(()=>void refresh(),10000);
    const visible=()=>void refresh();document.addEventListener('visibilitychange',visible);
    return()=>{mounted=false;clearInterval(interval);document.removeEventListener('visibilitychange',visible);};
  },[workspaceId]);
  return {states,unavailable};
}

export function playbackTicketUrl(data:unknown,pageHostname=window.location.hostname){
  if(!data||typeof data!=='object')throw new Error('Gateway did not return playback access.');
  const value=data as Record<string,unknown>;
  const origin=new URL(String(value.origin));
  const localGateway=['127.0.0.1','localhost'].includes(origin.hostname);
  const localPage=['127.0.0.1','localhost'].includes(pageHostname);
  if(origin.origin!==value.origin||origin.username||origin.password||(!localGateway&&origin.protocol!=='https:'))throw new Error('The gateway must have a secure HTTPS address.');
  if(localGateway&&!localPage)throw new Error('This gateway is available only on the site PC. Configure a secure HTTPS gateway address or VPN before viewing from this dashboard.');
  if(!/^[0-9a-f-]{36}$/.test(String(value.camera_id))||!/^[0-9a-f]{64}$/.test(String(value.ticket))||!Number.isSafeInteger(value.source_revision)||Number(value.source_revision)<1)throw new Error('Gateway returned invalid playback access.');
  return `${origin.origin}/v1/cameras/${value.camera_id}/${value.source_revision}/index.m3u8?ticket=${value.ticket}`;
}

export async function openGatewayStream(cameraId:string){
  const {data,error}=await supabase.rpc('lv_open_camera_stream',{target:cameraId});
  if(error){
    if(/offline|not configured/i.test(error.message))throw new Error('The site gateway is offline or has not been configured. Keep the gateway running on the camera network.');
    if(/Too many/i.test(error.message))throw new Error('Too many playback requests. Wait a moment and retry.');
    throw new Error('Camera playback access could not be issued. Check your workspace access and clearance.');
  }
  if(data?.camera_id!==cameraId)throw new Error('Gateway returned access for a different camera.');
  return playbackTicketUrl(data);
}
