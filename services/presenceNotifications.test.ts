import {describe,it,expect,vi} from 'vitest';
vi.mock('./supabase',()=>({supabase:{}}));
import {emitLiveAlert} from './liveAlertBus';
describe('Presence alert notifications',()=>{
 it('announces a persisted alert once when both the detecting tab and the server poll return it',()=>{
  const alert={id:'presence-test-id',workspaceId:'workspace',kind:'person_presence' as const,title:'Person presence detected',details:'Camera observation',severity:'low' as const,dedupeKey:'presence:presence-test-id'};
  expect(emitLiveAlert(alert)).not.toBeNull();expect(emitLiveAlert(alert)).toBeNull();
 });
});
