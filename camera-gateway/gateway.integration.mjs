import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {CameraGateway} from './service.mjs';
import {concatInput,inNetworks,classifyFailure} from './media.mjs';

test('camera ingress is restricted to the configured network and credentials stay in stdin',()=>{
  assert.equal(inNetworks('192.168.10.2',['192.168.10.0/24']),true);
  for(const host of ['169.254.169.254','127.0.0.1','192.168.11.2','camera.example'])assert.equal(inNetworks(host,['192.168.10.0/24']),false);
  const input=concatInput({source_url:'rtsp://192.168.10.2:554/live',username:'user',password:'p@ss'},['192.168.10.0/24']);
  assert.ok(input.includes('user:p%40ss@'));assert.ok(input.includes('rtsp_transport tcp'));
  assert.ok(concatInput({source_url:'rtsp://192.168.10.2/live',username:'user',password:'literal%40'},['192.168.10.0/24']).includes('literal%2540@'));
  assert.throws(()=>concatInput({source_url:'file:///etc/passwd'},['192.168.10.0/24']));
  assert.throws(()=>concatInput({source_url:'http://169.254.169.254/latest'},['192.168.10.0/24']));
  assert.equal(classifyFailure('401 Unauthorized rtsp://secret'),'authentication_failed');
  assert.equal(classifyFailure('Connection timed out'),'unreachable');
  assert.equal(classifyFailure('Invalid data found'),'invalid_stream');
});

test('media requires valid viewer access; revocation, source changes and capacity fail closed',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'lunar-gateway-test-'));
  const cameraId='10000000-0000-4000-8000-000000000001';const ticket='d'.repeat(64);
  let sources=[{camera_id:cameraId,source_revision:1,connection:{source_url:'rtsp://192.168.10.2/live',username:'fixture',password:'fixture-secret'}}];
  let granted=true,revoked=false,ingests=0;
  const db={rpc(name,args){return{abortSignal:async()=>{
    if(revoked)return{data:null,error:{message:'revoked'}};
    if(name==='lv_gateway_sources')return{data:sources,error:null};
    if(name==='lv_gateway_validate_playback')return{data:granted&&args.playback_ticket===ticket&&args.source_rev===sources[0].source_revision,error:null};
    return{data:true,error:null};
  }}}};
  const gateway=new CameraGateway({token:'a'.repeat(64),networks:['192.168.10.0/24'],origins:['https://lunavision.vercel.app'],host:'127.0.0.1',port:0,maxStreams:1,idleMs:60000,mediaRoot:root},db,{
    connectCamera:async()=>{},
    probe:async()=>({codec_name:'h264',width:640,height:360}),
    ingest:(_ffmpeg,_input,_codec,folder)=>{ingests++;void Promise.all([writeFile(path.join(folder,'seg000000000.ts'),'test-only-segment'),writeFile(path.join(folder,'index.m3u8'),'#EXTM3U\n#EXTINF:2,\nseg000000000.ts\n')]);return{kill(){}};},
  });
  try{
    await gateway.start();await gateway.probeBatch;
    const base=`http://127.0.0.1:${gateway.server.address().port}`;
    const stream=`${base}/v1/cameras/${cameraId}/1/index.m3u8`;
    assert.equal((await fetch(stream)).status,403);assert.equal(ingests,0,'No unauthenticated video process');
    assert.equal((await fetch(`${stream}?ticket=${ticket}`,{headers:{origin:'https://untrusted.example'}})).status,403);
    const responses=await Promise.all([fetch(`${stream}?ticket=${ticket}`),fetch(`${stream}?ticket=${ticket}`)]);
    assert.equal(responses[0].status,200);assert.equal(responses[1].status,200);assert.equal(ingests,1,'A camera is ingested once for concurrent viewers');
    const playlist=await responses[0].text();assert.ok(playlist.includes(`seg000000000.ts?ticket=${ticket}`));assert.ok(!playlist.includes('fixture-secret'));
    const segment=await fetch(`${base}/v1/cameras/${cameraId}/1/seg000000000.ts?ticket=${ticket}`);assert.equal(segment.status,200);
    assert.equal((await fetch(`${base}/v1/cameras/${cameraId}/1/seg000000000.ts`)).status,403,'Segments are protected too');
    const another={camera_id:'10000000-0000-4000-8000-000000000002',source_revision:1,connection:sources[0].connection};gateway.sources.set(another.camera_id,another);
    await assert.rejects(()=>gateway.stream(another),error=>error.state==='capacity_wait');
    granted=false;gateway.authCache.clear();assert.equal((await fetch(`${stream}?ticket=${ticket}`)).status,403,'Revoked viewer access fails closed');
    granted=true;sources=[{...sources[0],source_revision:2}];await gateway.sync();await gateway.probeBatch;gateway.authCache.clear();
    assert.equal((await fetch(`${stream}?ticket=${ticket}`)).status,403,'Old source tickets no longer work');
    revoked=true;await gateway.sync();assert.equal(gateway.ready,false);assert.equal(gateway.streams.size,0);
    assert.ok((await readdir(root)).every(name=>!name.includes('fixture-secret')));
  } finally {
    await gateway.close();
    const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));await rm(resolved,{recursive:true,force:true});
  }
});
