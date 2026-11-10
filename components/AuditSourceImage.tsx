import React, { useEffect, useRef, useState } from 'react';
import { Image, RefreshCw } from 'lucide-react';
import { supabaseDb } from '../services/supabaseDb';

export function AuditSourceImage({ logId, initialSource = '', alt, className = '' }: { logId: string; initialSource?: string; alt: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(initialSource);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setSource(initialSource); setFailed(false);
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '100px' });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [logId, initialSource]);
  useEffect(() => {
    if (!visible || initialSource) return;
    let active = true; setFailed(false);
    supabaseDb.getAuditImage(logId).then(value => { if (active) { setSource(value); setFailed(!value); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [logId, initialSource, visible, retry]);
  const imageUrl = /^(data:|https?:|\/)/.test(source) ? source : `data:image/jpeg;base64,${source}`;
  return <div ref={host} className={`w-full h-full min-h-24 flex items-center justify-center ${className}`}>
    {source ? <img src={imageUrl} alt={alt} className="w-full h-full object-cover"/> : failed ?
      <button type="button" aria-label="Retry loading source image" className="text-xs text-slate-400 p-3" onClick={event => { event.stopPropagation(); setRetry(value => value + 1); }}><RefreshCw size={16} className="mx-auto mb-2"/>Image unavailable · Retry</button> :
      <span role="status" className="text-xs text-slate-500"><Image size={20} className="mx-auto mb-2"/>Loading saved image…</span>}
  </div>;
}
