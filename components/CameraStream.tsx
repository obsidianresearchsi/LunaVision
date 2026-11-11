import React, { forwardRef, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

type Props = React.VideoHTMLAttributes<HTMLVideoElement> & { streamType?: 'video' | 'hls' | 'mjpeg'; onStreamError?: () => void; onStreamReady?: () => void };

export const CameraStream = forwardRef<HTMLVideoElement, Props>(function CameraStream({ src, streamType = 'video', onStreamError, onStreamReady, onError, ...props }, ref) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const callbacks = useRef({ onStreamError });
  callbacks.current = { onStreamError };
  const hls = streamType === 'hls' || Boolean(src && /\.m3u8(?:[?#]|$)/i.test(src));
  useEffect(() => {
    setFailed(false);
    const media = video.current;
    if (!media || !src || streamType === 'mjpeg' || !hls) return;
    // Prefer native HLS on Safari; use Media Source Extensions on Chrome and Edge.
    if (media.canPlayType('application/vnd.apple.mpegurl')) { media.src = src; return; }
    if (!Hls.isSupported()) { setFailed(true); callbacks.current.onStreamError?.(); return; }
    const engine = new Hls({ enableWorker: true, maxBufferLength: 15, backBufferLength: 15 });
    let networkRetries = 0, mediaRetries = 0;
    engine.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 2) engine.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 1) engine.recoverMediaError();
      else { engine.destroy(); setFailed(true); callbacks.current.onStreamError?.(); }
    });
    engine.attachMedia(media);
    engine.loadSource(src);
    return () => engine.destroy();
  }, [src, hls, streamType]);
  if (streamType === 'mjpeg') return <img src={src} alt={props['aria-label'] ?? 'Live camera feed'}
    style={props.style} onLoad={onStreamReady} onError={() => { setFailed(true); callbacks.current.onStreamError?.(); }} />;
  return <>
    <video {...props} src={hls ? undefined : src} ref={element => {
      video.current = element;
      if (typeof ref === 'function') ref(element); else if (ref) ref.current = element;
    }} onError={event => { onError?.(event); callbacks.current.onStreamError?.(); }} />
    {failed && <p role="alert">Stream connection failed. Check gateway availability, HTTPS, CORS, and camera credentials at the gateway, then retry.</p>}
  </>;
});
