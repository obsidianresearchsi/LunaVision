import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import {
  VehicleRegistryRowInput,
  normalizePlate,
  parseVehicleImportFile,
  roleCan,
  triggerCsvDownload,
} from '../services/videoIntelligence';

interface RegistryVehicle {
  id: string;
  plate: string;
  make: string;
  model: string;
  colour: string;
  vehicle_type: string;
  vehicle_year: number | null;
  registration_status: 'registered' | 'expired' | 'unregistered' | 'unknown';
  notes: string;
  source_name: string;
  created_at: string;
  updated_at: string;
}

interface ImportHistoryRow {
  id: string;
  source_name: string;
  file_name: string;
  update_existing: boolean;
  total_rows: number;
  inserted_rows: number;
  updated_rows: number;
  duplicate_rows: number;
  invalid_rows: number;
  errors: { row: number; plate: string; error: string }[];
  created_at: string;
}

export default function VehicleRegistry({
  workspaceId,
  role = 'member',
  platformAdmin = false,
}: {
  workspaceId: string;
  role?: string;
  platformAdmin?: boolean;
}) {
  const canWrite = roleCan(role, 'registry_write', platformAdmin);

  const [vehicles, setVehicles] = useState<RegistryVehicle[]>([]);
  const [imports, setImports] = useState<ImportHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Bulk import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedPreview, setParsedPreview] = useState<VehicleRegistryRowInput[] | null>(null);
  const [sourceName, setSourceName] = useState('FRSC Vehicle Registry');
  const [updateExisting, setUpdateExisting] = useState(true);
  const [lastImportReport, setLastImportReport] = useState<{
    total: number;
    inserted: number;
    updated: number;
    duplicates: number;
    invalid: number;
    errors: { row: number; plate: string; error: string }[];
  } | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const importCancelRef = useRef(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void Promise.all([
      supabase
        .from('lv_vehicle_registry')
        .select('id,plate,make,model,colour,vehicle_type,vehicle_year,registration_status,notes,source_name,created_at,updated_at')
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(300),
      supabase
        .from('lv_registry_imports')
        .select('id,source_name,file_name,update_existing,total_rows,inserted_rows,updated_rows,duplicate_rows,invalid_rows,errors,created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]).then(([vehRes, impRes]) => {
      if (!current) return;
      if (vehRes.error || impRes.error) {
        setError(vehRes.error?.message || impRes.error?.message || 'Vehicle registry could not be loaded.');
      } else {
        setVehicles((vehRes.data ?? []) as RegistryVehicle[]);
        setImports((impRes.data ?? []) as ImportHistoryRow[]);
      }
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [workspaceId, refresh]);

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setParsedPreview(null);
    setLastImportReport(null);
    setError('');
    setNotice('');
    if (!file) return;
    try {
      const rows = await parseVehicleImportFile(file);
      if (rows.length === 0) {
        setError('No data rows found in the uploaded file. Check column headers (plate, make, model, colour, vehicle_type, year, registration_status, notes).');
        return;
      }
      setParsedPreview(rows);
      setNotice(`Parsed ${rows.length} rows from "${file.name}". Review settings and click Import batch.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be parsed. Upload a valid .csv or .xlsx workbook.');
    }
  }

  async function runBulkImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || !parsedPreview || parsedPreview.length === 0) return;
    setBusy(true);
    setError('');
    setNotice('');
    setLastImportReport(null);
    importCancelRef.current = false;
    setImportProgress({ done: 0, total: parsedPreview.length });
    try {
      const cleanSource = sourceName.trim() || 'Manual Bulk Import';
      const fileName = selectedFile?.name || 'import.csv';
      let total = 0;
      let inserted = 0;
      let updated = 0;
      let duplicates = 0;
      let invalid = 0;
      const allErrors: { row: number; plate: string; error: string }[] = [];

      // Chunk in batches of 1000 rows so tens of thousands of plates migrate smoothly with live progress
      const chunkSize = 1000;
      for (let i = 0; i < parsedPreview.length; i += chunkSize) {
        if (importCancelRef.current) break;
        const chunk = parsedPreview.slice(i, i + chunkSize);
        const { data, error: rpcError } = await supabase.rpc('lv_import_registry', {
          target: workspaceId,
          source_name: cleanSource,
          file_name: fileName,
          entries: chunk,
          update_existing: updateExisting,
        });
        if (rpcError) throw new Error(rpcError.message);
        const res = data as any;
        total += Number(res.total || 0);
        inserted += Number(res.inserted || 0);
        updated += Number(res.updated || 0);
        duplicates += Number(res.duplicates || 0);
        invalid += Number(res.invalid || 0);
        if (Array.isArray(res.errors)) {
          for (const errRow of res.errors) {
            if (allErrors.length < 200) {
              allErrors.push({
                row: Number(errRow.row || 0) + i,
                plate: String(errRow.plate || ''),
                error: String(errRow.error || 'Invalid row'),
              });
            }
          }
        }
        setImportProgress({ done: Math.min(parsedPreview.length, i + chunk.length), total: parsedPreview.length });
      }

      setLastImportReport({
        total,
        inserted,
        updated,
        duplicates,
        invalid,
        errors: allErrors,
      });
      setNotice(
        importCancelRef.current
          ? `Import stopped after ${total} rows: ${inserted} inserted, ${updated} updated.`
          : `Import finished: ${inserted} inserted, ${updated} updated, ${duplicates} skipped duplicates, ${invalid} invalid.`,
      );
      setSelectedFile(null);
      setParsedPreview(null);
      setRefresh((r) => r + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk import failed.');
    } finally {
      setBusy(false);
      setImportProgress(null);
    }
  }

  async function saveManualVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        plate: normalizePlate(String(fields.get('plate'))),
        make: String(fields.get('make') || '').trim(),
        model: String(fields.get('model') || '').trim(),
        colour: String(fields.get('colour') || '').trim(),
        vehicle_type: String(fields.get('vehicle_type') || '').trim(),
        year: String(fields.get('year') || '').trim(),
        registration_status: String(fields.get('registration_status') || 'registered'),
        notes: String(fields.get('notes') || '').trim(),
      };
      const { data, error: rpcError } = await supabase.rpc('lv_save_registry_vehicle', {
        target: workspaceId,
        vehicle: payload,
      });
      if (rpcError) throw new Error(rpcError.message);
      form.reset();
      setNotice(`Vehicle ${payload.plate} ${data === 'updated' ? 'updated' : 'registered'} in registry database.`);
      setRefresh((r) => r + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save vehicle registration record.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteVehicle(id: string, plate: string) {
    if (!canWrite) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc('lv_delete_registry_vehicle', { target_id: id });
      if (rpcError) throw new Error(rpcError.message);
      setNotice(`Removed ${plate} from the vehicle registration database.`);
      setRefresh((r) => r + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete record.');
    } finally {
      setBusy(false);
    }
  }

  function downloadSampleCsv() {
    const csv = [
      'plate,make,model,colour,vehicle_type,year,registration_status,notes',
      'KJA492AX,Toyota,Corolla,Silver,Car,2021,registered,Verified commercial fleet',
      'ABJ883KL,Honda,Civic,Black,Car,2019,expired,Renewal pending',
      'LAG772MN,Mercedes-Benz,Actros,White,Truck,2020,registered,Haulage permit active',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lunavision_vehicle_registry_template.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const filteredVehicles = vehicles.filter((v) => {
    const normQ = normalizePlate(search);
    const rawQ = search.trim().toLowerCase();
    const matchesSearch =
      !rawQ ||
      v.plate.includes(normQ) ||
      `${v.make} ${v.model} ${v.colour} ${v.vehicle_type} ${v.source_name}`.toLowerCase().includes(rawQ);
    const matchesStatus = statusFilter === 'all' || v.registration_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <section className="lv-card" aria-label="Pre-populated vehicle registration database">
      <h2>Pre-Populated Vehicle Registration Database</h2>
      <p>
        General vehicle registration reference dataset kept completely separate from the security watchlist. When ANPR
        reads a license plate, matching records here enrich detection events with vehicle make, model, colour, and
        registration status.
      </p>

      {!canWrite && (
        <p className="lv-notice">
          Read-only view: Only Supervisors, Administrators, or Workspace Owners can import or edit vehicle registration records.
        </p>
      )}
      {error && <p role="alert" style={{ color: '#ff8b89' }}>{error}</p>}
      {notice && <p role="status" className="lv-notice">{notice}</p>}

      {canWrite && (
        <div className="lv-grid" style={{ marginTop: '1rem' }}>
          {/* Bulk CSV / Excel Import */}
          <div className="lv-card" style={{ marginBlock: 0 }}>
            <h3>Bulk CSV / Excel Import &amp; Synchronization</h3>
            <p>
              Import `.csv` or `.xlsx` datasets with columns: `plate`, `make`, `model`, `colour`, `vehicle_type`,
              `year`, `registration_status`, `notes`.
            </p>
            <div className="lv-video-actions">
              <button type="button" className="lv-secondary" onClick={downloadSampleCsv}>
                Download CSV template
              </button>
            </div>
            <form onSubmit={runBulkImport}>
              <label>
                Data source name
                <input
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                Choose `.csv` or `.xlsx` file
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => void handleFileSelect(e)}
                />
              </label>
              <label className="lv-auto-observations">
                <input
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                />
                <span>Update existing plate records when matched (dataset sync)</span>
              </label>
              {parsedPreview && (
                <p>
                  Ready to import <strong>{parsedPreview.length}</strong> records. First row preview:{' '}
                  <code>
                    {parsedPreview[0].plate} · {parsedPreview[0].make} {parsedPreview[0].model}
                  </code>
                </p>
              )}
              {importProgress && (
                <div style={{ marginBlock: '0.5rem' }}>
                  <progress value={importProgress.done} max={importProgress.total} style={{ width: '100%' }} />
                  <small>
                    Importing {importProgress.done.toLocaleString()} / {importProgress.total.toLocaleString()} plates…
                  </small>
                </div>
              )}
              <div className="lv-video-actions">
                <button type="submit" disabled={busy || !parsedPreview}>
                  {busy ? 'Importing rows...' : 'Import & validate batch'}
                </button>
                {busy && importProgress && (
                  <button
                    type="button"
                    className="lv-secondary"
                    onClick={() => {
                      importCancelRef.current = true;
                    }}
                  >
                    Stop import
                  </button>
                )}
              </div>
            </form>

            {lastImportReport && (
              <div className="lv-card" style={{ marginTop: '0.75rem', background: '#0c131b' }}>
                <h4>Import validation summary</h4>
                <p>
                  Total: {lastImportReport.total} · Inserted: {lastImportReport.inserted} · Updated:{' '}
                  {lastImportReport.updated} · Duplicates skipped: {lastImportReport.duplicates} · Invalid:{' '}
                  {lastImportReport.invalid}
                </p>
                {lastImportReport.errors.length > 0 && (
                  <>
                    <div style={{ maxHeight: '150px', overflow: 'auto', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                      {lastImportReport.errors.slice(0, 30).map((err, idx) => (
                        <div key={idx}>
                          Row {err.row} ({err.plate || 'blank'}): {err.error}
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="lv-secondary"
                      onClick={() =>
                        triggerCsvDownload(
                          ['row', 'plate', 'error'],
                          lastImportReport.errors.map((er) => [er.row, er.plate, er.error]),
                          'registry_import_errors.csv',
                        )
                      }
                    >
                      Download error report CSV ({lastImportReport.errors.length})
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Manual Single Vehicle Registration */}
          <div className="lv-card" style={{ marginBlock: 0 }}>
            <h3>Manual Vehicle Registration</h3>
            <form onSubmit={saveManualVehicle}>
              <label>
                Number plate
                <input name="plate" maxLength={20} placeholder="e.g. KJA492AX" required />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <label>
                  Make
                  <input name="make" maxLength={60} placeholder="Toyota" />
                </label>
                <label>
                  Model
                  <input name="model" maxLength={60} placeholder="Camry" />
                </label>
                <label>
                  Colour
                  <input name="colour" maxLength={60} placeholder="Black" />
                </label>
                <label>
                  Vehicle type
                  <input name="vehicle_type" maxLength={60} placeholder="Car / Truck / Bus" />
                </label>
                <label>
                  Year
                  <input name="year" type="number" min={1900} max={2100} placeholder="2022" />
                </label>
                <label>
                  Registration status
                  <select name="registration_status" defaultValue="registered">
                    <option value="registered">Registered</option>
                    <option value="expired">Expired</option>
                    <option value="unregistered">Unregistered</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
              </div>
              <label>
                Notes
                <input name="notes" maxLength={1000} placeholder="Optional fleet or licensing note" />
              </label>
              <button type="submit" disabled={busy}>
                Save vehicle to registry
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Search & Registry Records Table */}
      <div style={{ marginTop: '1.25rem' }}>
        <h3>Registered Vehicles ({filteredVehicles.length})</h3>
        <div className="lv-observation-filters">
          <label>
            Search by plate, make, model, or source
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search KJA492AX, Toyota, Hilux..."
            />
          </label>
          <label>
            Registration status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="registered">Registered</option>
              <option value="expired">Expired</option>
              <option value="unregistered">Unregistered</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
        </div>

        {loading ? (
          <p>Loading vehicle registry…</p>
        ) : filteredVehicles.length === 0 ? (
          <p>No registry vehicles match this search.</p>
        ) : (
          <div className="lv-observation-table" style={{ marginTop: '0.75rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Make / Model</th>
                  <th>Colour / Type</th>
                  <th>Year</th>
                  <th>Status</th>
                  <th>Source</th>
                  {canWrite && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.slice(0, 150).map((v) => (
                  <tr key={v.id}>
                    <td>
                      <strong>{v.plate}</strong>
                    </td>
                    <td>
                      {[v.make, v.model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td>
                      {[v.colour, v.vehicle_type].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td>{v.vehicle_year || '—'}</td>
                    <td>
                      <span className="lv-badge">{v.registration_status}</span>
                    </td>
                    <td>{v.source_name}</td>
                    {canWrite && (
                      <td>
                        <button
                          type="button"
                          className="lv-secondary"
                          disabled={busy}
                          onClick={() => void deleteVehicle(v.id, v.plate)}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import History */}
      {imports.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3>Import &amp; Synchronization History</h3>
          <div className="lv-observation-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>File</th>
                  <th>Mode</th>
                  <th>Inserted</th>
                  <th>Updated</th>
                  <th>Duplicates</th>
                  <th>Invalid</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((imp) => (
                  <tr key={imp.id}>
                    <td>{new Date(imp.created_at).toLocaleString()}</td>
                    <td>{imp.source_name}</td>
                    <td>{imp.file_name || '—'}</td>
                    <td>{imp.update_existing ? 'Sync & insert' : 'Insert only'}</td>
                    <td>{imp.inserted_rows}</td>
                    <td>{imp.updated_rows}</td>
                    <td>{imp.duplicate_rows}</td>
                    <td>{imp.invalid_rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* External Registry Integration Architecture Note */}
      <div className="lv-card" style={{ marginTop: '1.25rem', background: '#0c131b' }}>
        <h3>External Vehicle Registration Database Connector (Architecture Ready)</h3>
        <p>
          External real-time government/licensing lookups (e.g. authorized FRSC / MVAA APIs) require an external
          credentials gateway. Automated ETL or Edge Function connectors can push synchronized records directly into
          this workspace using the authenticated `lv_import_registry` / `lv_registry_apply_row` pipeline with full
          duplicate detection and audit logging.
        </p>
      </div>
    </section>
  );
}

