import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { compressImage } from '../utils/imageCompression';
import { dispatchOperationalAlert, emitLiveAlert } from '../services/liveAlertBus';
import VehicleImageRecognition from './VehicleImageRecognition';
import {
  WatchlistImportRowInput,
  isValidNormalizedPlate,
  normalizePlate,
  parseWatchlistImportFile,
  roleCan,
  triggerCsvDownload,
} from '../services/videoIntelligence';

export type WatchlistReason = 'stolen' | 'wanted' | 'interest' | 'authorized' | 'other' | 'watchlist';
export type WatchlistStatus = 'active' | 'inactive' | 'resolved';

export type WatchlistEntry = {
  id: string;
  plate: string;
  reason: WatchlistReason;
  case_reference: string;
  make: string;
  model: string;
  colour: string;
  photo_path: string | null;
  description: string;
  notes: string;
  status: WatchlistStatus;
  custom_category: string;
  revision: number;
  created_at: string;
  created_by_label: string;
  updated_at: string;
  updated_by_label: string;
  retired_at: string | null;
};

const columns =
  'id,plate,reason,case_reference,make,model,colour,photo_path,description,notes,status,custom_category,revision,created_at,created_by_label,updated_at,updated_by_label,retired_at';

const REASON_LABELS: Record<WatchlistReason, string> = {
  stolen: 'Stolen vehicle',
  wanted: 'Wanted / flagged vehicle',
  interest: 'Vehicle of interest',
  authorized: 'Authorized / approved vehicle',
  other: 'Custom category',
  watchlist: 'Agency watchlist',
};

const STATUS_LABELS: Record<WatchlistStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  resolved: 'Resolved',
};

function formatReason(entry: Pick<WatchlistEntry, 'reason' | 'custom_category'>): string {
  if (entry.reason === 'other' && entry.custom_category?.trim()) {
    return entry.custom_category.trim();
  }
  return REASON_LABELS[entry.reason] || entry.reason;
}

function normalizeAndValidatePlate(value: string): string {
  const plate = normalizePlate(value);
  if (!isValidNormalizedPlate(plate)) {
    throw new Error('Enter 2–12 plate letters or digits. Spaces and hyphens are normalized automatically.');
  }
  return plate;
}

export function PlateWatchlistCheck({
  workspaceId,
  initialPlate = '',
}: {
  workspaceId: string;
  initialPlate?: string;
}) {
  const [plate, setPlate] = useState(initialPlate);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState('');

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult('');
    try {
      const confirmedPlate = normalizeAndValidatePlate(plate);
      const [watchRes, regRes] = await Promise.all([
        supabase
          .from('lv_vehicle_watchlist')
          .select(columns)
          .eq('workspace_id', workspaceId)
          .eq('plate', confirmedPlate)
          .is('retired_at', null)
          .maybeSingle(),
        supabase
          .from('lv_vehicle_registry')
          .select('plate,make,model,colour,vehicle_type,registration_status')
          .eq('workspace_id', workspaceId)
          .eq('plate', confirmedPlate)
          .maybeSingle(),
      ]);
      if (watchRes.error) throw new Error('The agency watchlist could not be checked.');
      const match = watchRes.data as WatchlistEntry | null;
      const reg = regRes.data as {
        plate: string;
        make: string;
        model: string;
        colour: string;
        vehicle_type: string;
        registration_status: string;
      } | null;

      const regNote = reg
        ? ` Registry record: ${[reg.colour, reg.make, reg.model, reg.vehicle_type].filter(Boolean).join(' ') || 'Listed'} (${reg.registration_status}).`
        : '';

      if (match) {
        const vehDesc = [match.colour, match.make, match.model].filter(Boolean).join(' ');
        const msg = `MATCH: ${confirmedPlate} · ${formatReason(match)} (${STATUS_LABELS[match.status] || match.status}) · Case ${match.case_reference}${vehDesc ? ` · ${vehDesc}` : ''}.${match.description ? ` ${match.description}` : ''}${regNote}`;
        setResult(msg);
        if (match.reason !== 'authorized') {
          await dispatchOperationalAlert({
            workspaceId,
            kind: 'watchlist_match',
            title: `Watchlist Match: ${confirmedPlate} (${formatReason(match)})`,
            details: msg,
            severity: match.reason === 'stolen' || match.reason === 'wanted' ? 'high' : 'medium',
            plate: confirmedPlate,
            cameraName: 'Manual Plate Watchlist Check',
            recommendedAction: `Verify Case ${match.case_reference} and notify responding patrol unit.`,
            dedupeKey: `manual-wl:${workspaceId}:${confirmedPlate}`,
          });
        }
      } else {
        setResult(`No active watchlist entry for ${confirmedPlate}.${regNote}`);
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'The agency watchlist could not be checked.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={check}>
      <label>
        Verify plate against watchlist &amp; registry
        <input
          value={plate}
          onChange={(event) => {
            setPlate(event.target.value);
            setResult('');
          }}
          placeholder="e.g. ABC-123-XY or lag 123aa"
          required
          maxLength={20}
          disabled={pending}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'Checking…' : 'Check agency watchlist'}
      </button>
      {result && <p role="status">{result}</p>}
    </form>
  );
}

async function uploadVehiclePhoto(workspaceId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Select a valid JPEG, PNG, or WebP vehicle photograph.');
  }
  const blob =
    (file.type === 'image/jpeg' || file.type === 'image/png') && file.size <= 1_200_000
      ? file
      : await compressImage(file, 900, 0.85);
  const path = `${workspaceId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('lv-vehicle-photos').upload(path, blob, {
    contentType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
    upsert: false,
  });
  if (error) {
    throw new Error('Vehicle photograph could not be uploaded.');
  }
  return path;
}

export default function VehicleWatchlist({
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

  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('active_only');

  // Create form controlled states for category + file
  const [newReason, setNewReason] = useState<WatchlistReason>('stolen');
  const [newPhotoFile, setNewPhotoFile] = useState<File | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [draftPlate, setDraftPlate] = useState('');
  const [draftColour, setDraftColour] = useState('');

  // Editing state
  const [editing, setEditing] = useState<WatchlistEntry | null>(null);
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);

  // Bulk migration state
  const [migRows, setMigRows] = useState<WatchlistImportRowInput[] | null>(null);
  const [migFileName, setMigFileName] = useState('');
  const [migSourceName, setMigSourceName] = useState('Agency Legacy Hotlist');
  const [migPhotoMap, setMigPhotoMap] = useState<Map<string, File>>(new Map());
  const [migUpdateExisting, setMigUpdateExisting] = useState(true);
  const [migProgress, setMigProgress] = useState<{ done: number; total: number } | null>(null);
  const [migReport, setMigReport] = useState<{
    total: number;
    inserted: number;
    updated: number;
    duplicates: number;
    invalid: number;
    photosUploaded: number;
    errors: { row: number; plate: string; error: string }[];
  } | null>(null);
  const migCancelRef = useRef(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    let req = supabase
      .from('lv_vehicle_watchlist')
      .select(columns)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (statusFilter === 'archived') {
      req = req.not('retired_at', 'is', null);
    } else if (statusFilter === 'active_only') {
      req = req.is('retired_at', null);
    }

    void req.then(async ({ data, error }) => {
      if (!current) return;
      if (error) {
        setEntries([]);
        setNotice('Watchlist entries could not be loaded.');
        setLoading(false);
        return;
      }
      const list = (data ?? []) as WatchlistEntry[];
      setEntries(list);
      setLoading(false);

      // Sign URLs for entries with photos
      const withPhotos = list.filter((item) => item.photo_path);
      if (withPhotos.length > 0) {
        const nextUrls: Record<string, string> = {};
        await Promise.all(
          withPhotos.slice(0, 40).map(async (item) => {
            if (!item.photo_path) return;
            const { data: signed } = await supabase.storage
              .from('lv-vehicle-photos')
              .createSignedUrl(item.photo_path, 600);
            if (signed?.signedUrl) nextUrls[item.id] = signed.signedUrl;
          }),
        );
        if (current) setPhotoUrls(nextUrls);
      }
    });
    return () => {
      current = false;
    };
  }, [workspaceId, statusFilter, refresh]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setNotice('');
    let uploadedPath: string | null = null;
    try {
      const normalizedPlate = normalizeAndValidatePlate(String(fields.get('plate')));
      const reason = String(fields.get('reason')) as WatchlistReason;
      const customCategory = reason === 'other' ? String(fields.get('custom_category') || '').trim() : '';
      if (reason === 'other' && !customCategory) {
        throw new Error('Specify a custom category label.');
      }

      if (newPhotoFile) {
        uploadedPath = await uploadVehiclePhoto(workspaceId, newPhotoFile);
      }

      const { error } = await supabase.from('lv_vehicle_watchlist').insert({
        workspace_id: workspaceId,
        plate: normalizedPlate,
        reason,
        case_reference: String(fields.get('case')).trim(),
        make: String(fields.get('make') || '').trim(),
        model: String(fields.get('model') || '').trim(),
        colour: String(fields.get('colour') || '').trim(),
        photo_path: uploadedPath,
        description: String(fields.get('description') || '').trim(),
        notes: String(fields.get('notes') || '').trim(),
        status: String(fields.get('status') || 'active') as WatchlistStatus,
        custom_category: customCategory,
      });
      if (error) {
        if (uploadedPath) {
          await supabase.storage.from('lv-vehicle-photos').remove([uploadedPath]).catch(() => {});
        }
        throw new Error(error.code === '23505' ? 'This plate already has an active entry.' : error.message);
      }
      form.reset();
      setNewPhotoFile(null);
      setDraftPlate('');
      setDraftColour('');
      setNewReason('stolen');
      setRefresh((previous) => previous + 1);
      setNotice(`Watchlist entry added for plate ${normalizedPlate}.`);

      // Check if this newly flagged plate was already spotted in recent ANPR events -> trigger popup alert!
      try {
        const { data: recentHit } = await supabase
          .from('lv_intel_events')
          .select('id,camera_id,occurred_at,confidence')
          .eq('workspace_id', workspaceId)
          .eq('category', 'plate_read')
          .eq('plate', normalizedPlate)
          .order('occurred_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recentHit && reason !== 'authorized') {
          await dispatchOperationalAlert({
            workspaceId,
            kind: 'watchlist_match',
            title: `Watchlist Match Found: ${normalizedPlate} (${formatReason({ reason, custom_category: customCategory })})`,
            details: `Newly watchlisted plate ${normalizedPlate} matches a recorded sighting at ${new Date(recentHit.occurred_at).toLocaleString()} (Case ${String(fields.get('case')).trim()}).`,
            severity: reason === 'stolen' || reason === 'wanted' ? 'high' : 'medium',
            cameraId: recentHit.camera_id ?? null,
            cameraName: 'Recent ANPR / Camera Sighting',
            plate: normalizedPlate,
            eventId: recentHit.id,
            recommendedAction: 'Inspect historical sighting event and dispatch field response.',
            dedupeKey: `retro-wl:${workspaceId}:${normalizedPlate}`,
          });
        } else {
          emitLiveAlert({
            workspaceId,
            kind: 'watchlist_match',
            title: `Watchlist Alert Armed: ${normalizedPlate}`,
            details: `${formatReason({ reason, custom_category: customCategory })} · Case ${String(fields.get('case')).trim()}. Real-time popup alerts will fire whenever cameras or image scans detect ${normalizedPlate}.`,
            severity: reason === 'stolen' || reason === 'wanted' ? 'high' : 'medium',
            plate: normalizedPlate,
            cameraName: 'Vehicle Watchlist Desk',
            dedupeKey: `armed-wl:${workspaceId}:${normalizedPlate}`,
          });
        }
      } catch {
        // Non-fatal alert dispatch check
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The entry could not be added.');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !canWrite) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setNotice('');
    let nextPhotoPath = editing.photo_path;
    let newlyUploaded: string | null = null;
    try {
      const newReasonVal = String(fields.get('reason')) as WatchlistReason;
      const newCustomCat = newReasonVal === 'other' ? String(fields.get('custom_category') || '').trim() : '';
      if (newReasonVal === 'other' && !newCustomCat) {
        throw new Error('Specify a custom category label.');
      }
      if (editPhotoFile) {
        newlyUploaded = await uploadVehiclePhoto(workspaceId, editPhotoFile);
        nextPhotoPath = newlyUploaded;
      }
      const { error } = await supabase.rpc('lv_update_vehicle_watch', {
        target_id: editing.id,
        expected_revision: editing.revision,
        new_reason: newReasonVal,
        new_case_reference: String(fields.get('case_reference')).trim(),
        new_make: String(fields.get('make') || '').trim(),
        new_model: String(fields.get('model') || '').trim(),
        new_colour: String(fields.get('colour') || '').trim(),
        new_photo_path: nextPhotoPath,
        new_description: String(fields.get('description') || '').trim(),
        new_notes: String(fields.get('notes') || '').trim(),
        new_status: String(fields.get('status') || 'active'),
        new_custom_category: newCustomCat,
      });
      if (error) {
        if (newlyUploaded) {
          await supabase.storage.from('lv-vehicle-photos').remove([newlyUploaded]).catch(() => {});
        }
        throw new Error(error.message);
      }
      setEditing(null);
      setEditPhotoFile(null);
      setRefresh((previous) => previous + 1);
      setNotice(`Updated watchlist record for ${editing.plate}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The watchlist record could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  async function archiveEntry(id: string, plate: string) {
    if (!canArchive) return;
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase.rpc('lv_retire_vehicle_watch', { target_id: id });
      setNotice(error ? error.message : `Archived watchlist entry ${plate}.`);
      setRefresh((previous) => previous + 1);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(id: string, plate: string, photoPath: string | null) {
    if (!canDelete) return;
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase.rpc('lv_delete_vehicle_watch', { target_id: id });
      if (error) {
        setNotice(error.message);
      } else {
        if (photoPath) {
          await supabase.storage.from('lv-vehicle-photos').remove([photoPath]).catch(() => {});
        }
        setNotice(`Permanently removed watchlist entry ${plate}.`);
        setRefresh((previous) => previous + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  const filteredEntries = entries.filter((entry) => {
    const q = normalizePlate(search);
    const rawQ = search.trim().toLowerCase();
    const matchesSearch =
      !rawQ ||
      entry.plate.includes(q) ||
      entry.case_reference.toLowerCase().includes(rawQ) ||
      `${entry.make} ${entry.model} ${entry.colour} ${entry.description}`.toLowerCase().includes(rawQ);
    const matchesReason = reasonFilter === 'all' || entry.reason === reasonFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      statusFilter === 'active_only' ||
      statusFilter === 'archived' ||
      entry.status === statusFilter;
    return matchesSearch && matchesReason && matchesStatus;
  });

  function indexVehiclePhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const map = new Map(migPhotoMap);
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      map.set(f.name.toLowerCase(), f);
      const base = f.name.replace(/\.[^.]+$/, '');
      const norm = normalizePlate(base);
      if (norm) map.set(`plate:${norm}`, f);
    }
    setMigPhotoMap(map);
    setNotice(`Indexed ${map.size} photo keys from selected vehicle pictures.`);
  }

  async function handleMigrationFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setMigRows(null);
    setMigReport(null);
    if (!file) return;
    try {
      const parsed = await parseWatchlistImportFile(file);
      if (parsed.length === 0) {
        setNotice('No valid watchlist rows found in file. Ensure column headers include plate, category, case_reference.');
        return;
      }
      setMigFileName(file.name);
      setMigRows(parsed);
      setNotice(`Parsed ${parsed.length} watchlist plates from "${file.name}". Ready to migrate.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Watchlist migration file could not be read.');
    }
  }

  async function runWatchlistMigration(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || !migRows || migRows.length === 0) return;
    setBusy(true);
    setMigReport(null);
    migCancelRef.current = false;
    setMigProgress({ done: 0, total: migRows.length });
    setNotice('');

    let inserted = 0;
    let updated = 0;
    let duplicates = 0;
    let invalid = 0;
    let photosUploaded = 0;
    const allErrors: { row: number; plate: string; error: string }[] = [];

    try {
      const enriched: any[] = [];
      for (let i = 0; i < migRows.length; i++) {
        if (migCancelRef.current) break;
        const r = migRows[i];
        const normPlate = normalizePlate(r.plate);
        const matchedFile =
          (r.photo_filename ? migPhotoMap.get(r.photo_filename.toLowerCase()) : undefined) ||
          (normPlate ? migPhotoMap.get(`plate:${normPlate}`) : undefined);
        let photo_path: string | undefined;
        if (matchedFile) {
          try {
            photo_path = await uploadVehiclePhoto(workspaceId, matchedFile);
            photosUploaded++;
          } catch {
            // Continue migrating data row even if individual photo fails
          }
        }
        enriched.push({ ...r, ...(photo_path ? { photo_path } : {}) });
        if ((i + 1) % 10 === 0 || i + 1 === migRows.length) {
          setMigProgress({ done: Math.round(((i + 1) / migRows.length) * migRows.length * 0.4), total: migRows.length });
        }
      }

      const chunkSize = 500;
      for (let i = 0; i < enriched.length; i += chunkSize) {
        if (migCancelRef.current) break;
        const chunk = enriched.slice(i, i + chunkSize);
        const { data, error: rpcErr } = await supabase.rpc('lv_import_watchlist', {
          target: workspaceId,
          source_name: migSourceName.trim() || 'Bulk Watchlist Migration',
          file_name: migFileName || 'watchlist.csv',
          entries: chunk,
          update_existing: migUpdateExisting,
        });
        if (rpcErr) throw new Error(rpcErr.message);
        const res = data as any;
        inserted += Number(res.inserted || 0);
        updated += Number(res.updated || 0);
        duplicates += Number(res.duplicates || 0);
        invalid += Number(res.invalid || 0);
        if (Array.isArray(res.errors)) {
          for (const er of res.errors) {
            if (allErrors.length < 200) {
              allErrors.push({ row: Number(er.row || 0) + i, plate: String(er.plate || ''), error: String(er.error || 'Error') });
            }
          }
        }
        setMigProgress({ done: Math.min(migRows.length, i + chunk.length), total: migRows.length });
      }

      setMigReport({
        total: migRows.length,
        inserted,
        updated,
        duplicates,
        invalid,
        photosUploaded,
        errors: allErrors,
      });
      setNotice(
        migCancelRef.current
          ? `Migration paused/cancelled after partial run: ${inserted} inserted, ${updated} updated.`
          : `Watchlist migration complete: ${inserted} inserted, ${updated} updated, ${photosUploaded} photos linked, ${duplicates} skipped, ${invalid} invalid.`,
      );
      setRefresh((r) => r + 1);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Watchlist migration failed.');
    } finally {
      setBusy(false);
      setMigProgress(null);
    }
  }

  return (
    <section className="lv-card" aria-label="Vehicle watchlist management">
      <h2>Vehicle Watchlist &amp; ANPR Alerts</h2>
      <p>
        Manage vehicles of interest tied to investigations. When ANPR detects a registration number on any connected
        camera, normalized plates are matched automatically against active watchlist entries in the background to trigger
        immediate security alerts.
      </p>

      <PlateWatchlistCheck workspaceId={workspaceId} />

      <VehicleImageRecognition
        workspaceId={workspaceId}
        onPrefillWatchlistPlate={
          canWrite
            ? (plate, info) => {
                setDraftPlate(plate);
                if (info.colour && info.colour !== 'Unknown colour') setDraftColour(info.colour);
                setManualOpen(true);
              }
            : undefined
        }
      />

      {canWrite ? (
        <details style={{ marginTop: '1rem' }} open={manualOpen} onToggle={(e) => setManualOpen(e.currentTarget.open)}>
          <summary style={{ cursor: 'pointer', color: '#76efd6', fontWeight: 600 }}>
            + Register vehicle of interest manually
          </summary>
          <form onSubmit={add} className="lv-form-grid">
            <label>
              Number plate
              <input
                name="plate"
                maxLength={20}
                value={draftPlate}
                onChange={(e) => setDraftPlate(e.target.value)}
                placeholder="e.g. KJA-492-AX"
                required
              />
            </label>
            <label>
              Category
              <select
                name="reason"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value as WatchlistReason)}
              >
                <option value="stolen">Stolen vehicle</option>
                <option value="wanted">Wanted / flagged vehicle</option>
                <option value="interest">Vehicle of interest</option>
                <option value="authorized">Authorized / approved vehicle</option>
                <option value="other">Other (custom category)</option>
              </select>
            </label>
            {newReason === 'other' && (
              <label>
                Custom category label
                <input name="custom_category" maxLength={60} placeholder="e.g. Diplomatic convoy" required />
              </label>
            )}
            <label>
              Watchlist status
              <select name="status" defaultValue="active">
                <option value="active">Active (generate real-time alerts)</option>
                <option value="inactive">Inactive</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label>
              Reference / Case number
              <input name="case" maxLength={120} placeholder="e.g. CR-2026-0419" required />
            </label>
            <label>
              Make
              <input name="make" maxLength={60} placeholder="e.g. Toyota" />
            </label>
            <label>
              Model
              <input name="model" maxLength={60} placeholder="e.g. Hilux" />
            </label>
            <label>
              Colour
              <input
                name="colour"
                maxLength={60}
                value={draftColour}
                onChange={(e) => setDraftColour(e.target.value)}
                placeholder="e.g. Silver"
              />
            </label>
            <label>
              Vehicle photograph (optional, private encrypted storage)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setNewPhotoFile(e.target.files?.[0] || null)}
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Incident description
              <textarea
                name="description"
                maxLength={2000}
                rows={2}
                placeholder="Reason the vehicle is flagged, last seen area, distinguishing marks..."
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Investigation notes
              <textarea
                name="notes"
                maxLength={4000}
                rows={2}
                placeholder="Instructions for patrol units / responding officers..."
              />
            </label>
            <div>
              <button type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Add watchlist entry'}
              </button>
            </div>
          </form>
        </details>
      ) : null}

      {canWrite && (
        <details style={{ marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: '#76efd6', fontWeight: 600 }}>
            + Bulk Migrate Plate Watchlist &amp; Vehicle Photos (CSV / Excel + Photo Folder)
          </summary>
          <div className="lv-card" style={{ marginTop: '0.75rem', background: '#0c131b' }}>
            <p>
              Migrate large hotlists from CSV or Excel (`.xlsx`) with columns: `plate`, `category` (`stolen`, `wanted`,
              `interest`, `authorized`, `other`), `case_reference`, `make`, `model`, `colour`, `status`,
              `description`, `notes`, `photo_filename`. Attach vehicle photographs named by plate (e.g. `LAG123AA.jpg`)
              or matching `photo_filename`.
            </p>
            <div className="lv-video-actions">
              <button
                type="button"
                className="lv-secondary"
                onClick={() =>
                  triggerCsvDownload(
                    ['plate', 'category', 'case_reference', 'make', 'model', 'colour', 'status', 'description', 'notes', 'photo_filename'],
                    [
                      ['LAG-123-AA', 'stolen', 'CR-2026-101', 'Toyota', 'Hilux', 'White', 'active', 'Reported snatched at checkpoint', 'Dispatch tactical team', 'LAG123AA.jpg'],
                      ['ABJ-901-KL', 'wanted', 'CR-2026-205', 'Mercedes-Benz', 'GLK350', 'Black', 'active', 'Getaway vehicle', 'Observe and report', ''],
                    ],
                    'lunavision_watchlist_migration_template.csv',
                  )
                }
              >
                Download watchlist CSV template
              </button>
            </div>
            <form onSubmit={runWatchlistMigration}>
              <label>
                Migration data source label
                <input value={migSourceName} onChange={(e) => setMigSourceName(e.target.value)} maxLength={120} required />
              </label>
              <label>
                1. Watchlist CSV or Excel file (`.csv`, `.xlsx`)
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => void handleMigrationFile(e)}
                />
              </label>
              <label>
                2. Match vehicle photographs (multi-select images, optional)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => indexVehiclePhotos(e.target.files)}
                />
              </label>
              <label className="lv-auto-observations">
                <input
                  type="checkbox"
                  checked={migUpdateExisting}
                  onChange={(e) => setMigUpdateExisting(e.target.checked)}
                />
                <span>Update existing active watchlist plates if matched</span>
              </label>
              {migRows && (
                <p>
                  Parsed <strong>{migRows.length}</strong> plates · Matched photo dictionary keys:{' '}
                  <strong>{migPhotoMap.size}</strong>
                </p>
              )}
              {migProgress && (
                <div style={{ marginBlock: '0.5rem' }}>
                  <progress value={migProgress.done} max={migProgress.total} style={{ width: '100%' }} />
                  <small>
                    Migrating {migProgress.done} / {migProgress.total} records…
                  </small>
                </div>
              )}
              <div className="lv-video-actions">
                <button type="submit" disabled={busy || !migRows}>
                  {busy ? 'Migrating watchlist...' : 'Run watchlist migration'}
                </button>
                {busy && migProgress && (
                  <button
                    type="button"
                    className="lv-secondary"
                    onClick={() => {
                      migCancelRef.current = true;
                    }}
                  >
                    Stop migration
                  </button>
                )}
              </div>
            </form>
            {migReport && (
              <div className="lv-card" style={{ marginTop: '0.75rem' }}>
                <h4>Watchlist Migration Summary</h4>
                <p>
                  Inserted: {migReport.inserted} · Updated: {migReport.updated} · Photos linked:{' '}
                  {migReport.photosUploaded} · Skipped/Dup: {migReport.duplicates} · Invalid: {migReport.invalid}
                </p>
                {migReport.errors.length > 0 && (
                  <button
                    type="button"
                    className="lv-secondary"
                    onClick={() =>
                      triggerCsvDownload(
                        ['row', 'plate', 'error'],
                        migReport.errors.map((er) => [er.row, er.plate, er.error]),
                        'watchlist_migration_errors.csv',
                      )
                    }
                  >
                    Download row errors CSV ({migReport.errors.length})
                  </button>
                )}
              </div>
            )}
          </div>
        </details>
      )}

      {!canWrite && (
        <p className="lv-notice" style={{ marginTop: '0.75rem' }}>
          Read-only watchlist access: Only Investigators, Supervisors, Admins, or Owners can add or modify watchlist records.
        </p>
      )}

      {notice && (
        <p role="status" className="lv-notice" style={{ marginTop: '0.75rem' }}>
          {notice}
        </p>
      )}

      {/* Search & Filter bar */}
      <div className="lv-observation-filters" style={{ marginTop: '1rem' }}>
        <label>
          Search plate, case ref, make/model, or description
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter watchlist entries..."
          />
        </label>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label style={{ flex: 1, minWidth: '140px' }}>
            Category
            <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}>
              <option value="all">All categories</option>
              <option value="stolen">Stolen vehicles</option>
              <option value="wanted">Wanted / flagged</option>
              <option value="interest">Vehicles of interest</option>
              <option value="authorized">Authorized vehicles</option>
              <option value="other">Custom categories</option>
            </select>
          </label>
          <label style={{ flex: 1, minWidth: '140px' }}>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="active_only">All non-archived</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="resolved">Resolved</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>
      </div>

      {/* Edit Modal / Inline Form */}
      {editing && (
        <div
          className="lv-card"
          style={{ border: '1px solid #76efd6', background: '#172633', marginTop: '1rem' }}
          role="region"
          aria-label={`Edit watchlist record ${editing.plate}`}
        >
          <div className="lv-card-top">
            <h3>Editing watchlist plate: {editing.plate}</h3>
            <button type="button" className="lv-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          <form onSubmit={saveEdit} className="lv-form-grid">
            <label>
              Category
              <select
                name="reason"
                value={editing.reason}
                onChange={(e) =>
                  setEditing((prev) => (prev ? { ...prev, reason: e.target.value as WatchlistReason } : prev))
                }
              >
                <option value="stolen">Stolen vehicle</option>
                <option value="wanted">Wanted / flagged vehicle</option>
                <option value="interest">Vehicle of interest</option>
                <option value="authorized">Authorized / approved vehicle</option>
                <option value="other">Other (custom category)</option>
              </select>
            </label>
            {editing.reason === 'other' && (
              <label>
                Custom category
                <input name="custom_category" defaultValue={editing.custom_category} maxLength={60} required />
              </label>
            )}
            <label>
              Status
              <select name="status" defaultValue={editing.status}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label>
              Case / Reference number
              <input name="case_reference" defaultValue={editing.case_reference} maxLength={120} required />
            </label>
            <label>
              Make
              <input name="make" defaultValue={editing.make} maxLength={60} />
            </label>
            <label>
              Model
              <input name="model" defaultValue={editing.model} maxLength={60} />
            </label>
            <label>
              Colour
              <input name="colour" defaultValue={editing.colour} maxLength={60} />
            </label>
            <label>
              Replace photograph (optional)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setEditPhotoFile(e.target.files?.[0] || null)}
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Incident description
              <textarea name="description" defaultValue={editing.description} maxLength={2000} rows={2} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Investigation notes
              <textarea name="notes" defaultValue={editing.notes} maxLength={4000} rows={2} />
            </label>
            <div className="lv-video-actions">
              <button type="submit" disabled={busy}>
                {busy ? 'Saving changes...' : 'Save changes'}
              </button>
              <button type="button" className="lv-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p>Loading watchlist entries…</p>
      ) : filteredEntries.length === 0 ? (
        <p>No watchlist entries match the current filter.</p>
      ) : (
        <div style={{ marginTop: '0.75rem' }}>
          <h3>Watchlist records ({filteredEntries.length})</h3>
          {filteredEntries.map((entry) => {
            const vehicleSummary = [entry.colour, entry.make, entry.model].filter(Boolean).join(' ');
            const isArchived = Boolean(entry.retired_at);
            return (
              <article key={entry.id}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                    {photoUrls[entry.id] && (
                      <img
                        src={photoUrls[entry.id]}
                        alt={`Registered vehicle ${entry.plate}`}
                        style={{
                          width: '96px',
                          height: '68px',
                          objectFit: 'cover',
                          borderRadius: '6px',
                          border: '1px solid #354858',
                        }}
                      />
                    )}
                    <div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0 }}>{entry.plate}</h3>
                        <span className="lv-badge">{formatReason(entry)}</span>
                        <span className="lv-badge">
                          {isArchived ? 'ARCHIVED' : STATUS_LABELS[entry.status] || entry.status}
                        </span>
                      </div>
                      <p style={{ margin: '0.3rem 0' }}>
                        Case Ref: <strong>{entry.case_reference}</strong>
                        {vehicleSummary ? ` · ${vehicleSummary}` : ''}
                      </p>
                      {entry.description && <p style={{ margin: '0.25rem 0' }}>{entry.description}</p>}
                      {entry.notes && (
                        <p style={{ margin: '0.25rem 0' }}>
                          <small>Investigation notes: {entry.notes}</small>
                        </p>
                      )}
                      <small>
                        Added {new Date(entry.created_at).toLocaleString()}
                        {entry.created_by_label ? ` by ${entry.created_by_label}` : ''}
                        {entry.updated_by_label ? ` · Last updated by ${entry.updated_by_label}` : ''}
                      </small>
                    </div>
                  </div>
                  {!isArchived && (
                    <div className="lv-video-actions">
                      {canWrite && (
                        <button
                          type="button"
                          className="lv-secondary"
                          disabled={busy}
                          onClick={() => {
                            setEditing(entry);
                            setEditPhotoFile(null);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {canArchive && (
                        <button
                          type="button"
                          className="lv-secondary"
                          disabled={busy}
                          onClick={() => void archiveEntry(entry.id, entry.plate)}
                        >
                          Archive
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          className="lv-secondary"
                          style={{ borderColor: '#ef4444', color: '#ff8b89' }}
                          disabled={busy}
                          onClick={() => void deleteEntry(entry.id, entry.plate, entry.photo_path)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
