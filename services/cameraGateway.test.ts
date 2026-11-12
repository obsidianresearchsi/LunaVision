import {describe,it,expect,vi} from 'vitest';
vi.mock('./supabase',()=>({supabase:{rpc:vi.fn()}}));
import {playbackTicketUrl,cameraConnectionLabel} from './cameraGateway';
const access={origin:'https://video.example.com',camera_id:'10000000-0000-4000-8000-000000000001',source_revision:2,ticket:'c'.repeat(64)};
describe('Gateway playback access',()=>{
 it('creates a camera-bound playback URL without source credentials',()=>{expect(playbackTicketUrl(access,'lunavision.vercel.app')).toContain('/2/index.m3u8?ticket=');});
 it('allows loopback playback only for a local dashboard',()=>{const local={...access,origin:'http://127.0.0.1:8787'};expect(playbackTicketUrl(local,'127.0.0.1')).toContain('http://127.0.0.1:8787');expect(()=>playbackTicketUrl(local,'lunavision.vercel.app')).toThrow('only on the site PC');});
 it('rejects insecure, malformed and credential-bearing playback origins',()=>{for(const origin of ['http://video.example.com','https://user:password@video.example.com','https://video.example.com/path'])expect(()=>playbackTicketUrl({...access,origin},'lunavision.vercel.app')).toThrow();expect(()=>playbackTicketUrl({...access,ticket:'invalid'})).toThrow();});
 it('distinguishes a wrong password from a network failure',()=>{expect(cameraConnectionLabel('authentication_failed')).toContain('rejected the login');expect(cameraConnectionLabel('unreachable')).toContain('could not be reached');});
});
