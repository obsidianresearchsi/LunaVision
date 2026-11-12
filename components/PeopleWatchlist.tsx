import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { compressImage } from '../utils/imageCompression';
import { roleCan } from '../services/videoIntelligence';
import { dispatchOperationalAlert } from '../services/liveAlertBus';
import { LocationPicker, type RecordPosition } from './RecordLocation';
import { formatLocationWithCoords, parseSubjectLocation, stripLocationCoords } from '../services/locationUtils';
import VehicleWatchlist from './VehicleWatchlist';

interface WatchlistPerson {
  id: string;
  subject_code: string | null;
  full_name: string;
  aliases: string;
  category: 'wanted' | 'suspect' | 'person_of_interest' | 'missing' | 'authorized' | 'other';
  threat_level: 'low' | 'medium' | 'high' | 'critical';
  offense_summary: string;
  warrant_reference: string;
  case_reference: string;
  last_known_location: string;
  latitude?: number | null;
  longitude?: number | null;
  status: string;
  primary_photo_path: string | null;
  face_token: string | null;
  face_indexed: boolean;
  created_at: string;
  created_by_label: string;
}

const WATCHLIST_CATEGORIES = new Set(['wanted', 'suspect', 'person_of_interest', 'missing']);
const PEOPLE_PAGE_SIZE = 8;

function generateWatchCode(): string {
  return `WL-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export default function PeopleWatchlist({
  workspaceId,
  role = 'member',
  platformAdmin = false,
}: {
  workspaceId: string;
  role?: string;
  platformAdmin?: boolean;
}) {
  const canWrite = roleCan(role, 'watchlist_write', platformAdmin);
  const canArchive = roleCan(role, 'watchlist_archive', platformAdmin);
  const canDelete = roleCan(role, 'watchlist_delete', platformAdmin);

  const [sectionTab, setSectionTab] = useState<'people' | 'vehicles'>('people');
  const [people, setPeople] = useState<WatchlistPerson[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [threatFilter, setThreatFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);

  // Add Person form state
  const [personPos, setPersonPos] = useState<RecordPosition | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setPage(0);
  }, [query, catFilter, threatFilter, workspaceId]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [photoFile]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void supabase
      .from('lv_agency_subjects')
      .select('id,subject_code,full_name,aliases,category,threat_level,offense_summary,warrant_reference,case_reference,last_known_location,status,primary_photo_path,face_token,face_indexed,created_at,created_by_label')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(async ({ data, error: fetchErr }) => {
        if (!active) return;
        if (fetchErr) {
          setError(fetchErr.message);
          setLoading(false);
          return;
        }
        const rows = ((data ?? []) as WatchlistPerson[]).filter(
          (r) => r.status === 'active' && WATCHLIST_CATEGORIES.has(r.category),
        );
        setPeople(rows);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (!WATCHLIST_CATEGORIES.has(p.category)) return false;
      if (catFilter !== 'all' && p.category !== catFilter) return false;
      if (threatFilter !== 'all' && p.threat_level !== threatFilter) return false;
      if (!q) return true;
      return `${p.full_name} ${p.aliases} ${p.subject_code || ''} ${p.offense_summary} ${p.warrant_reference} ${p.case_reference} ${p.last_known_location}`
        .toLowerCase()
        .includes(q);
    });
  }, [people, query, catFilter, threatFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PEOPLE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PEOPLE_PAGE_SIZE, (safePage + 1) * PEOPLE_PAGE_SIZE);

  async function addPersonToWatchlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const fullName = String(fields.get('full_name') || '').trim();
    const category = String(fields.get('category') || 'wanted');
    const threatLevel = String(fields.get('threat_level') || 'high');
    const caseRef = String(fields.get('case_reference') || '').trim();
    const warrantRef = String(fields.get('warrant_reference') || '').trim();
    const offenseSummary = String(fields.get('offense_summary') || '').trim();
    const aliases = String(fields.get('aliases') || '').trim();
    const rawLocation = String(fields.get('last_known_location') || '').trim();

    if (fullName.length < 2) {
      setError('Enter the person full name (at least 2 characters).');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');

    try {
      const photos: any[] = [];
      let faceWarning = '';

      if (photoFile) {
        const { data: sess, error: sessErr } = await supabase.auth.getSession();
        if (sessErr || !sess.session) throw new Error('Sign in again to enroll watchlist biometrics.');

        const compressed = await compressImage(photoFile, 900, 0.88);
        const prepared = new File([compressed], 'watchlist-person.jpg', { type: 'image/jpeg' });

        // Register face on FaceDB if available
        let bioData: any = null;
        try {
          const payload = new FormData();
          payload.set('action', 'enroll_face');
          payload.set('photo', prepared);
          const bioRes = await fetch('/api/face-intelligence', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + sess.session.access_token,
              'X-Workspace-Id': workspaceId,
            },
            body: payload,
          });
          if (bioRes.ok) {
            bioData = await bioRes.json().catch(() => null);
          } else {
            const errBody = await bioRes.json().catch(() => null);
            faceWarning = errBody?.error || 'FaceDB unavailable; stored photo for manual visual review.';
          }
        } catch {
          faceWarning = 'FaceDB request skipped; photo archived locally.';
        }

        const storagePath = `${workspaceId}/watchlist-people/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from('lv-subject-photos')
          .upload(storagePath, prepared, { contentType: 'image/jpeg', upsert: false });
        if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);

        photos.push({
          storage_path: storagePath,
          face_token: bioData?.face_token ?? null,
          face_indexed: Boolean(bioData?.face_indexed),
          angle_label: 'frontal',
          quality_score: bioData?.quality_score ?? null,
          is_primary: true,
        });
      }

      const code = generateWatchCode();
      const persistedLocation = formatLocationWithCoords(rawLocation, personPos);
      const { data: savedRow, error: rpcErr } = await supabase.rpc('lv_upsert_agency_subject', {
        target: workspaceId,
        entry: {
          subject_code: code,
          full_name: fullName,
          aliases,
          category,
          threat_level: threatLevel,
          offense_summary: offenseSummary,
          warrant_reference: warrantRef,
          case_reference: caseRef,
          last_known_location: persistedLocation,
          status: 'active',
          minimum_clearance: 0,
          source_name: 'watchlist_person',
        },
        photos,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      const savedId =
        savedRow && typeof savedRow === 'object' && 'id' in savedRow
          ? String((savedRow as { id: string }).id)
          : typeof savedRow === 'string'
            ? savedRow
            : '';
      if (personPos && savedId) {
        try {
          await supabase
            .from('lv_agency_subjects')
            .update({ latitude: personPos.latitude, longitude: personPos.longitude })
            .eq('workspace_id', workspaceId)
            .eq('id', savedId);
        } catch {
          // Safe fallback if migration 202611130002 is pending
        }
      }

      form.reset();
      setPhotoFile(null);
      setPersonPos(null);
      setRefreshTick((t) => t + 1);
      setNotice(
        faceWarning
          ? `Added "${fullName}" (${code}) to People Watchlist (${faceWarning})`
          : `Added "${fullName}" (${code}) to People Watchlist${photos.length ? ' and indexed on FaceDB for live alerts' : ''}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add person to watchlist.');
    } finally {
      setBusy(false);
    }
  }

  async function archivePerson(p: WatchlistPerson) {
    if (!canArchive || busy) return;
    setBusy(true);
    try {
      const { error: err } = await supabase.rpc('lv_retire_agency_subject', { target_id: p.id });
      if (err) throw new Error(err.message);
      setNotice(`Archived "${p.full_name}" from active People Watchlist.`);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive person.');
    } finally {
      setBusy(false);
    }
  }

  async function deletePerson(p: WatchlistPerson) {
    if (!canDelete || busy) return;
    setBusy(true);
    try {
      const { error: err } = await supabase.rpc('lv_delete_agency_subject', { target_id: p.id });
      if (err) throw new Error(err.message);
      if (p.primary_photo_path) {
        await supabase.storage.from('lv-subject-photos').remove([p.primary_photo_path]).catch(() => {});
      }
      setNotice(`Removed "${p.full_name}" from People Watchlist.`);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete watchlist person.');
    } finally {
      setBusy(false);
    }
  }

  async function triggerPersonBoloAlert(p: WatchlistPerson) {
    setBusy(true);
    try {
      await dispatchOperationalAlert({
        workspaceId,
        kind: 'face_match',
        title: `Watchlist BOLO: ${p.full_name} (${p.threat_level.toUpperCase()})`,
        details: `${p.category.replace(/_/g, ' ')} · ${p.offense_summary || 'Flagged person of interest'}${
          p.warrant_reference ? ` · Warrant ${p.warrant_reference}` : ''
        }`,
        severity: p.threat_level === 'critical' || p.threat_level === 'high' ? 'high' : 'medium',
        cameraName: 'Watchlist Command Desk',
        recommendedAction: 'Alert field units & verify against live Face Search checkpoints.',
        dedupeKey: `bolo-${p.id}-${Date.now()}`,
      });
      setNotice(`Dispatched BOLO watchlist alert for "${p.full_name}".`);
    } catch {
      setError('Could not dispatch alert.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <section className="lv-card" aria-label="Watchlist Management Center">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ marginBottom: '0.2rem' }}>Agency Watchlist Command</h2>
            <p style={{ margin: 0, color: '#94a3b8' }}>
              Manage flagged individuals (Wanted, Suspects, Persons of Interest, Missing) and vehicles of interest in one unified watchlist center.
            </p>
          </div>
          <div className="lv-video-actions">
            <button
              type="button"
              className={sectionTab === 'people' ? '' : 'lv-secondary'}
              onClick={() => setSectionTab('people')}
            >
              People Watchlist{loading ? '' : ` (${people.length})`}
            </button>
            <button
              type="button"
              className={sectionTab === 'vehicles' ? '' : 'lv-secondary'}
              onClick={() => setSectionTab('vehicles')}
            >
              Vehicle Watchlist (ANPR)
            </button>
          </div>
        </div>
      </section>

      {sectionTab === 'vehicles' ? (
        <VehicleWatchlist workspaceId={workspaceId} role={role} platformAdmin={platformAdmin} />
      ) : (
        <section className="lv-card" aria-label="People Watchlist Management">
          {error && <p role="alert" style={{ color: '#ff8b89' }}>{error}</p>}
          {notice && <p role="status" className="lv-notice">{notice}</p>}

          {canWrite && (
            <details open style={{ marginBottom: '1.1rem' }}>
              <summary style={{ cursor: 'pointer', color: '#76efd6', fontWeight: 700, marginBottom: '0.65rem' }}>
                + Add Person to Watchlist
              </summary>
              <form
                onSubmit={(e) => void addPersonToWatchlist(e)}
                className="lv-card"
                style={{ background: '#0b121a', border: '1px solid #223244', marginBlock: 0 }}
              >
                <div className="lv-form-grid">
                  <label>
                    Full name
                    <input name="full_name" required minLength={2} maxLength={140} placeholder="e.g. Bala Musa" disabled={busy} />
                  </label>
                  <label>
                    Aliases (optional)
                    <input name="aliases" maxLength={200} placeholder="e.g. Scorpion" disabled={busy} />
                  </label>
                  <label>
                    Watchlist category
                    <select name="category" defaultValue="wanted" disabled={busy}>
                      <option value="wanted">Wanted Subject</option>
                      <option value="suspect">Active Suspect</option>
                      <option value="person_of_interest">Person of Interest</option>
                      <option value="missing">Missing Person</option>
                    </select>
                  </label>
                  <label>
                    Threat level
                    <select name="threat_level" defaultValue="high" disabled={busy}>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                  <label>
                    Warrant / BOLO reference
                    <input name="warrant_reference" maxLength={120} placeholder="e.g. WR-2026-109" disabled={busy} />
                  </label>
                  <label>
                    Case reference
                    <input name="case_reference" maxLength={120} placeholder="e.g. INV-2026-044" disabled={busy} />
                  </label>
                  <label>
                    Last seen location / City
                    <input name="last_known_location" maxLength={200} placeholder="e.g. Apapa Wharf, Lagos" disabled={busy} />
                  </label>
                  <label>
                    Reference photograph (optional, indexes on FaceDB)
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy}
                      onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>

                {photoPreviewUrl && (
                  <div style={{ marginBlock: '0.5rem' }}>
                    <img
                      src={photoPreviewUrl}
                      alt="Watchlist person preview"
                      style={{ width: '88px', height: '96px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #76efd6' }}
                    />
                  </div>
                )}

                <label>
                  Offense / Reason for watchlisting
                  <textarea
                    name="offense_summary"
                    rows={2}
                    maxLength={1500}
                    placeholder="Reason individual is watchlisted, armed status, patrol instructions..."
                    disabled={busy}
                  />
                </label>

                <LocationPicker value={personPos} onChange={setPersonPos} disabled={busy} />

                <button type="submit" disabled={busy} style={{ marginTop: '0.6rem' }}>
                  {busy ? 'Adding person & indexing…' : 'Add Person to Watchlist'}
                </button>
              </form>
            </details>
          )}

          <h3>Active People Watchlist{loading ? '' : ` (${filtered.length})`}</h3>
          <div className="lv-observation-filters" style={{ marginBottom: '0.85rem' }}>
            <label>
              Search name, alias, code, warrant, or offense
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter people watchlist..." />
            </label>
            <label>
              Category
              <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                <option value="all">All categories</option>
                <option value="wanted">Wanted</option>
                <option value="suspect">Suspect</option>
                <option value="person_of_interest">Person of interest</option>
                <option value="missing">Missing</option>
              </select>
            </label>
            <label>
              Threat
              <select value={threatFilter} onChange={(e) => setThreatFilter(e.target.value)}>
                <option value="all">All threat levels</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>

          {loading ? (
            <p className="lv-notice">Fetching watchlisted individuals…</p>
          ) : paged.length === 0 ? (
            <p>No active watchlisted individuals match this filter.</p>
          ) : (
            <>
              {paged.map((p) => {
                const coords = parseSubjectLocation(p.last_known_location, p.latitude, p.longitude);
                const cleanLoc = stripLocationCoords(p.last_known_location);
                return (
                  <article
                    key={p.id}
                    style={{
                      borderRadius: '8px',
                      border: '1px solid #223244',
                      borderLeft: `4px solid ${p.threat_level === 'critical' || p.threat_level === 'high' ? '#ef4444' : '#f59e0b'}`,
                      background: '#0b121a',
                      padding: '0.85rem',
                      marginTop: '0.65rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start', flex: 1 }}>
                        {photoUrls[p.id] && (
                          <img
                            src={photoUrls[p.id]}
                            alt={`Watchlist person ${p.full_name}`}
                            style={{ width: '78px', height: '88px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #354858' }}
                          />
                        )}
                        <div>
                          <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <h4 style={{ margin: 0 }}>{p.full_name}</h4>
                            {p.subject_code && <span className="lv-badge">{p.subject_code}</span>}
                            <span className={`lunar-badge ${p.threat_level === 'critical' || p.threat_level === 'high' ? 'high' : 'medium'}`}>
                              {p.threat_level}
                            </span>
                            <span className="lv-badge">{p.category.replace(/_/g, ' ')}</span>
                            <span className="lv-badge">{p.face_indexed ? 'FaceDB Indexed' : 'Visual Dossier'}</span>
                          </div>
                          {p.aliases && <small>Aliases: {p.aliases}</small>}
                          {p.offense_summary && <p style={{ margin: '0.3rem 0' }}>{p.offense_summary}</p>}
                          <small style={{ color: '#94a3b8' }}>
                            {p.warrant_reference && <>Warrant: <strong>{p.warrant_reference}</strong> · </>}
                            {p.case_reference && <>Case: <strong>{p.case_reference}</strong> · </>}
                            {cleanLoc && <>Last seen: {cleanLoc} · </>}
                            {coords.latitude !== null && coords.longitude !== null && (
                              <>GPS {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)} · </>
                            )}
                            Added {new Date(p.created_at).toLocaleDateString()}
                          </small>
                        </div>
                      </div>
                      <div className="lv-video-actions">
                        <button type="button" className="lv-secondary" disabled={busy} onClick={() => void triggerPersonBoloAlert(p)}>
                          Dispatch BOLO alert
                        </button>
                        {canArchive && (
                          <button type="button" className="lv-secondary" disabled={busy} onClick={() => void archivePerson(p)}>
                            Archive
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="lv-secondary"
                            style={{ borderColor: '#ef4444', color: '#ff8b89' }}
                            disabled={busy}
                            onClick={() => void deletePerson(p)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}

              {filtered.length > PEOPLE_PAGE_SIZE && (
                <div className="lv-video-actions" style={{ marginTop: '0.9rem', justifyContent: 'space-between' }}>
                  <button type="button" className="lv-secondary" disabled={safePage === 0} onClick={() => setPage((pg) => Math.max(0, pg - 1))}>
                    Previous
                  </button>
                  <small style={{ color: '#94a3b8' }}>
                    Page {safePage + 1} of {totalPages} · Showing {safePage * PEOPLE_PAGE_SIZE + 1}–
                    {Math.min((safePage + 1) * PEOPLE_PAGE_SIZE, filtered.length)} of {filtered.length} watchlisted people
                  </small>
                  <button type="button" className="lv-secondary" disabled={safePage + 1 >= totalPages} onClick={() => setPage((pg) => pg + 1)}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

