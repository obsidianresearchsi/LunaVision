import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { compressImage } from '../utils/imageCompression';
import { roleCan } from '../services/videoIntelligence';

interface CrawledFacePreview {
  subjectCode: string;
  label: string;
  sourceDomain: string;
  sourceUrl: string;
  faceToken: string;
  faceIndexed: boolean;
  qualityScore: number | null;
  previewDataUrl: string;
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
}

function generateCrawlCode(): string {
  const year = new Date().getFullYear();
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CRAWL-${year}-${rnd}`;
}

export default function CrawlerManager({
  workspaceId,
  role = 'member',
  platformAdmin = false,
  onOpenCrawledFaces,
}: {
  workspaceId: string;
  role?: string;
  platformAdmin?: boolean;
  onOpenCrawledFaces?: () => void;
}) {
  const canOperate = roleCan(role, 'watchlist_write', platformAdmin);
  const [seedUrls, setSeedUrls] = useState(
    'https://punchng.com\nhttps://www.vanguardngr.com\nhttps://guardian.ng',
  );
  const [keyword, setKeyword] = useState('');
  const [maxFacesPerUrl, setMaxFacesPerUrl] = useState(4);
  const [defaultLocation, setDefaultLocation] = useState('');
  const [running, setRunning] = useState(false);
  const [totalStored, setTotalStored] = useState<number | null>(null);
  const [scanStats, setScanStats] = useState({
    urlsScanned: 0,
    imagesChecked: 0,
    facesDetected: 0,
    facesSaved: 0,
    skippedNoFace: 0,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [captured, setCaptured] = useState<CrawledFacePreview[]>([]);
  const [error, setError] = useState('');
  const stopRequestedRef = useRef(false);

  function addLog(message: string) {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev].slice(0, 80));
  }

  useEffect(() => {
    let active = true;
    setTotalStored(null);
    void supabase
      .from('lv_agency_subjects')
      .select('id,source_name')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (!active) return;
        const rows = Array.isArray(data) ? data : [];
        setTotalStored(rows.filter((r: any) => String(r.source_name || '').toLowerCase().startsWith('web_crawler:')).length);
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  async function startCrawl(event: FormEvent) {
    event.preventDefault();
    if (!canOperate || running) return;

    const urlList = seedUrls
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (urlList.length === 0) {
      setError('Enter at least one public http(s) URL to scan.');
      return;
    }

    setError('');
    setRunning(true);
    stopRequestedRef.current = false;
    setScanStats({ urlsScanned: 0, imagesChecked: 0, facesDetected: 0, facesSaved: 0, skippedNoFace: 0 });
    addLog(`Initiating web intelligence crawl across ${urlList.length} target URL(s)…`);

    try {
      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      if (sessErr || !sess.session) {
        throw new Error('Sign in again to run web crawler jobs.');
      }

      for (const rawUrl of urlList) {
        if (stopRequestedRef.current) {
          addLog('Crawl halted by operator.');
          break;
        }
        addLog(`Scanning target: ${rawUrl}`);

        const res = await fetch('/api/web-crawler', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + sess.session.access_token,
            'X-Workspace-Id': workspaceId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: rawUrl,
            keyword: keyword.trim(),
            maxFaces: maxFacesPerUrl,
          }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          addLog(`Target skipped (${rawUrl}): ${payload?.error || `HTTP ${res.status}`}`);
          setScanStats((s) => ({ ...s, urlsScanned: s.urlsScanned + 1 }));
          continue;
        }

        const faces = Array.isArray(payload?.faces) ? payload.faces : [];
        setScanStats((s) => ({
          ...s,
          urlsScanned: s.urlsScanned + 1,
          imagesChecked: s.imagesChecked + Number(payload?.images_checked || 0),
          facesDetected: s.facesDetected + faces.length,
          skippedNoFace: s.skippedNoFace + Number(payload?.skipped_no_face || 0),
        }));
        addLog(
          `Parsed ${payload?.source_domain || rawUrl}: checked ${payload?.images_checked ?? 0} images, detected ${faces.length} face(s), skipped ${payload?.skipped_no_face ?? 0} non-face images.`,
        );

        for (let idx = 0; idx < faces.length; idx++) {
          if (stopRequestedRef.current) break;
          const face = faces[idx];
          try {
            const rawBlob = base64ToBlob(face.image_base64, face.content_type || 'image/jpeg');
            const rawFile = new File([rawBlob], `crawl-${idx + 1}.jpg`, { type: face.content_type || 'image/jpeg' });
            const compressed = await compressImage(rawFile, 720, 0.85);
            const storagePath = `${workspaceId}/crawled/${crypto.randomUUID()}.jpg`;
            const { error: upErr } = await supabase.storage
              .from('lv-subject-photos')
              .upload(storagePath, compressed, { contentType: 'image/jpeg', upsert: false });
            if (upErr) throw new Error(upErr.message);

            const code = generateCrawlCode();
            const cleanName = String(face.label || '').trim().slice(0, 90) || `Web Subject (${face.source_domain})`;
            const { error: rpcErr } = await supabase.rpc('lv_upsert_agency_subject', {
              target: workspaceId,
              entry: {
                subject_code: code,
                full_name: cleanName,
                category: 'person_of_interest',
                threat_level: 'low',
                last_known_location: defaultLocation.trim(),
                offense_summary: `OSINT web capture from ${face.page_title || face.source_domain}`,
                notes: `Source Page: ${face.source_url}\nImage URL: ${face.image_url}`,
                status: 'active',
                minimum_clearance: 0,
                source_name: `web_crawler:${String(face.source_domain || 'web').slice(0, 95)}`,
              },
              photos: [
                {
                  storage_path: storagePath,
                  face_token: face.face_token,
                  face_indexed: Boolean(face.face_indexed),
                  angle_label: 'other',
                  quality_score: face.quality_score,
                  is_primary: true,
                },
              ],
            });
            if (rpcErr) throw new Error(rpcErr.message);

            setScanStats((s) => ({ ...s, facesSaved: s.facesSaved + 1 }));
            setTotalStored((prev) => (prev === null ? 1 : prev + 1));
            setCaptured((prev) => [
              {
                subjectCode: code,
                label: cleanName,
                sourceDomain: face.source_domain,
                sourceUrl: face.source_url,
                faceToken: face.face_token,
                faceIndexed: Boolean(face.face_indexed),
                qualityScore: face.quality_score ?? null,
                previewDataUrl: `data:${face.content_type || 'image/jpeg'};base64,${face.image_base64}`,
              },
              ...prev,
            ]);
            addLog(`Indexed face ${code} from ${face.source_domain} (${face.face_indexed ? 'FaceDB indexed' : 'Direct compare ready'}).`);
          } catch (saveErr) {
            addLog(`Failed saving face from ${face.source_domain}: ${saveErr instanceof Error ? saveErr.message : 'Save error'}`);
          }
        }
      }
      addLog('Crawl sequence completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Web crawler execution failed.');
      addLog(`ERROR: ${err instanceof Error ? err.message : 'Execution failed'}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="lv-card" aria-label="OSINT Web Crawler">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>OSINT Web Intelligence Crawler &amp; Face Harvester</h2>
          <p>
            Scan authorized public web pages, newsrooms, wanted bulletins, or image URLs, extract human faces via
            FaceDB, index biometric templates inside this agency&apos;s isolated FaceSet, and archive them to Crawled faces.
          </p>
        </div>
        {onOpenCrawledFaces && (
          <button type="button" className="lv-secondary" onClick={onOpenCrawledFaces}>
            Open Crawled faces{totalStored === null ? '' : ` (${totalStored})`}
          </button>
        )}
      </div>

      <div className="lv-console-metrics" style={{ marginBlock: '0.85rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <article>
          <span>Archived crawled faces</span>
          <strong>{totalStored === null ? '…' : totalStored.toLocaleString()}</strong>
          <small>Stored in agency FaceSet</small>
        </article>
        <article>
          <span>URLs scanned (run)</span>
          <strong>{running || scanStats.urlsScanned > 0 ? scanStats.urlsScanned : '—'}</strong>
          <small>{scanStats.imagesChecked} images inspected</small>
        </article>
        <article style={{ borderColor: '#2dd4bf' }}>
          <span>Faces indexed (run)</span>
          <strong>{running || scanStats.facesSaved > 0 ? scanStats.facesSaved : '—'}</strong>
          <small>{scanStats.skippedNoFace} non-face images skipped</small>
        </article>
      </div>

      {!canOperate && (
        <p className="lv-notice">
          Read-only view: Only Investigators, Supervisors, Administrators, or Owners can launch web crawler jobs.
        </p>
      )}
      {error && <p role="alert" style={{ color: '#ff8b89' }}>{error}</p>}

      <div className="lv-grid" style={{ marginTop: '0.75rem' }}>
        <form onSubmit={(e) => void startCrawl(e)} className="lv-card" style={{ marginBlock: 0, background: '#0b121a' }}>
          <h3 style={{ marginTop: 0 }}>Crawl Target Configuration</h3>
          <label>
            Public http(s) seed URLs or direct image URLs (one per line)
            <textarea
              name="seed_urls"
              rows={5}
              value={seedUrls}
              onChange={(e) => setSeedUrls(e.target.value)}
              disabled={running || !canOperate}
              required
              placeholder="https://example.org/wanted-persons"
            />
          </label>
          <div className="lv-form-grid">
            <label>
              Priority keyword filter (optional)
              <input
                name="keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                disabled={running || !canOperate}
                maxLength={80}
                placeholder="e.g. wanted, suspect, Lagos"
              />
            </label>
            <label>
              Default location tag (optional)
              <input
                name="default_location"
                value={defaultLocation}
                onChange={(e) => setDefaultLocation(e.target.value)}
                disabled={running || !canOperate}
                maxLength={120}
                placeholder="e.g. Lagos, Abuja"
              />
            </label>
          </div>
          <label>
            Max faces indexed per URL (1–8)
            <input
              type="number"
              min={1}
              max={8}
              value={maxFacesPerUrl}
              onChange={(e) => setMaxFacesPerUrl(Math.min(8, Math.max(1, Number(e.target.value) || 4)))}
              disabled={running || !canOperate}
            />
          </label>
          <div className="lv-video-actions" style={{ marginTop: '0.5rem' }}>
            <button type="submit" disabled={!canOperate || running}>
              {running ? 'Crawling & indexing faces…' : 'Start Web Crawl'}
            </button>
            {running && (
              <button
                type="button"
                className="lv-secondary"
                onClick={() => {
                  stopRequestedRef.current = true;
                }}
              >
                Stop crawl
              </button>
            )}
          </div>
        </form>

        <section className="lv-card" style={{ marginBlock: 0, background: '#091017' }} aria-label="Live crawl telemetry log">
          <h3 style={{ marginTop: 0 }}>Live Crawl Sequence Log</h3>
          {logs.length === 0 ? (
            <p style={{ color: '#94a3b8' }}>
              Configure public URLs on the left and click <strong>Start Web Crawl</strong> to detect and index faces live on Vercel serverless.
            </p>
          ) : (
            <div
              style={{
                maxHeight: '290px',
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: '0.79rem',
                display: 'grid',
                gap: '0.35rem',
                background: '#05090e',
                padding: '0.65rem',
                borderRadius: '6px',
                border: '1px solid #1e2d3d',
              }}
            >
              {logs.map((entry, idx) => (
                <div key={idx} style={{ color: entry.includes('ERROR') ? '#ff8b89' : entry.includes('Indexed face') ? '#76efd6' : '#cbd5e1' }}>
                  {entry}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {captured.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Newly Captured &amp; Indexed Faces ({captured.length})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '0.75rem' }}>
            {captured.map((item) => (
              <article key={item.subjectCode} style={{ padding: '0.65rem', background: '#0b121a', borderRadius: '8px', border: '1px solid #223244' }}>
                <img
                  src={item.previewDataUrl}
                  alt={item.label}
                  style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '6px' }}
                />
                <div style={{ marginTop: '0.45rem' }}>
                  <strong style={{ display: 'block', fontSize: '0.86rem' }}>{item.label}</strong>
                  <small style={{ color: '#94a3b8' }}>
                    {item.subjectCode} · {item.sourceDomain}
                  </small>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                    <span className="lv-badge">{item.faceIndexed ? 'FaceDB Indexed' : 'Direct Compare'}</span>
                    {item.qualityScore !== null && <span className="lv-badge">Q {item.qualityScore}</span>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

