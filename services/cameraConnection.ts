export function cameraSource(raw:string,username='',password='') {
  let url:URL;
  try {url=new URL(raw.trim());} catch {throw new Error('Enter a complete camera URL, for example rtsp://192.168.1.50:554/stream1.');}
  if(url.protocol==='rstp:')throw new Error('Use rtsp://, not rstp://, at the start of the camera URL.');
  if(!['rtsp:','rtsps:','http:','https:'].includes(url.protocol)||!url.hostname||url.hash)throw new Error('Camera sources must use rtsp://, rtsps://, http:// or https:// and have a valid hostname.');
  if((url.username||url.password)&&(username||password))throw new Error('Credentials are present in both the URL and the separate fields. Use one place for the credentials.');
  try {username=username||decodeURIComponent(url.username);password=password||decodeURIComponent(url.password);} catch {throw new Error('The credentials in this URL are not correctly encoded. Enter them in the separate fields.');}
  url.username='';url.password='';
  return {source_url:url.href,source_username:username,source_password:password};
}

export function cameraRegistrationError(error:{code?:string;message?:string}) {
  const code=error.code??'';
  if(code==='PGRST202')return 'Camera registration is unavailable on the server. Reload and contact your administrator if it continues.';
  if(code==='42501'||/unavailable|scope|clearance/i.test(error.message??''))return 'Camera registration requires an active workspace administrator account and sufficient clearance. Refresh access and try again.';
  if(code==='23514'||/Invalid source/i.test(error.message??''))return 'Check the camera name, source URL, stream format and clearance. Supply a complete camera URL.';
  return `Camera could not be saved${/^[A-Z0-9]{5,12}$/.test(code)?` (${code})`:''}. Your details are retained. Check your connection and try again.`;
}
