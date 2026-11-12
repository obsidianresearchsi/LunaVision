import React,{RefObject,useEffect,useState} from 'react';
import {supabase} from '../services/supabase';
import {getPresenceDetector,presenceCounts} from '../services/presenceDetection';
import {emitLiveAlert,notifyAlertsChanged} from '../services/liveAlertBus';

type Options={people:boolean;vehicles:boolean;minimum_score:number;cooldown_seconds:number;revision:number;can_record:boolean;can_manage:boolean};
export default function CameraPresenceAlerts({video,cameraId,workspaceId,cameraName,sourceRevision}:{video:RefObject<HTMLVideoElement|null>;cameraId:string;workspaceId:string;cameraName:string;sourceRevision:number}){
  const [options,setOptions]=useState<Options>();const [status,setStatus]=useState('Loading live presence alert settings…');
  const [error,setError]=useState('');const [counts,setCounts]=useState({people:0,vehicles:0});const [reload,setReload]=useState(0);const [saving,setSaving]=useState(false);
  useEffect(()=>{let mounted=true;setError('');setOptions(undefined);
    void (async()=>{try{const {data,error}=await supabase.rpc('lv_get_camera_presence_options',{target:cameraId});if(error||!data||data.workspace_id!==workspaceId)throw new Error();if(mounted)setOptions(data as Options);}catch{if(mounted)setError('Camera alert settings could not be loaded. Check workspace access and retry.');}})();
    return()=>{mounted=false;};
  },[cameraId,workspaceId,reload]);
  useEffect(()=>{
    if(!options)return;
    if(!options.can_record){setStatus('View-only monitoring. This account cannot save live detections or alerts.');return;}
    if(!options.people&&!options.vehicles){setStatus('Presence alerts are disabled for this camera.');return;}
    let active=true,timer:ReturnType<typeof setTimeout>,lastSaved=0,stableFrames=0,peopleFrames=0,vehicleFrames=0;
    let pending:{sample_id:string;people_count:number;vehicle_count:number;confidence:number;observed_at:string}|undefined;
    const canvas=document.createElement('canvas');
    async function detect(){
      let delay=750;
      try{
        const media=video.current;
        if(!media||media.paused||media.ended||media.readyState<2||!media.videoWidth||document.visibilityState==='hidden'){stableFrames=0;peopleFrames=0;vehicleFrames=0;if(active)setStatus('Waiting for a playing live feed.');return;}
        const detector=await getPresenceDetector();if(!active)return;
        canvas.width=Math.min(640,media.videoWidth);canvas.height=Math.round(media.videoHeight*canvas.width/media.videoWidth);
        const context=canvas.getContext('2d');if(!context)throw new Error('Video frame is unavailable');
        context.drawImage(media,0,0,canvas.width,canvas.height);
        const result=presenceCounts(await detector(canvas),options!.minimum_score);if(!active)return;
        setCounts({people:result.people,vehicles:result.vehicles});stableFrames++;
        peopleFrames=result.people>0?peopleFrames+1:0;vehicleFrames=result.vehicles>0?vehicleFrames+1:0;
        setStatus('Person and vehicle presence detection is active while this feed is playing.');
        if(stableFrames<2||Date.now()-lastSaved<10000)return;
        if(pending&&Date.now()-Date.parse(pending.observed_at)>110000)pending=undefined;
        const people=options!.people&&peopleFrames>=2?result.people:0,vehicles=options!.vehicles&&vehicleFrames>=2?result.vehicles:0;
        if(!pending&&!people&&!vehicles)return;
        pending??={sample_id:crypto.randomUUID(),people_count:people,vehicle_count:vehicles,confidence:result.confidence,observed_at:new Date().toISOString()};
        const {data,error}=await supabase.rpc('lv_record_camera_presence',{target:cameraId,source_revision:sourceRevision,...pending});
        if(!active)return;lastSaved=Date.now();
        if(error){setError('Live detections could not be saved. Check camera connectivity, analytics access and clearance.');return;}
        pending=undefined;setError('');
        for(const alert of Array.isArray(data?.alerts)?data.alerts:[]){
          if(!['person_presence','vehicle_presence'].includes(alert.kind))continue;
          emitLiveAlert({id:alert.id,workspaceId,kind:alert.kind,title:alert.title,details:`${alert.count} detected on ${cameraName}. Confirm in the live stream.`,severity:'low',cameraId,cameraName,eventId:alert.event_id,dedupeKey:'presence:'+alert.id});
        }
        if(data?.alerts?.length)notifyAlertsChanged();
      }catch{delay=10000;if(active)setError('Live presence detection could not read the video or load its model. Check the feed and retry.');}
      finally{if(active)timer=setTimeout(()=>void detect(),delay);}
    }
    void detect();return()=>{active=false;clearTimeout(timer);};
  },[options,cameraId,workspaceId,cameraName,sourceRevision,video]);
  return <section aria-label="Live presence alerts" className="lv-card">
    <h4>Person &amp; vehicle presence alerts</h4>
    <p>People: {counts.people} · Vehicles: {counts.vehicles}</p><p role="status">{status}</p>
    <p>Detects presence without identifying people. Processing runs while this live feed is open and playing; it is not a background 24/7 inference service.</p>
    {error&&<p role="alert">{error}</p>}
    <button type="button" className="lv-secondary" onClick={()=>setReload(value=>value+1)}>Refresh alert settings</button>
    {options?.can_manage&&<details><summary>Configure presence alerts</summary><form onSubmit={async event=>{
      event.preventDefault();if(saving)return;const fields=new FormData(event.currentTarget);setSaving(true);setError('');
      try{const {error}=await supabase.rpc('lv_save_camera_presence_options',{target:cameraId,expected_revision:options.revision,people_enabled:fields.get('people')==='on',vehicles_enabled:fields.get('vehicles')==='on',minimum_confidence:Number(fields.get('score'))/100,repeat_seconds:Number(fields.get('cooldown'))});if(error)throw error;setReload(value=>value+1);}catch{setError('Alert settings could not be saved. Refresh settings and check your access.');}finally{setSaving(false);}
    }}>
      <label><input name="people" type="checkbox" defaultChecked={options.people}/>Person presence alerts</label>
      <label><input name="vehicles" type="checkbox" defaultChecked={options.vehicles}/>Vehicle presence alerts</label>
      <label>Minimum confidence (%)<input name="score" type="number" min={50} max={100} required defaultValue={Math.round(options.minimum_score*100)}/></label>
      <label>Alert cooldown (seconds)<input name="cooldown" type="number" min={15} max={3600} required defaultValue={options.cooldown_seconds}/></label>
      <button disabled={saving}>{saving?'Saving…':'Save presence alerts'}</button>
    </form></details>}
  </section>;
}
