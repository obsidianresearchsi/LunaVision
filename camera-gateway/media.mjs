import {spawn} from 'node:child_process';
import {isIP,createConnection} from 'node:net';

export class CameraError extends Error {
  constructor(state) {super(state); this.state=state;}
}

function ipv4Number(value) {
  if(isIP(value)!==4) throw new CameraError('unsupported_source');
  return value.split('.').reduce((result,octet)=>(result*256)+Number(octet),0)>>>0;
}

export function inNetworks(host,networks) {
  if(isIP(host)!==4) return false;
  const address=ipv4Number(host);
  return networks.some(cidr=>{
    const [network,bitsText='32']=cidr.split('/');
    const bits=Number(bitsText);
    if(!Number.isInteger(bits)||bits<1||bits>32||isIP(network)!==4) return false;
    const mask=(0xffffffff<<(32-bits))>>>0;
    return (address&mask)===(ipv4Number(network)&mask);
  });
}

// The ingest allowlist belongs to the site administrator, not a dashboard form.
// Credentials travel to FFmpeg over stdin, never in command arguments or files.
export function concatInput(connection,networks) {
  let url;
  try {url=new URL(connection.source_url);} catch {throw new CameraError('unsupported_source');}
  if(!['rtsp:','rtsps:'].includes(url.protocol)||!inNetworks(url.hostname,networks)||url.hash||url.username||url.password) throw new CameraError('unsupported_source');
  url.username=encodeURIComponent(connection.username??''); url.password=encodeURIComponent(connection.password??'');
  const escaped=url.href.replace(/'/g,"'\\''");
  return `ffconcat version 1.0\nfile '${escaped}'\noption rtsp_transport tcp\noption timeout 8000000\n${url.protocol==='rtsps:'?'option tls_verify 1\n':''}`;
}

export function classifyFailure(stderr) {
  if(/401\b|403\b|Unauthorized|authorization failed|authentication failed/i.test(stderr)) return 'authentication_failed';
  if(/timed? out|unreachable|refused|No route|failed to connect|Network is down/i.test(stderr)) return 'unreachable';
  return 'invalid_stream';
}

export function checkRtspPort(connection,{signal,timeoutMs=5000}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new CameraError('unreachable'));
    const url=new URL(connection.source_url);
    const socket=createConnection({host:url.hostname,port:Number(url.port||(url.protocol==='rtsps:'?322:554))});
    const cleanup=()=>{signal?.removeEventListener('abort',fail);socket.destroy();};
    const fail=()=>{cleanup();reject(new CameraError('unreachable'));};
    socket.once('connect',()=>{cleanup();resolve();});socket.once('error',fail);socket.setTimeout(timeoutMs,fail);
    signal?.addEventListener('abort',fail,{once:true});
  });
}

const inputArgs=['-protocol_whitelist','pipe,rtsp,rtsps,tcp,tls,udp,rtp,crypto','-f','concat','-safe','0','-i','pipe:0'];

export function runProbe(ffprobe,input,{spawnProcess=spawn,timeoutMs=16000,signal}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new CameraError('unreachable'));
    const child=spawnProcess(ffprobe,['-v','error','-analyzeduration','2000000','-probesize','2000000',...inputArgs,'-show_entries','stream=codec_type,codec_name,width,height','-of','json'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true; child.kill('SIGKILL');},timeoutMs);
    const abort=()=>{timedOut=true;child.kill('SIGKILL');};signal?.addEventListener('abort',abort,{once:true});
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    child.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-65536);});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-65536);});
    child.stdin.on('error',()=>{}); child.stdin.end(input);
    child.once('error',()=>{cleanup(); reject(new CameraError('unreachable'));});
    child.once('close',code=>{
      cleanup();
      if(timedOut) return reject(new CameraError('unreachable'));
      if(code!==0) return reject(new CameraError(classifyFailure(stderr)));
      try {
        const video=JSON.parse(stdout).streams?.find(stream=>stream.codec_type==='video'&&stream.width>0&&stream.height>0);
        if(!video) throw new Error();
        resolve(video);
      } catch {reject(new CameraError('invalid_stream'));}
    });
  });
}

export function startHls(ffmpeg,input,codec,folder,{spawnProcess=spawn,onExit=()=>{}}={}) {
  const videoArgs=codec==='h264'?['-c:v','copy']:['-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-pix_fmt','yuv420p','-vf',"scale='min(1280,iw)':-2",'-r','15','-g','30','-threads','2'];
  const args=['-hide_banner','-loglevel','error',...inputArgs,'-map','0:v:0','-an',...videoArgs,
    '-f','hls','-hls_time','2','-hls_list_size','6','-hls_delete_threshold','2','-hls_flags','delete_segments+omit_endlist+temp_file+independent_segments',
    '-hls_segment_filename','seg%09d.ts','index.m3u8'];
  const child=spawnProcess(ffmpeg,args,{cwd:folder,stdio:['pipe','ignore','pipe'],windowsHide:true});
  let stderr='';
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-32768);});
  child.stdin.on('error',()=>{}); child.stdin.end(input);
  child.once('error',()=>onExit('unreachable'));
  child.once('close',()=>onExit(classifyFailure(stderr)));
  return child;
}
