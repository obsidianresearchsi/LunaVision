/** Profile metadata supplies a workspace name, never roles, clearance or permissions. */
export function signupOrganization(metadata: Record<string, unknown> | undefined): string | null {
  if (metadata?.business_signup_version !== 1 || typeof metadata.organization_name !== 'string') return null;
  const name = metadata.organization_name.trim();
  return name.length >= 2 && name.length <= 100 ? name : null;
}
