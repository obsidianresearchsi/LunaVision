import {describe,expect,it} from 'vitest';
import {signupOrganization} from './businessOnboarding';
describe('Business signup profile',()=>{
  it('uses only a validated business-signup organization name',()=>{
    expect(signupOrganization({business_signup_version:1,organization_name:' Meridian Logistics ',role:'admin'})).toBe('Meridian Logistics');
    expect(signupOrganization({organization_name:'Legacy profile'})).toBeNull();
    expect(signupOrganization({business_signup_version:1,organization_name:'  '})).toBeNull();
    expect(signupOrganization({business_signup_version:1,organization_name:'x'.repeat(101)})).toBeNull();
    expect(signupOrganization(undefined)).toBeNull();
  });
});
