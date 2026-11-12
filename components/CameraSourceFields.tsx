import React from 'react';

export default function CameraSourceFields() {
  return <>
    <label>Camera source URL<input name="source_url" type="url" required maxLength={2048} placeholder="rtsp://192.168.1.50:554/stream1" autoComplete="off" /></label>
    <label>Camera username<input name="source_username" maxLength={256} autoComplete="off" /></label>
    <label>Camera password<input name="source_password" type="password" maxLength={2048} autoComplete="new-password" /></label>
    <p>Saved encrypted in Supabase Vault. Passwords are never displayed again. Enter credentials in the fields above, or paste a camera URL containing credentials and leave these fields blank. Leave both fields blank for an unauthenticated source.</p>
  </>;
}
