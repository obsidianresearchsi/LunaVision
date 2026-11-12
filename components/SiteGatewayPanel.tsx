import React,{FormEvent,useEffect,useState} from 'react';
import {SUPABASE_ANON_KEY,SUPABASE_URL,supabase} from '../services/supabase';

export type SiteGateway={id:string;name:string;endpoint:string;enabled:boolean;last_seen_at:string|null};
export default function SiteGatewayPanel({workspaceId,canManage,onGateways,onPaired}:{workspaceId:string;canManage:boolean;onGateways:(rows:SiteGateway[])=>void;onPaired:()=>void}){
  const [gateways,setGateways]=useState<SiteGateway[]>([]);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);const [loadFailed,setLoadFailed]=useState(false);
  const [download,setDownload]=useState('');const [tick,setTick]=useState(0);const [disable,setDisable]=useState<string>();
  useEffect(()=>{let active=true;setLoading(true);setLoadFailed(false);
    async function load(){try{const {data,error}=await supabase.from('lv_camera_gateways').select('id,name,endpoint,enabled,last_seen_at').eq('workspace_id',workspaceId).order('name');
      if(!active)return;setLoading(false);if(error){setLoadFailed(true);setMessage('Site gateway inventory could not be loaded.');return;}const rows=(data??[]) as SiteGateway[];setGateways(rows);onGateways(rows);setLoadFailed(false);
    }catch{if(active){setLoading(false);setLoadFailed(true);setMessage('Site gateway inventory could not be loaded.');}}}
    void load();const interval=setInterval(()=>{if(document.visibilityState!=='hidden')void load();},10000);return()=>{active=false;clearInterval(interval);};
  },[workspaceId,tick,onGateways]);
  useEffect(()=>()=>{if(download)URL.revokeObjectURL(download);},[download]);
  async function pair(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setBusy(true);setMessage('');const fields=new FormData(event.currentTarget);
    try{
      const network=String(fields.get('network')).trim();
      if(!/^(\d{1,3}\.){3}\d{1,3}\/(?:[1-9]|[12][0-9]|3[0-2])$/.test(network)||network.split('/')[0].split('.').some(octet=>Number(octet)>255))throw new Error('Enter the camera network in IPv4 CIDR form, such as 192.168.10.0/24.');
      const endpoint=new URL(String(fields.get('endpoint')).trim());
      if(endpoint.href!==endpoint.origin+'/'||endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||(endpoint.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname))))throw new Error('Use an HTTPS gateway address. Loopback HTTP is available for local testing only.');
      const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),byte=>byte.toString(16).padStart(2,'0')).join('');
      const {data,error}=await supabase.rpc('lv_pair_camera_gateway',{target_workspace:workspaceId,gateway_name:String(fields.get('name')).trim(),gateway_endpoint:endpoint.origin,token_hash_hex:hash});
      if(error||!data)throw new Error('Gateway pairing could not be saved. Check your owner/administrator role and connection.');
      const config={supabaseUrl:SUPABASE_URL,supabaseAnonKey:SUPABASE_ANON_KEY,token,networks:[network],origins:[window.location.origin,'https://lunavision.vercel.app'],host:'127.0.0.1',port:8787,maxStreams:4,idleMs:60000,ffmpeg:'ffmpeg',ffprobe:'ffprobe'};
      const file=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));setDownload(file);
      setMessage('Gateway paired. Download its private setup file now; it contains the site credential and is shown only once. Install FFmpeg and run the gateway with this configuration on the site computer.');
      setTick(value=>value+1);onPaired();
    }catch(failure){setMessage(failure instanceof Error?failure.message:'Gateway pairing failed.');}finally{setBusy(false);}
  }
  return <section aria-label="Site gateways" className="lv-notice">
    <h3>Site gateways</h3><p>A gateway checks camera logins and supplies live video from the camera network. Remote viewers need a reachable HTTPS gateway address; loopback addresses work only on the site PC.</p>
    {loading&&<p>Loading site gateways…</p>}
    {!loading&&!loadFailed&&!gateways.length&&<p>No gateway is paired with this workspace.</p>}
    {gateways.map(gateway=><div key={gateway.id}>
      <strong>{gateway.name}</strong> · {!gateway.enabled?'Disabled':gateway.last_seen_at&&Date.now()-Date.parse(gateway.last_seen_at)<45000?'Gateway online':'Gateway offline'}
      <p>{gateway.endpoint}</p>
      {canManage&&gateway.enabled&&<details><summary>Change gateway web address</summary><form onSubmit={async event=>{
        event.preventDefault();if(busy)return;const fields=new FormData(event.currentTarget);setBusy(true);
        try{const endpoint=new URL(String(fields.get('endpoint')).trim());if(endpoint.href!==endpoint.origin+'/'||!(endpoint.protocol==='https:'||(endpoint.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname))))throw new Error();
          const {error}=await supabase.rpc('lv_update_gateway_endpoint',{target:gateway.id,new_endpoint:endpoint.origin});if(error)throw error;setMessage('Gateway address updated. Reopen any active camera feed to obtain fresh playback access.');setTick(value=>value+1);onPaired();
        }catch{setMessage('Gateway address could not be updated. Use a valid HTTPS origin and check your management access.');}finally{setBusy(false);}
      }}><label>Gateway web address<input name="endpoint" type="url" required defaultValue={gateway.endpoint}/></label><button disabled={busy}>Save gateway address</button></form></details>}
      {canManage&&gateway.enabled&&(disable===gateway.id?<span><button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{const {error}=await supabase.rpc('lv_disable_camera_gateway',{target:gateway.id});if(error)throw error;setMessage('Gateway disabled. Its camera playback access is revoked.');setTick(value=>value+1);onPaired();}catch{setMessage('Gateway could not be disabled. Refresh and check your access.');}finally{setBusy(false);setDisable(undefined);}}}>Confirm disable gateway</button>{' '}<button type="button" disabled={busy} onClick={()=>setDisable(undefined)}>Cancel</button></span>:<button type="button" onClick={()=>setDisable(gateway.id)}>Disable gateway</button>)}
    </div>)}
    {canManage&&<details><summary>Pair a site gateway</summary><form onSubmit={pair} aria-label="Pair a site gateway">
      <label>Gateway name<input name="name" required minLength={2} maxLength={100} placeholder="North gate site computer"/></label>
      <label>Gateway web address<input name="endpoint" type="url" required placeholder="https://video.your-domain.com"/></label>
      <label>Camera network<input name="network" required placeholder="192.168.10.0/24"/></label>
      <button disabled={busy}>{busy?'Pairing…':'Create gateway setup file'}</button>
    </form></details>}
    {message&&<p role="status">{message}</p>}
    {download&&<a className="lv-btn" href={download} download="lunarvision-gateway.json">Download private gateway setup</a>}
  </section>;
}
