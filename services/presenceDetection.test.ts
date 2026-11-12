import {describe,it,expect} from 'vitest';
import {presenceCounts} from './presenceDetection';
describe('Presence classification',()=>{
 it('counts confident people and vehicles without identities or unsupported labels',()=>{
  expect(presenceCounts([{class:'person',score:0.8,bbox:[0,0,10,10]},{class:'truck',score:0.9,bbox:[0,0,20,20]},{class:'car',score:0.4,bbox:[0,0,20,20]},{class:'chair',score:0.9,bbox:[0,0,20,20]}],0.65)).toEqual({people:1,vehicles:1,confidence:0.8});
 });
});
