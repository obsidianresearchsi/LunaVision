import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { roleCan } from '../services/videoIntelligence';

interface CrawledSubjectRow {
  id: string;
  subject_code: string | null;
  full_name: string;
  category: string;
  threat_level: string;
  offense_summary: string;
  last_known_location: string;
  notes: string;
  status: string;
  primary_photo_path: string | null;
  face_token: string | null;
  face_indexed: boolean;
  source_name: string;
  created_at: string;
  created_by_label: string;
}

const CRAWLED_PAGE_SIZE = 12;

export default function CrawledFacesGallery({
  workspaceId,
  role = 'member',
  platformAdmin = false,
  onOpenCrawler,
  onOpenWatchlist,
}: {
  workspaceId: string;
  role?: string;
  platformAdmin?: boolean;
  onOpenCrawler?: () => void;
  onOpenWatchlist?: () => void;
}) {
  const canWrite = roleCan(role, 'watchlist_write', platformAdmin);
  const canDelete = roleCan(role, 'watchlist_delete', platformAdmin);

  const [faces, setFaces] = useState<CrawledSubjectRow[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selected, setSelected] = useState<CrawledSubjectRow | null>(null);

  useEffect(() => {
    setPage(0);
  }, [query, domainFilter, workspaceId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void supabase
      .from('lv_agency_subjects')
      .select('id,subject_code,full_name,category,threat_level,offense_summary,last_known_location,notes,status,primary_photo_path,face_token,face_indexed,source_name,created_at,created_by_label')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(240)
      .then(async ({ data, error: fetchErr }) => {
        if (!active) return;
        if (fetchErr) {
          setError(fetchErr.message);
          setLoading(false);
          return;
        }
        const rows = ((data ?? []) as CrawledSubjectRow[]).filter((r) =>
          String(r.source_name || '').toLowerCase().startsWith('web_crawler:'),
        );
        setFaces(rows);
        const signedMap: Record<string, string> = {};
        const storage = (supabase as any)?.storage;
        if (storage?.from) {
          await Promise.all(
            rows
              .filter((r) => r.primary_photo_path)
              .slice(0, 48)
              .map(async (r) => {
                try {
                  const { data: signed } = await storage.from('lv-subject-photos').createSignedUrl(r.primary_photo_path!, 600);
                  if (signed?.signedUrl) signedMap[r.id] = signed.signedUrl;
                } catch {
                  // ignore
                }
              }),
          );
        }
        if (active) {
          setPhotoUrls(signedMap);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId, refreshTick]);

  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of faces) {
      const domain = f.source_name.replace(/^web_crawler:/i, '') || 'web';
      counts.set(domain, (counts.get(domain) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [faces]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return faces.filter((f) => {
      const domain = f.source_name.replace(/^web_crawler:/i, '') || 'web';
      if (domainFilter !== 'all' && domain !== domainFilter) return false;
      if (!q) return true;
      return `${f.full_name} ${f.subject_code || ''} ${domain} ${f.offense_summary} ${f.notes} ${f.last_known_location}`
        .toLowerCase()
        .includes(q);
    });
  }, [faces, domainFilter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / CRAWLED_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * CRAWLED_PAGE_SIZE, (safePage + 1) * CRAWLED_PAGE_SIZE);

  async function promoteToWatchlist(face: CrawledSubjectRow, nextCategory: 'wanted' | 'suspect') {
    if (!canWrite || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: rpcErr } = await supabase.rpc('lv_upsert_agency_subject', {
        target: workspaceId,
        entry: {
          id: face.id,
          subject_code: face.subject_code,
          full_name: face.full_name,
          category: nextCategory,
          threat_level: nextCategory === 'wanted' ? 'high' : 'medium',
          status: 'active',
        },
        photos: [],
      });
      if (rpcErr) throw new Error(rpcErr.message);
      setNotice(`Promoted "${face.full_name}" to active ${nextCategory} watchlist.`);
      setSelected(null);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not promote crawled face.');
    } finally {
      setBusy(false);
    }
  }

  async function removeCrawledFace(face: CrawledSubjectRow) {
    if (!canDelete || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: delErr } = await supabase.rpc('lv_delete_agency_subject', { target_id: face.id });
      if (delErr) throw new Error(delErr.message);
      if (face.primary_photo_path) {
        await supabase.storage.from('lv-subject-photos').remove([face.primary_photo_path]).catch(() => {});
      }
      setNotice(`Deleted crawled face "${face.full_name}".`);
      setSelected(null);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete crawled face.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lv-card" aria-label="Crawled faces biometric archive">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>OSINT Crawled Faces Archive</h2>
          <p>
            All faces harvested from authorized web intelligence scans. Inspect source provenance, search via Face
            Search, or promote flagged individuals straight into the active Suspect/Wanted Watchlist.
          </p>
        </div>
        <div className="lv-video-actions">
          {onOpenCrawler && (
            <button type="button" onClick={onOpenCrawler}>
              Launch Web Crawler
            </button>
          )}
          {onOpenWatchlist && (
            <button type="button" className="lv-secondary" onClick={onOpenWatchlist}>
              Open Watchlist
            </button>
          )}
          <button type="button" className="lv-secondary" disabled={loading} onClick={() => setRefreshTick((t) => t + 1)}>
            Refresh
          </button>
        </div>
      </div>

      <div className="lv-console-metrics" style={{ marginBlock: '0.85rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <article>
          <span>Total crawled faces</span>
          <strong>{loading ? '…' : faces.length.toLocaleString()}</strong>
          <small>Indexed from web sources</small>
        </article>
        <article>
          <span>Distinct web domains</span>
          <strong>{loading ? '…' : domains.length}</strong>
          <small>Verified public sources</small>
        </article>
        <article style={{ borderColor: '#2dd4bf' }}>
          <span>Matching filter</span>
          <strong>{loading ? '…' : filtered.length.toLocaleString()}</strong>
          <small>Ready for triage</small>
        </article>
      </div>

      {error && <p role="alert" style={{ color: '#ff8b89' }}>{error}</p>}
      {notice && <p role="status" className="lv-notice">{notice}</p>}

      <div className="lv-observation-filters" style={{ marginBottom: '0.85rem' }}>
        <label>
          Search by label, code, domain, or source URL
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter crawled faces..."
          />
        </label>
        <label>
          Source domain
          <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}>
            <option value="all">All domains{loading ? '' : ` (${faces.length})`}</option>
            {domains.map(([dom, cnt]) => (
              <option key={dom} value={dom}>
                {dom} ({cnt})
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="lv-notice">Fetching crawled faces and signed thumbnails…</p>
      ) : paged.length === 0 ? (
        <p>No crawled faces found yet. Use Web crawler to scan public web sources and index detected faces.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '0.85rem' }}>
            {paged.map((face) => {
              const domain = face.source_name.replace(/^web_crawler:/i, '') || 'web';
              return (
                <article
                  key={face.id}
                  style={{
                    borderRadius: '8px',
                    border: '1px solid #223244',
                    background: '#0b121a',
                    padding: '0.7rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.45rem',
                  }}
                >
                  {photoUrls[face.id] ? (
                    <img
                      src={photoUrls[face.id]}
                      alt={face.full_name}
                      style={{ width: '100%', height: '155px', objectFit: 'cover', borderRadius: '6px', background: '#05090d' }}
                    />
                  ) : (
                    <div style={{ height: '155px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#05090d', borderRadius: '6px', color: '#64748b' }}>
                      No preview
                    </div>
                  )}
                  <strong style={{ fontSize: '0.9rem' }}>{face.full_name}</strong>
                  <small style={{ color: '#94a3b8' }}>
                    {domain} · {new Date(face.created_at).toLocaleDateString()}
                  </small>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {face.subject_code && <span className="lv-badge">{face.subject_code}</span>}
                    <span className="lv-badge">{face.face_indexed ? 'FaceDB Indexed' : 'Direct Compare'}</span>
                    <span className="lv-badge">{face.category.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="lv-video-actions" style={{ marginTop: 'auto' }}>
                    <button type="button" className="lv-secondary" onClick={() => setSelected(face)}>
                      Inspect
                    </button>
                    {canWrite && face.category !== 'wanted' && (
                      <button type="button" disabled={busy} onClick={() => void promoteToWatchlist(face, 'wanted')}>
                        Promote to Wanted
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {filtered.length > CRAWLED_PAGE_SIZE && (
            <div className="lv-video-actions" style={{ marginTop: '0.9rem', justifyContent: 'space-between' }}>
              <button type="button" className="lv-secondary" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </button>
              <small style={{ color: '#94a3b8' }}>
                Page {safePage + 1} of {totalPages} · Showing {safePage * CRAWLED_PAGE_SIZE + 1}–
                {Math.min((safePage + 1) * CRAWLED_PAGE_SIZE, filtered.length)} of {filtered.length} faces
              </small>
              <button type="button" className="lv-secondary" disabled={safePage + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}

      {selected && (
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            borderRadius: '10px',
            border: '1px solid #38bdf8',
            background: '#091119',
          }}
          role="region"
          aria-label="Crawled face inspection details"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Provenance Details: {selected.full_name}</h3>
            <button type="button" className="lv-secondary" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p style={{ margin: '0.4rem 0', fontSize: '0.86rem', whiteSpace: 'pre-line', color: '#cbd5e1' }}>
            {selected.notes || selected.offense_summary}
          </p>
          <p style={{ margin: '0.3rem 0', fontSize: '0.82rem', color: '#94a3b8' }}>
            Token: <code>{selected.face_token || 'Unavailable'}</code> · Captured {new Date(selected.created_at).toLocaleString()}
          </p>
          <div className="lv-video-actions" style={{ marginTop: '0.6rem' }}>
            {canWrite && (
              <>
                <button type="button" disabled={busy} onClick={() => void promoteToWatchlist(selected, 'wanted')}>
                  Promote to Wanted Watchlist
                </button>
                <button type="button" className="lv-secondary" disabled={busy} onClick={() => void promoteToWatchlist(selected, 'suspect')}>
                  Promote to Suspect
                </button>
              </>
            )}
            {canDelete && (
              <button
                type="button"
                className="lv-secondary"
                style={{ borderColor: '#ef4444', color: '#ff8b89' }}
                disabled={busy}
                onClick={() => void removeCrawledFace(selected)}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

