import React, {useEffect, useRef, useState} from 'react';
import L from 'leaflet';
import {basemap} from '../services/mapConfig';
import {supabase} from '../services/supabase';
import '../styles/record-location.css';

export type RecordPosition = {latitude: number; longitude: number};
export function LocationPicker({value,onChange,disabled=false,onLocatingChange}:{value:RecordPosition|null;onChange:(value:RecordPosition|null)=>void;disabled?:boolean;onLocatingChange?:(pending:boolean)=>void}) {
  const host=useRef<HTMLDivElement>(null), map=useRef<L.Map|null>(null), pin=useRef<L.Marker|null>(null);
  const change=useRef(onChange);change.current=onChange;
  const [locating,setLocating]=useState(false),[notice,setNotice]=useState('');
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(!host.current)return;
    const instance=L.map(host.current).setView(value?[value.latitude,value.longitude]:[9.08,8.68],value?15:5);
    L.tileLayer(basemap.url,basemap.options).addTo(instance);
    instance.on('click',(event:L.LeafletMouseEvent)=>{if(!disabled)change.current({latitude:event.latlng.lat,longitude:event.latlng.lng});});
    map.current=instance;
    const observer=new ResizeObserver(()=>instance.invalidateSize());observer.observe(host.current);
    return()=>{observer.disconnect();instance.remove();map.current=null;pin.current=null;};
  },[disabled]);
  useEffect(()=>{
    const instance=map.current;if(!instance)return;
    if(!value){pin.current?.remove();pin.current=null;return;}
    if(!pin.current){
      pin.current=L.marker([value.latitude,value.longitude],{draggable:!disabled,keyboard:true,title:'Incident location — drag to adjust',
        icon:L.divIcon({className:'lv-location-pin',html:'<span style="display:block;width:22px;height:22px;border-radius:50%;background:#76efd6;border:3px solid #fff;box-shadow:0 2px 8px #0008"></span>',iconSize:[28,28],iconAnchor:[14,14]})}).addTo(instance);
      pin.current.on('dragend',()=>{const position=pin.current?.getLatLng();if(position)change.current({latitude:position.lat,longitude:position.lng});});
    } else pin.current.setLatLng([value.latitude,value.longitude]);
    if(!instance.getBounds().contains([value.latitude,value.longitude]))instance.setView([value.latitude,value.longitude],Math.max(instance.getZoom(),14));
  },[value,disabled]);
  function locate(){
    if(!navigator.geolocation){setNotice('This browser does not support current location. Select a point on the map instead.');return;}
    setLocating(true);onLocatingChange?.(true);setNotice('');
    navigator.geolocation.getCurrentPosition(position=>{
      if(!alive.current)return;
      change.current({latitude:position.coords.latitude,longitude:position.coords.longitude});
      map.current?.setView([position.coords.latitude,position.coords.longitude],16);
      setLocating(false);onLocatingChange?.(false);
    },error=>{if(alive.current){setNotice(error.code===1?'Location permission was denied. You can still select a point on the map.':'Current location is unavailable. Select a point on the map instead.');setLocating(false);onLocatingChange?.(false);}},
    {enableHighAccuracy:true,timeout:15000,maximumAge:60000});
  }
  return <fieldset disabled={disabled} style={{border:'1px solid #354858',borderRadius:6,padding:12,minWidth:0}}>
    <legend>Location (optional)</legend>
    <p>Click the map to place a pin, then drag it to the incident location.</p>
    <div ref={host} aria-label="Incident location picker" style={{height:280,width:'100%',borderRadius:5,overflow:'hidden'}}/>
    <div className="lv-video-actions"><button type="button" disabled={locating||disabled} onClick={locate}>{locating?'Finding your location…':'Use current location'}</button>
      {value&&<button type="button" className="lv-secondary" onClick={()=>change.current(null)}>Clear location</button>}</div>
    <p aria-live="polite">{value?`${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}`:'No location selected.'}</p>
    {notice&&<p role="status">{notice}</p>}
  </fieldset>;
}

export function RecordLocationEditor({workspaceId,record,onUpdated,readOnly=false}:{workspaceId:string;record:{id:string;latitude?:number|null;longitude?:number|null};onUpdated:(position:RecordPosition|null)=>void;readOnly?:boolean}){
  const [open,setOpen]=useState(false),[position,setPosition]=useState<RecordPosition|null>(null),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
  const [locating,setLocating]=useState(false);
  useEffect(()=>{setPosition(record.latitude!=null&&record.longitude!=null?{latitude:record.latitude,longitude:record.longitude}:null);},[record.id,record.latitude,record.longitude]);
  if(readOnly)return <p>{position?`Location: ${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}`:'No location recorded.'}</p>;
  return <div><button type="button" className="lv-secondary" onClick={()=>{setOpen(value=>!value);setLocating(false);setNotice('');}}>{open?'Close location editor':position?'Update location':'Add location'}</button>
    {open&&<form onSubmit={async event=>{
      event.preventDefault();if(saving)return;setSaving(true);setNotice('');
      try{const {data,error}=await supabase.from('lv_records').update({latitude:position?.latitude??null,longitude:position?.longitude??null}).eq('workspace_id',workspaceId).eq('id',record.id).select('id').single();
        if(error||!data)throw new Error(error?.message??'Location could not be saved.');onUpdated(position);setNotice('Location saved.');
      }catch(error){setNotice(error instanceof Error?error.message:'Location could not be saved.');}finally{setSaving(false);}
    }}><LocationPicker value={position} onChange={setPosition} disabled={saving} onLocatingChange={setLocating}/><button disabled={saving||locating}>{saving?'Saving…':'Save location'}</button></form>}
    {notice&&<p role="status">{notice}</p>}</div>;
}
