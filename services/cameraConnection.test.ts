import {describe,it,expect} from 'vitest';
import {cameraSource,cameraRegistrationError} from './cameraConnection';
describe('Camera connection input',()=>{
 it('separates URL credentials from the stored source URL',()=>{expect(cameraSource('rtsp://operator:p%40ss@192.0.2.10:554/stream1')).toEqual({source_url:'rtsp://192.0.2.10:554/stream1',source_username:'operator',source_password:'p@ss'});});
 it('preserves stream paths and signed query parameters',()=>{expect(cameraSource('rtsps://camera.example:322/live?channel=2','user','secret').source_url).toBe('rtsps://camera.example:322/live?channel=2');});
 it('reports typos and conflicting credentials without exposing credentials',()=>{expect(()=>cameraSource('rstp://192.0.2.10/live')).toThrow('Use rtsp://');expect(()=>cameraSource('rtsp://user:secret@camera.example/live','another','password')).toThrow('both the URL');});
 it('does not expose backend payloads in registration errors',()=>{expect(cameraRegistrationError({code:'XX000',message:'private password and camera URL'})).not.toContain('password');expect(cameraRegistrationError({code:'42501'})).toContain('administrator');});
});
