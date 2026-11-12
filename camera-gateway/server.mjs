import {createClient} from '@supabase/supabase-js';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CameraGateway} from './service.mjs';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function configuration() {
  if(process.env.LUNAR_GATEWAY_CONFIG) return JSON.parse(await readFile(process.env.LUNAR_GATEWAY_CONFIG,'utf8'));
  if(process.platform!=='win32')throw new Error('Set LUNAR_GATEWAY_CONFIG to a private JSON configuration file.');
  const configPath=path.join(projectRoot,'.env.camera-gateway.dpapi');
  // PowerShell 7's inherited module path can break the Windows PowerShell 5
  // security module. Let the child build its own version-appropriate module path.
  const childEnvironment={...process.env,LUNAR_GATEWAY_DPAPI_PATH:configPath};
  for(const key of Object.keys(childEnvironment))if(key.toLowerCase()==='psmodulepath')delete childEnvironment[key];
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $secret=(Get-Content -LiteralPath $env:LUNAR_GATEWAY_DPAPI_PATH -Raw).Trim()|ConvertTo-SecureString; [Console]::Out.Write(([pscredential]::new('gateway',$secret)).GetNetworkCredential().Password)"],
    {env:childEnvironment,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536});
  if(result.status!==0)throw new Error('Local gateway configuration is missing or cannot be decrypted by this Windows account.');
  return JSON.parse(result.stdout);
}
let startupStage='reading the encrypted configuration';
try {
  const config=await configuration();
  if(!/^[0-9a-f]{64}$/.test(config.token??'')||!Array.isArray(config.networks)||!config.networks.length||!Array.isArray(config.origins))throw new Error('Gateway configuration is incomplete.');
  config.host??='127.0.0.1';config.port??=8787;config.maxStreams??=4;config.idleMs??=60000;
  if(!Number.isInteger(config.maxStreams)||config.maxStreams<1||config.maxStreams>64)throw new Error('Invalid stream capacity.');
  config.mediaRoot=path.join(projectRoot,'.vercel','camera-gateway-media');
  startupStage='creating the scoped Supabase connection';
  const db=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const gateway=new CameraGateway(config,db);
  startupStage='starting the local HTTP listener';
  await gateway.start();
  console.log(`LunarVision gateway listening on http://${config.host}:${config.port}; maximum ${config.maxStreams} simultaneous camera streams.`);
  console.log('Camera credentials and stream tickets are never written to logs. /healthz reports the Supabase connection.');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void gateway.close().finally(()=>process.exit(0)));
} catch(error) {const code=error&&typeof error==='object'&&'code' in error&&/^[A-Z0-9_]+$/.test(String(error.code))?` (${error.code})`:'';console.error(`LunarVision gateway could not start while ${startupStage}${code}. Check the private configuration, FFmpeg paths and port availability.`);process.exitCode=1;}
