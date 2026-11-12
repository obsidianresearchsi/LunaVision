import {createServer} from 'node:http';
import {isIP} from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {CameraError,concatInput,runProbe,startHls,checkRtspPort} from './media.mjs';

export class CameraGateway {
  constructor(config,db,{probe=runProbe,ingest=startHls,connectCamera=checkRtspPort}={}) {
    this.config=config; this.db=db; this.probe=probe; this.ingest=ingest;this.connectCamera=connectCamera;
    this.sources=new Map(); this.streams=new Map(); this.authCache=new Map(); this.failures=new Map();
    this.sessionRoot=path.resolve(config.mediaRoot,randomUUID()); this.ready=false; this.syncing=false;
    this.server=createServer((req,res)=>void this.handle(req,res).catch(()=>{if(!res.headersSent)this.reply(res,503,{error:'Gateway request failed'});else res.destroy();}));
  }
  async rpc(name,args={}) {
    const {data,error}=await this.db.rpc(name,{gateway_token:this.config.token,...args}).abortSignal(AbortSignal.timeout(12000));
    if(error) throw new Error('Gateway database request failed');
    return data;
  }
  async report(source,state,codec=null) {
    try {await this.rpc('lv_gateway_report_camera',{target:source.camera_id,checked_revision:source.source_revision,new_state:state,codec});} catch {}
  }
  async inspect(source) {
    if(source.probing) return source.probing;
    source.controller=new AbortController();
    source.probing=(async()=>{
      await this.report(source,'checking');
      try {
        const input=concatInput(source.connection,this.config.networks);
        await this.connectCamera(source.connection,{signal:source.controller.signal});
        const video=await this.probe(this.config.ffprobe,input,{signal:source.controller.signal});
        if(this.sources.get(source.camera_id)!==source) throw new CameraError('unreachable');
        source.video=video; source.state='ready'; source.failures=0; source.nextProbe=Date.now()+300000;
        await this.report(source,'ready',video.codec_name); return video;
      } catch(error) {
        source.state=error instanceof CameraError?error.state:'unreachable';source.failures=(source.failures??0)+1;
        // Do not repeatedly submit a known-bad password and lock the camera.
        source.nextProbe=['authentication_failed','invalid_stream','unsupported_source'].includes(source.state)?Infinity:Date.now()+Math.min(300000,30000*2**Math.min(source.failures,4));
        await this.report(source,source.state); throw new CameraError(source.state);
      } finally {source.probing=null;}
    })();
    return source.probing;
  }
  async sync() {
    if(this.syncing) return;
    this.syncing=true;
    try {
      await this.rpc('lv_gateway_heartbeat');
      let after=null;const fresh=[];
      do {
        const rows=await this.rpc('lv_gateway_sources',{after_camera:after});
        if(!Array.isArray(rows)) throw new Error('Invalid source inventory');
        fresh.push(...rows);after=rows.length===100?rows.at(-1).camera_id:null;
        if(fresh.length>10000) throw new Error('Gateway inventory limit');
      } while(after);
      const freshById=new Map(fresh.map(source=>[source.camera_id,source]));
      for(const [id,source] of this.sources) {
        if(!freshById.has(id)||freshById.get(id).source_revision!==source.source_revision) {
          source.controller?.abort();this.sources.delete(id);this.authCache.clear();await this.stopStream(id);
        }
      }
      for(const source of fresh) if(!this.sources.has(source.camera_id)) this.sources.set(source.camera_id,{...source,state:'unverified',nextProbe:0});
      this.ready=true;
      // Bound concurrent login checks so a large inventory cannot exhaust the PC.
      if(!this.probeBatch){
        const pending=[...this.sources.values()].filter(source=>!source.probing&&!this.streams.has(source.camera_id)&&Date.now()>=source.nextProbe);
        const workers=Array.from({length:Math.min(2,pending.length)},async()=>{while(pending.length&&this.ready){const source=pending.shift();if(this.sources.get(source.camera_id)!==source)continue;try {await this.inspect(source);} catch {}}});
        // The heartbeat loop must not wait behind a large probe queue.
        this.probeBatch=Promise.all(workers).finally(()=>{this.probeBatch=null;});
      }
      await this.reapIdle();
    } catch {
      // Fail closed on a revoked token, lost DB connection or suspended workspace.
      this.ready=false; this.authCache.clear();
      for(const source of this.sources.values())source.controller?.abort();
      await Promise.all([...this.streams.keys()].map(id=>this.stopStream(id)));
    } finally {this.syncing=false;}
  }
  async stopStream(id) {
    const entry=this.streams.get(id);if(!entry)return;
    this.streams.delete(id);entry.stopped=true;entry.child?.kill('SIGKILL');
    await entry.starting?.catch(()=>{});
    await this.cleanupFolder(entry.folder);
  }
  async cleanupFolder(folder) {
    const directory=path.resolve(folder);
    if(!directory.startsWith(this.sessionRoot+path.sep))throw new Error('Unsafe media cleanup path');
    await rm(directory,{recursive:true,force:true}).catch(()=>{});
  }
  async reapIdle() {
    for(const [id,entry] of this.streams) if(Date.now()-entry.lastUsed>this.config.idleMs) await this.stopStream(id);
  }
  async stream(source) {
    let entry=this.streams.get(source.camera_id);
    if(entry){entry.lastUsed=Date.now();await entry.starting;return entry;}
    if(['authentication_failed','invalid_stream','unsupported_source'].includes(source.state))throw new CameraError(source.state);
    if(this.streams.size>=this.config.maxStreams){await this.report(source,'capacity_wait');throw new CameraError('capacity_wait');}
    entry={folder:path.join(this.sessionRoot,source.camera_id,randomUUID()),lastUsed:Date.now(),stopped:false,child:null,starting:null};
    this.streams.set(source.camera_id,entry);
    entry.starting=(async()=>{
      const video=await this.inspect(source);
      if(entry.stopped||this.sources.get(source.camera_id)!==source) throw new CameraError('unreachable');
      await mkdir(entry.folder,{recursive:true});
      entry.child=this.ingest(this.config.ffmpeg,concatInput(source.connection,this.config.networks),video.codec_name,entry.folder,{onExit:state=>{
        if(!entry.stopped){source.state=state;source.nextProbe=['authentication_failed','invalid_stream','unsupported_source'].includes(state)?Infinity:Date.now()+30000;void this.report(source,state);void this.stopStream(source.camera_id);}
      }});
      const deadline=Date.now()+22000;
      while(Date.now()<deadline&&!entry.stopped){
        try {const manifest=await readFile(path.join(entry.folder,'index.m3u8'),'utf8');if(manifest.includes('.ts'))return;} catch {}
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      throw new CameraError(source.state==='ready'?'unreachable':source.state);
    })();
    try {await entry.starting; return entry;}
    catch(error){this.streams.delete(source.camera_id);entry.stopped=true;entry.child?.kill('SIGKILL');await this.cleanupFolder(entry.folder);throw error;}
    finally {entry.starting=null;}
  }
  async authorized(id,revision,ticket) {
    const key=createHash('sha256').update(`${id}:${revision}:${ticket}`).digest('hex');
    const cached=this.authCache.get(key);if(cached&&cached.until>Date.now())return cached.valid;
    const valid=await this.rpc('lv_gateway_validate_playback',{target:id,source_rev:revision,playback_ticket:ticket});
    if(this.authCache.size>=1000)this.authCache.clear();
    this.authCache.set(key,{valid:valid===true,until:Date.now()+3000});return valid===true;
  }
  reply(res,status,payload) {res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(payload));}
  async handle(req,res) {
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    const origin=req.headers.origin;
    if(origin&&!this.config.origins.includes(origin))return this.reply(res,403,{error:'Origin not allowed'});
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET,HEAD,OPTIONS');res.writeHead(204).end();return;}
    if(req.method!=='GET'&&req.method!=='HEAD')return this.reply(res,405,{error:'Method not allowed'});
    const url=new URL(req.url,'http://gateway.local');
    if(url.pathname==='/healthz')return this.reply(res,200,{service:'LunarVision camera gateway',connected:this.ready});
    const match=/^\/v1\/cameras\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([1-9][0-9]{0,14})\/(index\.m3u8|seg[0-9]{9}\.ts)$/.exec(url.pathname);
    const ticket=url.searchParams.get('ticket')??'';
    if(!match||!/^[0-9a-f]{64}$/.test(ticket))return this.reply(res,403,{error:'A current camera playback ticket is required'});
    if(!this.ready)return this.reply(res,503,{error:'Site gateway is reconnecting'});
    const [,id,revText,file]=match;const revision=Number(revText);
    // Unknown camera IDs must not cause anonymous database traffic.
    const source=this.sources.get(id);
    if(!source||source.source_revision!==revision)return this.reply(res,403,{error:'Camera access denied or playback ticket expired'});
    const socketAddress=req.socket.remoteAddress??'unknown';
    const forwarded=req.headers['cf-connecting-ip'];
    const address=this.config.trustCloudflare&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(socketAddress)&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:socketAddress;
    const failure=this.failures.get(address);
    if(failure&&failure.until>Date.now()&&failure.count>=20)return this.reply(res,429,{error:'Too many invalid playback requests'});
    if(!await this.authorized(id,revision,ticket)){
      if(this.failures.size>1000)this.failures.clear();
      this.failures.set(address,{count:failure&&failure.until>Date.now()?failure.count+1:1,until:Date.now()+60000});
      return this.reply(res,403,{error:'Camera access denied or playback ticket expired'});
    }
    let entry;
    try {entry=await this.stream(source);} catch(error){return this.reply(res,503,{error:error instanceof CameraError?error.state:'unreachable'});}
    const mediaPath=path.resolve(entry.folder,file);
    if(!mediaPath.startsWith(path.resolve(entry.folder)+path.sep))return this.reply(res,400,{error:'Invalid media path'});
    try {
      if(file.endsWith('.m3u8')){
        const manifest=await readFile(mediaPath,'utf8');
        // Never serve URIs supplied by an upstream camera. Only our own TS segments.
        const lines=manifest.split(/\r?\n/).map(line=>{
          if(line.startsWith('#')&&line.includes('URI='))throw new Error('Unexpected playlist URI');
          if(!line||line.startsWith('#'))return line;
          if(!/^seg[0-9]{9}\.ts$/.test(line))throw new Error('Unexpected media path');
          return `${line}?ticket=${ticket}`;
        });
        res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl'}).end(req.method==='HEAD'?undefined:lines.join('\n'));
      } else {
        if((await stat(mediaPath)).size>32*1024*1024)throw new Error('Segment too large');
        const bytes=await readFile(mediaPath);res.writeHead(200,{'Content-Type':'video/mp2t'}).end(req.method==='HEAD'?undefined:bytes);
      }
    } catch {this.reply(res,404,{error:'Video segment not available; reload the playlist'});}
  }
  async start() {
    await mkdir(this.sessionRoot,{recursive:true});
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.config.port,this.config.host,resolve);});
    this.timer=setInterval(()=>void this.sync(),5000);
    await this.sync();
  }
  async close() {
    clearInterval(this.timer);this.ready=false;
    for(const source of this.sources.values())source.controller?.abort();
    await Promise.all([...this.streams.keys()].map(id=>this.stopStream(id)));
    await this.probeBatch?.catch(()=>{});
    await new Promise(resolve=>this.server.close(resolve));
    if(!this.sessionRoot.startsWith(path.resolve(this.config.mediaRoot)+path.sep))throw new Error('Unsafe session cleanup path');
    await rm(this.sessionRoot,{recursive:true,force:true});
  }
}
