import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { compressImage } from '../utils/imageCompression';
import {
  SubjectMigrationRowInput,
  parseSubjectMigrationFile,
  roleCan,
  triggerCsvDownload,
} from '../services/videoIntelligence';

type SubjectCategory = 'wanted' | 'suspect' | 'person_of_interest' | 'missing' | 'authorized' | 'other';
type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';
type SubjectStatus = 'active' | 'resolved' | 'archived';

interface AgencySubject {
  id: string;
  subject_code: string | null;
  full_name: string;
  aliases: string;
  date_of_birth: string;
  gender: string;
  nationality: string;
  category: SubjectCategory;
  threat_level: ThreatLevel;
  offense_summary: string;
  warrant_reference: string;
  case_reference: string;
  national_id: string;
  last_known_location: string;
  physical_marks: string;
  notes: string;
  status: SubjectStatus;
  minimum_clearance: number;
  primary_photo_path: string | null;
  face_token: string | null;
  face_indexed: boolean;
  source_name: string;
  created_at: string;
  created_by_label: string;
}

interface MigrationJobRow {
  id: string;
  source_name: string;
  file_name: string;
  total_records: number;
  processed_records: number;
  indexed_faces: number;
  skipped_duplicates: number;
  failed_records: number;
  status: string;
  errors: { row: number; name?: string; code?: string; error: string }[];
  created_by_label: string;
  created_at: string;
}

interface SearchHistoryRow {
  id: string;
  actor_id?: string | null;
  actor_label: string;
  search_mode: string;
  probe_snapshot_path: string | null;
  top_confidence: number | null;
  result_count: number;
  results: {
    subject_id: string;
    subject_code: string | null;
    full_name: string;
    confidence: number;
    band: string;
  }[];
  telemetry: Record<string, any>;
  case_reference: string;
  notes: string;
  created_at: string;
}

const ANGLE_OPTIONS = [
  { value: 'frontal', label: 'Frontal mugshot' },
  { value: 'left_profile', label: 'Left profile' },
  { value: 'right_profile', label: 'Right profile' },
  { value: 'surveillance_still', label: 'Surveillance / CCTV still' },
  { value: 'id_document', label: 'ID / Passport crop' },
];

async function compressPhotoForBiometrics(file: File): Promise<File> {
  if ((file.type === 'image/jpeg' || file.type === 'image/png') && file.size <= 1_200_000) {
    return file;
  }
  const blob1 = await compressImage(file, 1024, 0.88);
  const finalBlob = blob1.size <= 1_200_000 ? blob1 : await compressImage(blob1, 760, 0.75);
  const safe = file.name.replace(/\.[^.]+$/, '') || 'subject';
  return new File([finalBlob], `${safe}.jpg`, { type: 'image/jpeg' });
}

async function enrollPhotoWithProvider(
  workspaceId: string,
  accessToken: string,
  preparedPhoto: File,
): Promise<{
  face_token: string;
  faceset_outer_id: string;
  quality_score: number | null;
}> {
  const form = new FormData();
  form.set('action', 'enroll_face');
  form.set('photo', preparedPhoto);
  const res = await fetch('/api/face-intelligence', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Workspace-Id': workspaceId,
    },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.face_token) {
    throw new Error(body?.error || 'Biometric face encoding failed.');
  }
  return body;
}

function normalizeLookupKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default function SubjectEnrollmentCenter({
  workspaceId,
  role = 'member',
  platformAdmin = false,
  initialTab = 'directory',
  enrollmentEnabled = true,
  searchEnabled = true,
}: {
  workspaceId: string;
  role?: string;
  platformAdmin?: boolean;
  initialTab?: 'directory' | 'enroll' | 'migrate' | 'history';
  enrollmentEnabled?: boolean;
  searchEnabled?: boolean;
}) {
  const canWrite = roleCan(role, 'watchlist_write', platformAdmin) && enrollmentEnabled;
  const canArchive = roleCan(role, 'watchlist_archive', platformAdmin) && enrollmentEnabled;
  const canDelete = roleCan(role, 'watchlist_delete', platformAdmin) && enrollmentEnabled;

  const [tab, setTab] = useState<'directory' | 'enroll' | 'migrate' | 'history'>(initialTab);
  const [subjects, setSubjects] = useState<AgencySubject[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [migrations, setMigrations] = useState<MigrationJobRow[]>([]);
  const [history, setHistory] = useState<SearchHistoryRow[]>([]);
  const [probeUrls, setProbeUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  // Directory filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [threatFilter, setThreatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');

  // Single enrollment state (multi-angle up to 5 photos)
  const [anglePhotos, setAnglePhotos] = useState<{ file: File; angle: string }[]>([]);
  const [editingSubject, setEditingSubject] = useState<AgencySubject | null>(null);

  // Bulk migration state
  const [migSourceName, setMigSourceName] = useState('Agency Criminal Records Archive');
  const [migCsvFileName, setMigCsvFileName] = useState('');
  const [migDataRows, setMigDataRows] = useState<SubjectMigrationRowInput[] | null>(null);
  const [migPhotosByExactName, setMigPhotosByExactName] = useState<Map<string, File>>(new Map());
  const [migPhotosByNormKey, setMigPhotosByNormKey] = useState<Map<string, File>>(new Map());
  const [migAllPhotoFiles, setMigAllPhotoFiles] = useState<File[]>([]);
  const [migSkipUnmatched, setMigSkipUnmatched] = useState(false);
  const [migProgress, setMigProgress] = useState<{ done: number; total: number; indexed: number; failed: number } | null>(null);
  const [migResult, setMigResult] = useState<{
    total: number;
    processed: number;
    indexed: number;
    failed: number;
    errors: { row: number; name: string; code: string; error: string }[];
  } | null>(null);
  const cancelMigrationRef = useRef(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([
      enrollmentEnabled || searchEnabled
        ? supabase
            .from('lv_agency_subjects')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false })
            .limit(300)
        : Promise.resolve({ data: [], error: null }),
      enrollmentEnabled
        ? supabase
            .from('lv_subject_migrations')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [], error: null }),
      searchEnabled
        ? supabase
            .from('lv_face_search_history')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false })
            .limit(60)
        : Promise.resolve({ data: [], error: null }),
    ]).then(async ([subRes, migRes, histRes]) => {
      if (!active) return;
      if (subRes.error) {
        setError(subRes.error.message);
      } else {
        const list = (subRes.data ?? []) as AgencySubject[];
        setSubjects(list);
        const nextUrls: Record<string, string> = {};
        await Promise.all(
          list
            .filter((s) => s.primary_photo_path)
            .slice(0, 50)
            .map(async (s) => {
              const { data: signed } = await supabase.storage
                .from('lv-subject-photos')
                .createSignedUrl(s.primary_photo_path!, 600);
              if (signed?.signedUrl) nextUrls[s.id] = signed.signedUrl;
            }),
        );
        if (active) setPhotoUrls(nextUrls);
      }

      if (!migRes.error && active) setMigrations((migRes.data ?? []) as MigrationJobRow[]);

      if (!histRes.error && active) {
        const hList = (histRes.data ?? []) as SearchHistoryRow[];
        setHistory(hList);
        const nextProbeUrls: Record<string, string> = {};
        await Promise.all(
          hList
            .filter((h) => h.probe_snapshot_path)
            .slice(0, 30)
            .map(async (h) => {
              const { data: signed } = await supabase.storage
                .from('lv-subject-photos')
                .createSignedUrl(h.probe_snapshot_path!, 600);
              if (signed?.signedUrl) nextProbeUrls[h.id] = signed.signedUrl;
            }),
        );
        if (active) setProbeUrls(nextProbeUrls);
      }

      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [workspaceId, enrollmentEnabled, searchEnabled, refreshTick]);

  async function handleSingleEnrollment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canWrite) return;
    const form = e.currentTarget;
    const fields = new FormData(form);
    const fullName = String(fields.get('full_name') || '').trim();
    if (!fullName) {
      setError('Full name is required.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data: sessData } = await supabase.auth.getSession();
      const token = sessData.session?.access_token;
      if (!token) throw new Error('Sign in again before enrolling biometric subjects.');

      const uploadedPhotos: any[] = [];
      for (let i = 0; i < anglePhotos.length; i++) {
        const item = anglePhotos[i];
        const prepared = await compressPhotoForBiometrics(item.file);
        const bio = await enrollPhotoWithProvider(workspaceId, token, prepared);
        const storagePath = `${workspaceId}/subjects/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from('lv-subject-photos')
          .upload(storagePath, prepared, { contentType: 'image/jpeg', upsert: false });
        if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
        uploadedPhotos.push({
          storage_path: storagePath,
          face_token: bio.face_token,
          face_indexed: true,
          angle_label: item.angle,
          quality_score: bio.quality_score,
          is_primary: i === 0,
        });
      }

      const entryPayload = {
        ...(editingSubject ? { id: editingSubject.id } : {}),
        subject_code: String(fields.get('subject_code') || '').trim() || null,
        full_name: fullName,
        aliases: String(fields.get('aliases') || '').trim(),
        category: String(fields.get('category') || 'suspect'),
        threat_level: String(fields.get('threat_level') || 'medium'),
        offense_summary: String(fields.get('offense_summary') || '').trim(),
        warrant_reference: String(fields.get('warrant_reference') || '').trim(),
        case_reference: String(fields.get('case_reference') || '').trim(),
        national_id: String(fields.get('national_id') || '').trim(),
        date_of_birth: String(fields.get('date_of_birth') || '').trim(),
        gender: String(fields.get('gender') || '').trim(),
        nationality: String(fields.get('nationality') || '').trim(),
        last_known_location: String(fields.get('last_known_location') || '').trim(),
        physical_marks: String(fields.get('physical_marks') || '').trim(),
        status: String(fields.get('status') || 'active'),
        minimum_clearance: Number(fields.get('minimum_clearance') || 0),
        notes: String(fields.get('notes') || '').trim(),
        source_name: 'manual',
      };

      const { error: saveErr } = await supabase.rpc('lv_upsert_agency_subject', {
        target: workspaceId,
        entry: entryPayload,
        photos: uploadedPhotos,
      });
      if (saveErr) throw new Error(saveErr.message);

      form.reset();
      setAnglePhotos([]);
      setEditingSubject(null);
      setNotice(
        uploadedPhotos.length > 0
          ? `Subject "${fullName}" saved with ${uploadedPhotos.length} indexed Face++ biometric angle(s).`
          : `Subject "${fullName}" dossier updated.`,
      );
      setTab('directory');
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Subject enrollment failed.');
    } finally {
      setBusy(false);
    }
  }

  function handleMigrationFolderSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    const exact = new Map(migPhotosByExactName);
    const norm = new Map(migPhotosByNormKey);
    const list = [...migAllPhotoFiles];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      exact.set(file.name.toLowerCase(), file);
      const base = file.name.replace(/\.[^.]+$/, '');
      const key = normalizeLookupKey(base);
      if (key) norm.set(key, file);
      list.push(file);
    }
    setMigPhotosByExactName(exact);
    setMigPhotosByNormKey(norm);
    setMigAllPhotoFiles(list);
    setNotice(`Loaded ${list.length} reference pictures ready for auto-matching.`);
  }

  async function handleMigrationDataset(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setMigDataRows(null);
    setMigResult(null);
    setError('');
    if (!file) return;
    try {
      const parsed = await parseSubjectMigrationFile(file);
      if (parsed.length === 0) {
        setError('No valid subject/criminal rows found. Check headers: subject_code, full_name, offense_summary, case_reference, photo_filename.');
        return;
      }
      setMigCsvFileName(file.name);
      setMigDataRows(parsed);
      setNotice(`Parsed ${parsed.length} subject dossier rows from "${file.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse CSV/Excel file.');
    }
  }

  function resolveMatchedPhotoForRow(row: SubjectMigrationRowInput): File | undefined {
    if (row.photo_filename) {
      const byExact = migPhotosByExactName.get(row.photo_filename.toLowerCase());
      if (byExact) return byExact;
      const baseKey = normalizeLookupKey(row.photo_filename.replace(/\.[^.]+$/, ''));
      if (baseKey && migPhotosByNormKey.has(baseKey)) return migPhotosByNormKey.get(baseKey);
    }
    if (row.subject_code) {
      const codeKey = normalizeLookupKey(row.subject_code);
      if (codeKey && migPhotosByNormKey.has(codeKey)) return migPhotosByNormKey.get(codeKey);
    }
    if (row.national_id) {
      const ninKey = normalizeLookupKey(row.national_id);
      if (ninKey && migPhotosByNormKey.has(ninKey)) return migPhotosByNormKey.get(ninKey);
    }
    if (row.full_name) {
      const nameKey = normalizeLookupKey(row.full_name);
      if (nameKey && migPhotosByNormKey.has(nameKey)) return migPhotosByNormKey.get(nameKey);
    }
    return undefined;
  }

  async function runBulkMigration(e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;

    // Support BOTH Data+Photos mode AND Photos-Only Bulk Migration mode!
    const workItems: { row: SubjectMigrationRowInput; file?: File }[] = [];
    if (migDataRows && migDataRows.length > 0) {
      for (const row of migDataRows) {
        const matched = resolveMatchedPhotoForRow(row);
        if (migSkipUnmatched && !matched) continue;
        workItems.push({ row, file: matched });
      }
    } else if (migAllPhotoFiles.length > 0) {
      for (const file of migAllPhotoFiles) {
        const rawBase = file.name.replace(/\.[^.]+$/, '');
        const parts = rawBase.split('__');
        const fullName = parts[0].replace(/[_-]+/g, ' ').trim() || rawBase;
        workItems.push({
          file,
          row: {
            subject_code: rawBase.slice(0, 60),
            full_name: fullName,
            aliases: '',
            date_of_birth: '',
            gender: '',
            nationality: '',
            category: 'suspect',
            threat_level: 'medium',
            offense_summary: parts[1] ? parts[1].replace(/[_-]+/g, ' ').trim() : '',
            warrant_reference: '',
            case_reference: '',
            national_id: '',
            last_known_location: '',
            physical_marks: '',
            notes: `Migrated from photo file ${file.name}`,
            status: 'active',
            minimum_clearance: '0',
            photo_filename: file.name,
          },
        });
      }
    }

    if (workItems.length === 0) {
      setError('Upload a criminal/subject CSV/Excel file and/or a batch of subject photos first.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    setMigResult(null);
    cancelMigrationRef.current = false;
    setMigProgress({ done: 0, total: workItems.length, indexed: 0, failed: 0 });

    let migrationJobId: string | null = null;
    let processed = 0;
    let indexed = 0;
    let failed = 0;
    const errRows: { row: number; name: string; code: string; error: string }[] = [];

    try {
      const { data: sessData } = await supabase.auth.getSession();
      const token = sessData.session?.access_token;
      if (!token) throw new Error('Sign in again to execute subject migration.');

      const { data: jobId, error: jobErr } = await supabase.rpc('lv_start_subject_migration', {
        target: workspaceId,
        source_label: migSourceName.trim() || 'Bulk Subject Migration',
        filename: migCsvFileName || `${migAllPhotoFiles.length} photos`,
        total: workItems.length,
      });
      if (jobErr) throw new Error(jobErr.message);
      migrationJobId = String(jobId);

      for (let i = 0; i < workItems.length; i++) {
        if (cancelMigrationRef.current) break;
        const { row, file } = workItems[i];
        const rowNum = i + 1;
        try {
          const photosPayload: any[] = [];
          if (file) {
            const prepared = await compressPhotoForBiometrics(file);
            const bio = await enrollPhotoWithProvider(workspaceId, token, prepared);
            const storagePath = `${workspaceId}/subjects/${crypto.randomUUID()}.jpg`;
            const { error: upErr } = await supabase.storage
              .from('lv-subject-photos')
              .upload(storagePath, prepared, { contentType: 'image/jpeg', upsert: false });
            if (upErr) throw new Error(upErr.message);
            photosPayload.push({
              storage_path: storagePath,
              face_token: bio.face_token,
              face_indexed: true,
              angle_label: 'frontal',
              quality_score: bio.quality_score,
              is_primary: true,
            });
            indexed++;
          }

          const { error: upsertErr } = await supabase.rpc('lv_upsert_agency_subject', {
            target: workspaceId,
            entry: {
              subject_code: row.subject_code || null,
              full_name: row.full_name || row.subject_code || `Subject ${rowNum}`,
              aliases: row.aliases,
              date_of_birth: row.date_of_birth,
              gender: row.gender,
              nationality: row.nationality,
              category: ['wanted', 'suspect', 'person_of_interest', 'missing', 'authorized', 'other'].includes(row.category)
                ? row.category
                : 'suspect',
              threat_level: ['low', 'medium', 'high', 'critical'].includes(row.threat_level) ? row.threat_level : 'medium',
              offense_summary: row.offense_summary,
              warrant_reference: row.warrant_reference,
              case_reference: row.case_reference,
              national_id: row.national_id,
              last_known_location: row.last_known_location,
              physical_marks: row.physical_marks,
              notes: row.notes,
              status: ['active', 'resolved', 'archived'].includes(row.status) ? row.status : 'active',
              minimum_clearance: Number(row.minimum_clearance || 0),
              source_name: migSourceName.trim() || 'migration',
              migration_id: migrationJobId,
            },
            photos: photosPayload,
          });
          if (upsertErr) throw new Error(upsertErr.message);
        } catch (rowErr) {
          failed++;
          errRows.push({
            row: rowNum,
            name: row.full_name || '',
            code: row.subject_code || '',
            error: rowErr instanceof Error ? rowErr.message : 'Row failed',
          });
        }
        processed++;
        setMigProgress({ done: processed, total: workItems.length, indexed, failed });
      }

      const finalStatus = cancelMigrationRef.current
        ? 'cancelled'
        : failed > 0
          ? 'completed_with_errors'
          : 'completed';
      await supabase.rpc('lv_update_subject_migration', {
        target_migration: migrationJobId,
        processed,
        indexed,
        duplicates: 0,
        failed,
        next_status: finalStatus,
        err_list: errRows.slice(0, 100),
      });

      setMigResult({ total: workItems.length, processed, indexed, failed, errors: errRows });
      setNotice(
        `Migration finished (${finalStatus}): ${processed}/${workItems.length} processed, ${indexed} Face++ faces indexed, ${failed} errors.`,
      );
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk subject migration failed.');
      if (migrationJobId) {
        try {
          await supabase.rpc('lv_update_subject_migration', {
            target_migration: migrationJobId,
            processed,
            indexed,
            duplicates: 0,
            failed,
            next_status: 'failed',
            err_list: errRows.slice(0, 100),
          });
        } catch {
          // Ignore secondary failure when recording migration failure status
        }
      }
    } finally {
      setBusy(false);
      setMigProgress(null);
    }
  }

  async function archiveSubject(sub: AgencySubject) {
    if (!canArchive) return;
    setBusy(true);
    setError('');
    try {
      if (sub.face_token) {
        const { data: sessData } = await supabase.auth.getSession();
        if (sessData.session?.access_token) {
          const rmForm = new FormData();
          rmForm.set('action', 'remove_face');
          rmForm.set('face_tokens', sub.face_token);
          await fetch('/api/face-intelligence', {
            method: 'POST',
            headers: { Authorization: `Bearer ${sessData.session.access_token}`, 'X-Workspace-Id': workspaceId },
            body: rmForm,
          }).catch(() => {});
        }
      }
      const { error: err } = await supabase.rpc('lv_retire_agency_subject', { target_id: sub.id });
      if (err) throw new Error(err.message);
      setNotice(`Archived subject dossier "${sub.full_name}".`);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive subject.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSubject(sub: AgencySubject) {
    if (!canDelete) return;
    setBusy(true);
    setError('');
    try {
      if (sub.face_token) {
        const { data: sessData } = await supabase.auth.getSession();
        if (sessData.session?.access_token) {
          const rmForm = new FormData();
          rmForm.set('action', 'remove_face');
          rmForm.set('face_tokens', sub.face_token);
          await fetch('/api/face-intelligence', {
            method: 'POST',
            headers: { Authorization: `Bearer ${sessData.session.access_token}`, 'X-Workspace-Id': workspaceId },
            body: rmForm,
          }).catch(() => {});
        }
      }
      const { error: err } = await supabase.rpc('lv_delete_agency_subject', { target_id: sub.id });
      if (err) throw new Error(err.message);
      if (sub.primary_photo_path) {
        await supabase.storage.from('lv-subject-photos').remove([sub.primary_photo_path]).catch(() => {});
      }
      setNotice(`Permanently removed subject "${sub.full_name}" from database and Face++ index.`);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete subject.');
    } finally {
      setBusy(false);
    }
  }

  const filteredSubjects = subjects.filter((s) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesQ =
      !q ||
      `${s.full_name} ${s.aliases} ${s.subject_code || ''} ${s.offense_summary} ${s.warrant_reference} ${s.case_reference} ${s.national_id} ${s.last_known_location}`
        .toLowerCase()
        .includes(q);
    const matchesCat = categoryFilter === 'all' || s.category === categoryFilter;
    const matchesThreat = threatFilter === 'all' || s.threat_level === threatFilter;
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesQ && matchesCat && matchesThreat && matchesStatus;
  });

  return (
    <section className="lv-card" aria-label="Enterprise Subject Enrollment & Criminal Database Migration">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>Agency Subject Enrollment, Bulk Migration &amp; Biometric Dossiers</h2>
          <p>
            Enroll authorized subject dossiers with multi-angle Face++ biometric vectors, migrate bulk CSV/Excel
            criminal datasets and mugshot folders into an isolated per-agency FaceSet, and audit all face searches.
          </p>
        </div>
        <div className="lv-video-actions">
          <button type="button" className={tab === 'directory' ? '' : 'lv-secondary'} onClick={() => setTab('directory')}>
            Dossier Directory ({subjects.length})
          </button>
          {canWrite && (
            <button
              type="button"
              className={tab === 'enroll' ? '' : 'lv-secondary'}
              onClick={() => {
                setEditingSubject(null);
                setAnglePhotos([]);
                setTab('enroll');
              }}
            >
              + Enroll Subject
            </button>
          )}
          {canWrite && (
            <button type="button" className={tab === 'migrate' ? '' : 'lv-secondary'} onClick={() => setTab('migrate')}>
              Bulk Data &amp; Photo Migration
            </button>
          )}
          {searchEnabled && (
            <button type="button" className={tab === 'history' ? '' : 'lv-secondary'} onClick={() => setTab('history')}>
              Search Audit History ({history.length})
            </button>
          )}
        </div>
      </div>

      {error && <p role="alert" style={{ color: '#ff8b89' }}>{error}</p>}
      {notice && <p role="status" className="lv-notice">{notice}</p>}

      {/* Tab 1: Searchable Subject Directory */}
      {tab === 'directory' && (
        <div style={{ marginTop: '1rem' }}>
          <div className="lv-observation-filters">
            <label>
              Search name, subject code, warrant, case ref, NIN, or offense
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search dossiers..."
              />
            </label>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <label style={{ flex: 1, minWidth: '120px' }}>
                Category
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="all">All categories</option>
                  <option value="wanted">Wanted</option>
                  <option value="suspect">Suspect</option>
                  <option value="person_of_interest">Person of interest</option>
                  <option value="missing">Missing</option>
                  <option value="authorized">Authorized</option>
                </select>
              </label>
              <label style={{ flex: 1, minWidth: '110px' }}>
                Threat
                <select value={threatFilter} onChange={(e) => setThreatFilter(e.target.value)}>
                  <option value="all">All levels</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label style={{ flex: 1, minWidth: '110px' }}>
                Status
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="resolved">Resolved</option>
                  <option value="archived">Archived</option>
                  <option value="all">All</option>
                </select>
              </label>
            </div>
          </div>

          {loading ? (
            <p>Loading subject dossiers…</p>
          ) : filteredSubjects.length === 0 ? (
            <p>No enrolled subject dossiers match this filter. Use "+ Enroll Subject" or "Bulk Data & Photo Migration".</p>
          ) : (
            filteredSubjects.map((sub) => (
              <article key={sub.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start', flex: 1 }}>
                    {photoUrls[sub.id] && (
                      <img
                        src={photoUrls[sub.id]}
                        alt={`Subject ${sub.full_name}`}
                        style={{
                          width: '88px',
                          height: '96px',
                          objectFit: 'cover',
                          borderRadius: '6px',
                          border: '1px solid #354858',
                        }}
                      />
                    )}
                    <div>
                      <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0 }}>{sub.full_name}</h3>
                        {sub.subject_code && <span className="lv-badge">{sub.subject_code}</span>}
                        <span className={`lunar-badge ${sub.threat_level === 'critical' || sub.threat_level === 'high' ? 'high' : 'medium'}`}>
                          {sub.threat_level}
                        </span>
                        <span className="lv-badge">{sub.category.replace('_', ' ')}</span>
                        <span className="lv-badge">{sub.face_indexed ? 'Face++ Indexed' : 'No Biometric Vector'}</span>
                        {sub.minimum_clearance > 0 && <span className="lv-badge">L{sub.minimum_clearance}</span>}
                      </div>
                      {sub.aliases && <small>Aliases: {sub.aliases}</small>}
                      {sub.offense_summary && <p style={{ margin: '0.35rem 0' }}>{sub.offense_summary}</p>}
                      <p style={{ margin: '0.25rem 0' }}>
                        {sub.warrant_reference && <>Warrant: <strong>{sub.warrant_reference}</strong> · </>}
                        {sub.case_reference && <>Case: <strong>{sub.case_reference}</strong> · </>}
                        {sub.last_known_location && <>Last seen: {sub.last_known_location} · </>}
                        Source: {sub.source_name}
                      </p>
                      <small>
                        Enrolled {new Date(sub.created_at).toLocaleString()}
                        {sub.created_by_label ? ` by ${sub.created_by_label}` : ''}
                      </small>
                    </div>
                  </div>
                  <div className="lv-video-actions">
                    {canWrite && (
                      <button
                        type="button"
                        className="lv-secondary"
                        disabled={busy}
                        onClick={() => {
                          setEditingSubject(sub);
                          setAnglePhotos([]);
                          setTab('enroll');
                        }}
                      >
                        Edit / Add Angles
                      </button>
                    )}
                    {canArchive && sub.status !== 'archived' && (
                      <button type="button" className="lv-secondary" disabled={busy} onClick={() => void archiveSubject(sub)}>
                        Archive
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        className="lv-secondary"
                        style={{ borderColor: '#ef4444', color: '#ff8b89' }}
                        disabled={busy}
                        onClick={() => void deleteSubject(sub)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {/* Tab 2: Single Subject & Multi-Angle Biometric Enrollment */}
      {tab === 'enroll' && canWrite && (
        <div className="lv-card" style={{ marginTop: '1rem', background: '#0c131b' }}>
          <h3>{editingSubject ? `Edit Dossier: ${editingSubject.full_name}` : 'Enroll New Biometric Subject Dossier'}</h3>
          <p>
            Attach up to 5 reference photographs (frontal, left/right profiles, surveillance stills). Every uploaded image
            is compressed and indexed into this agency's isolated Face++ FaceSet index.
          </p>
          <form onSubmit={handleSingleEnrollment} className="lv-form-grid">
            <label>
              Subject / Booking Code (optional unique key)
              <input name="subject_code" defaultValue={editingSubject?.subject_code || ''} maxLength={80} placeholder="e.g. AFIS-2026-0842" />
            </label>
            <label>
              Full Name *
              <input name="full_name" defaultValue={editingSubject?.full_name || ''} maxLength={140} required />
            </label>
            <label>
              Known Aliases
              <input name="aliases" defaultValue={editingSubject?.aliases || ''} maxLength={300} />
            </label>
            <label>
              Category
              <select name="category" defaultValue={editingSubject?.category || 'suspect'}>
                <option value="wanted">Wanted</option>
                <option value="suspect">Suspect</option>
                <option value="person_of_interest">Person of interest</option>
                <option value="missing">Missing person</option>
                <option value="authorized">Authorized VIP / Staff</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Threat Level
              <select name="threat_level" defaultValue={editingSubject?.threat_level || 'medium'}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label>
              Dossier Status
              <select name="status" defaultValue={editingSubject?.status || 'active'}>
                <option value="active">Active (Searchable)</option>
                <option value="resolved">Resolved</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label>
              Warrant Reference
              <input name="warrant_reference" defaultValue={editingSubject?.warrant_reference || ''} maxLength={120} />
            </label>
            <label>
              Case Reference
              <input name="case_reference" defaultValue={editingSubject?.case_reference || ''} maxLength={120} />
            </label>
            <label>
              National ID / NIN / Passport
              <input name="national_id" defaultValue={editingSubject?.national_id || ''} maxLength={80} />
            </label>
            <label>
              Date of Birth
              <input name="date_of_birth" defaultValue={editingSubject?.date_of_birth || ''} maxLength={40} placeholder="YYYY-MM-DD" />
            </label>
            <label>
              Gender
              <input name="gender" defaultValue={editingSubject?.gender || ''} maxLength={40} />
            </label>
            <label>
              Nationality
              <input name="nationality" defaultValue={editingSubject?.nationality || ''} maxLength={80} />
            </label>
            <label>
              Last Known Location
              <input name="last_known_location" defaultValue={editingSubject?.last_known_location || ''} maxLength={240} />
            </label>
            <label>
              Minimum Clearance Level (0-3)
              <select name="minimum_clearance" defaultValue={String(editingSubject?.minimum_clearance ?? 0)}>
                <option value="0">Level 0 (Standard)</option>
                <option value="1">Level 1 (Restricted)</option>
                <option value="2">Level 2 (Secret)</option>
                <option value="3">Level 3 (Top Clearance)</option>
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Criminal Charges / Offense Summary
              <textarea name="offense_summary" defaultValue={editingSubject?.offense_summary || ''} maxLength={2000} rows={2} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Physical Marks / Identifying Traits
              <input name="physical_marks" defaultValue={editingSubject?.physical_marks || ''} maxLength={1000} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Operational Notes
              <textarea name="notes" defaultValue={editingSubject?.notes || ''} maxLength={4000} rows={2} />
            </label>

            <div style={{ gridColumn: '1 / -1' }}>
              <label>
                Add Reference Biometric Photo(s) (JPEG, PNG, WebP — up to 5 angles)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => {
                    const selected = Array.from(e.target.files || []).slice(0, 5);
                    setAnglePhotos(selected.map((f, idx) => ({ file: f, angle: idx === 0 ? 'frontal' : 'surveillance_still' })));
                  }}
                />
              </label>
              {anglePhotos.map((ap, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.4rem' }}>
                  <span>{ap.file.name}</span>
                  <select
                    value={ap.angle}
                    onChange={(e) =>
                      setAnglePhotos((prev) =>
                        prev.map((item, j) => (j === idx ? { ...item, angle: e.target.value } : item)),
                      )
                    }
                    style={{ maxWidth: '210px' }}
                  >
                    {ANGLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="lv-video-actions" style={{ gridColumn: '1 / -1' }}>
              <button type="submit" disabled={busy}>
                {busy ? 'Encoding & indexing Face++ vector…' : editingSubject ? 'Save dossier & new angles' : 'Enroll subject into database'}
              </button>
              {editingSubject && (
                <button type="button" className="lv-secondary" onClick={() => setEditingSubject(null)}>
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Tab 3: High-Throughput Bulk Data & Photo Folder Migration */}
      {tab === 'migrate' && canWrite && (
        <div className="lv-card" style={{ marginTop: '1rem', background: '#0c131b' }}>
          <h3>Bulk Criminal Data, Dossier &amp; Face Photo Migration Pipeline</h3>
          <p>
            Migrate large archives of criminal data and subject photographs directly into this agency's encrypted storage
            and isolated Face++ FaceSet index. Automatically matches photos to spreadsheet rows by{' '}
            <code>photo_filename</code>, <code>subject_code</code>, <code>national_id</code>, or <code>full_name</code> — or
            drop a batch/folder of named photos directly without a spreadsheet.
          </p>
          <div className="lv-video-actions">
            <button
              type="button"
              className="lv-secondary"
              onClick={() =>
                triggerCsvDownload(
                  [
                    'subject_code',
                    'full_name',
                    'aliases',
                    'category',
                    'threat_level',
                    'offense_summary',
                    'warrant_reference',
                    'case_reference',
                    'national_id',
                    'date_of_birth',
                    'gender',
                    'nationality',
                    'last_known_location',
                    'physical_marks',
                    'status',
                    'notes',
                    'photo_filename',
                  ],
                  [
                    [
                      'AFIS-1042',
                      'Ibrahim Musa',
                      'Bello',
                      'wanted',
                      'high',
                      'Armed robbery & interstate highway hijacking',
                      'WR-2026-041',
                      'CR-2026-881',
                      '88420194812',
                      '1989-04-12',
                      'Male',
                      'Nigerian',
                      'Apapa Wharf Corridor, Lagos',
                      'Scar on left forearm',
                      'active',
                      'Approach with armed escort',
                      'AFIS-1042.jpg',
                    ],
                  ],
                  'lunavision_subject_migration_template.csv',
                )
              }
            >
              Download criminal dossier CSV template
            </button>
          </div>

          <form onSubmit={runBulkMigration}>
            <label>
              Source agency / legacy archive name
              <input value={migSourceName} onChange={(e) => setMigSourceName(e.target.value)} maxLength={120} required />
            </label>
            <div className="lv-form-grid">
              <label>
                Step 1: Criminal / Subject Dataset (`.csv` or `.xlsx`, optional)
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => void handleMigrationDataset(e)}
                />
              </label>
              <label>
                Step 2: Select Batch of Subject Pictures (multi-select images)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => handleMigrationFolderSelect(e.target.files)}
                />
              </label>
            </div>
            <label className="lv-auto-observations">
              <input
                type="checkbox"
                checked={migSkipUnmatched}
                onChange={(e) => setMigSkipUnmatched(e.target.checked)}
              />
              <span>Skip spreadsheet rows that do not have a matching picture file in Step 2</span>
            </label>
            <p>
              Loaded spreadsheet rows: <strong>{migDataRows ? migDataRows.length : 0}</strong> · Loaded pictures:{' '}
              <strong>{migAllPhotoFiles.length}</strong>
            </p>
            {migProgress && (
              <div style={{ marginBlock: '0.5rem' }}>
                <progress value={migProgress.done} max={migProgress.total} style={{ width: '100%' }} />
                <small>
                  Processing {migProgress.done} / {migProgress.total} · Indexed in Face++: {migProgress.indexed} · Errors:{' '}
                  {migProgress.failed}
                </small>
              </div>
            )}
            <div className="lv-video-actions">
              <button type="submit" disabled={busy || (!migDataRows?.length && migAllPhotoFiles.length === 0)}>
                {busy ? 'Running Face++ indexing migration…' : 'Start migration & Face++ indexing'}
              </button>
              {busy && migProgress && (
                <button
                  type="button"
                  className="lv-secondary"
                  onClick={() => {
                    cancelMigrationRef.current = true;
                  }}
                >
                  Stop migration
                </button>
              )}
              {(migDataRows || migAllPhotoFiles.length > 0) && !busy && (
                <button
                  type="button"
                  className="lv-secondary"
                  onClick={() => {
                    setMigDataRows(null);
                    setMigAllPhotoFiles([]);
                    setMigPhotosByExactName(new Map());
                    setMigPhotosByNormKey(new Map());
                    setMigResult(null);
                  }}
                >
                  Clear queued files
                </button>
              )}
            </div>
          </form>

          {migResult && (
            <div className="lv-card" style={{ marginTop: '0.75rem' }}>
              <h4>Migration Result</h4>
              <p>
                Processed: {migResult.processed} / {migResult.total} · Face++ Indexed: {migResult.indexed} · Failed:{' '}
                {migResult.failed}
              </p>
              {migResult.errors.length > 0 && (
                <button
                  type="button"
                  className="lv-secondary"
                  onClick={() =>
                    triggerCsvDownload(
                      ['row', 'subject_code', 'full_name', 'error'],
                      migResult.errors.map((er) => [er.row, er.code, er.name, er.error]),
                      'subject_migration_errors.csv',
                    )
                  }
                >
                  Download failed rows CSV ({migResult.errors.length})
                </button>
              )}
            </div>
          )}

          {migrations.length > 0 && (
            <div style={{ marginTop: '1.25rem' }}>
              <h4>Past Migration Jobs</h4>
              <div className="lv-observation-table">
                <table>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Source</th>
                      <th>File / Batch</th>
                      <th>Status</th>
                      <th>Processed / Total</th>
                      <th>Face++ Indexed</th>
                      <th>Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {migrations.map((m) => (
                      <tr key={m.id}>
                        <td>{new Date(m.created_at).toLocaleString()}</td>
                        <td>{m.source_name}</td>
                        <td>{m.file_name || '—'}</td>
                        <td>
                          <span className="lv-badge">{m.status}</span>
                        </td>
                        <td>
                          {m.processed_records} / {m.total_records}
                        </td>
                        <td>{m.indexed_faces}</td>
                        <td>{m.failed_records}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Immutable Face Search Audit History */}
      {tab === 'history' && searchEnabled && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Forensic Face Search Audit History ({history.length})</h3>
          <p>
            Every 1:N database search and 1-vs-6 comparison performed in this workspace is logged with operator
            attribution, probe quality metrics, and candidate similarity scores.
          </p>
          {history.length === 0 ? (
            <p>No face searches have been logged in this agency workspace yet.</p>
          ) : (
            history.map((h) => (
              <article key={h.id}>
                <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {probeUrls[h.id] && (
                    <img
                      src={probeUrls[h.id]}
                      alt="Submitted probe snapshot"
                      style={{
                        width: '74px',
                        height: '74px',
                        objectFit: 'cover',
                        borderRadius: '6px',
                        border: '1px solid #354858',
                      }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{h.search_mode === 'faceset_1n' ? '1:N Database Search' : h.search_mode}</strong>
                      <span className="lv-badge">{h.result_count} matches</span>
                      {h.top_confidence !== null && (
                        <span className="lv-badge">Top score: {Number(h.top_confidence).toFixed(1)}%</span>
                      )}
                      {h.case_reference && <span className="lv-badge">Case: {h.case_reference}</span>}
                    </div>
                    <small>
                      {new Date(h.created_at).toLocaleString()} · Operator: {h.actor_label || h.actor_id}
                    </small>
                    {h.notes && <p style={{ margin: '0.25rem 0' }}>{h.notes}</p>}
                    {Array.isArray(h.results) && h.results.length > 0 && (
                      <div style={{ marginTop: '0.35rem', fontSize: '0.85rem' }}>
                        {h.results.map((r, idx) => (
                          <div key={idx}>
                            • <strong>{r.full_name}</strong>
                            {r.subject_code ? ` (${r.subject_code})` : ''} — {Number(r.confidence).toFixed(1)}% ({r.band})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}

