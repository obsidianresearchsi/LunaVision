// Local-only integration check. Publishes existing practice footage to an isolated
// RTSP fixture; creates no Supabase records and never uses real camera passwords.
import {spawn} from 'node:child_process';
import {createServer,connect} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {CameraError,concatInput,runProbe,startHls} from './media.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'.vercel','camera-runtime');
const ffmpegFolder=(await readdir(runtime)).find(name=>/^ffmpeg-.*essentials_build$/.test(name));
const ffmpeg=path.join(runtime,ffmpegFolder,'bin','ffmpeg.exe');const ffprobe=path.join(runtime,ffmpegFolder,'bin','ffprobe.exe');
const mediamtx=path.join(runtime,'mediamtx-test','mediamtx.exe');
const folder=path.join(runtime,`smoke-${Date.now()}`);await mkdir(folder,{recursive:true});
const allocation=createServer();await new Promise(resolve=>allocation.listen(0,'127.0.0.1',resolve));const port=allocation.address().port;await new Promise(resolve=>allocation.close(resolve));
const password=randomBytes(16).toString('hex')+'@#&+!';
const configPath=path.join(folder,'fixture.yml');
await writeFile(configPath,`logLevel: error\nrtspAddress: 127.0.0.1:${port}\nrtspTransports: [tcp]\nrtmp: no\nhls: no\nwebrtc: no\nsrt: no\napi: no\nmetrics: no\npprof: no\nauthMethod: internal\nauthInternalUsers:\n  - user: fixture\n    pass: ${JSON.stringify(password)}\n    permissions:\n      - action: publish\n        path: live\n      - action: read\n        path: live\npaths:\n  live:\n    source: publisher\n`);
let server,publisher,transcoder;const errors=[];
function child(binary,args){const process=spawn(binary,args,{cwd:folder,stdio:['ignore','pipe','pipe'],windowsHide:true});const collect=chunk=>errors.push(String(chunk).replaceAll(password,'[fixture-secret]').replaceAll(encodeURIComponent(password),'[fixture-secret]'));process.stdout.on('data',collect);process.stderr.on('data',collect);return process;}
async function reachable(){for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error('Local RTSP fixture exited before listening');if(await new Promise(resolve=>{const socket=connect(port,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));}))return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Local RTSP fixture did not start');}
try{
  server=child(mediamtx,[configPath]);await reachable();
  const publishUrl=new URL(`rtsp://127.0.0.1:${port}/live`);publishUrl.username='fixture';publishUrl.password=encodeURIComponent(password);
  publisher=child(ffmpeg,['-hide_banner','-loglevel','error','-re','-stream_loop','-1','-i',path.join(root,'public','demo','street-traffic.webm'),'-an','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-vf','scale=640:-2','-r','15','-g','30','-f','rtsp','-rtsp_transport','tcp',publishUrl.href]);
  const connection={source_url:`rtsp://127.0.0.1:${port}/live`,username:'fixture',password};
  let video;
  for(let attempt=0;attempt<6;attempt++){try{video=await runProbe(ffprobe,concatInput(connection,['127.0.0.1/32']));break;}catch(error){if(attempt===5)throw error;await new Promise(resolve=>setTimeout(resolve,300));}}
  assert.equal(video.codec_name,'h264');
  await assert.rejects(()=>runProbe(ffprobe,concatInput({...connection,password:'deliberately-incorrect'},['127.0.0.1/32'])),error=>error instanceof CameraError&&error.state==='authentication_failed');
  transcoder=startHls(ffmpeg,concatInput(connection,['127.0.0.1/32']),video.codec_name,folder);
  let manifest='';
  for(let i=0;i<100;i++){try{manifest=await readFile(path.join(folder,'index.m3u8'),'utf8');if(manifest.includes('.ts'))break;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(manifest.includes('.ts'),'RTSP must produce a real HLS segment');
  const segment=manifest.split(/\r?\n/).find(line=>/^seg[0-9]+\.ts$/.test(line));assert.ok((await readFile(path.join(folder,segment))).length>188);
  console.log('PASS: real FFmpeg RTSP login, incorrect-password rejection, H.264 ingest and HLS video segment generation using isolated practice footage.');
}catch(error){console.error('RTSP integration check failed:',error instanceof CameraError?error.state:error.message);if(errors.length)console.error(errors.slice(-3).join('').slice(-1600));process.exitCode=1;}
finally{
  for(const process of [transcoder,publisher,server])process?.kill('SIGKILL');
  await new Promise(resolve=>setTimeout(resolve,400));
  const resolved=path.resolve(folder);if(!resolved.startsWith(runtime+path.sep))throw new Error('Unsafe fixture cleanup path');
  await rm(resolved,{recursive:true,force:true});
}
