import React, { useEffect, useRef, useState } from 'react';

/** Fullscreen the video AND its overlays. Native video fullscreen excludes sibling SVG/canvas elements. */
export default function VideoViewport({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fullscreen = nativeFullscreen || expanded;
  useEffect(() => {
    const changed = () => setNativeFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', escape); };
  }, [expanded]);

  async function toggle() {
    if (expanded) { setExpanded(false); return; }
    if (document.fullscreenElement === frame.current) {
      try { await document.exitFullscreen(); } catch { /* Keep the exit control visible if the browser rejects exit. */ }
      return;
    }
    if (frame.current?.requestFullscreen) {
      try { await frame.current.requestFullscreen(); return; } catch { /* Use an expanded overlay if browser fullscreen is unavailable. */ }
    }
    setExpanded(true);
  }

  return <div ref={frame} className="lv-video-frame" data-expanded={expanded ? 'true' : undefined}
    style={{ aspectRatio: width + '/' + height, '--lv-video-ratio': String(width / height) } as React.CSSProperties}>
    <div className="lv-video-surface">{children}</div>
    <button type="button" className="lv-video-fullscreen" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen with detections'}
      aria-pressed={fullscreen} onClick={() => void toggle()}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
  </div>;
}
