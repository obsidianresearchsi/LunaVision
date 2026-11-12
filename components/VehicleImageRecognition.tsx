import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Car, CheckCircle, ShieldAlert, Upload } from 'lucide-react';
import {
  VehicleRecognitionResult,
  VehicleReportIntent,
  analyzeVehicleImage,
} from '../services/vehicleVision';

export default function VehicleImageRecognition({
  workspaceId,
  onPrefillWatchlistPlate,
  onAlertsChanged,
}: {
  workspaceId: string;
  onPrefillWatchlistPlate?: (plate: string, vehicleInfo: { colour?: string; vehicleClass?: string }) => void;
  onAlertsChanged?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [intent, setIntent] = useState<VehicleReportIntent>('auto_check');
  const [manualHint, setManualHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<VehicleRecognitionResult | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleSelectFile(files: FileList | null) {
    const file = files?.[0] || null;
    if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(file && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);
    setResult(null);
    setError('');
  }

  async function runRecognition(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      setError('Upload a vehicle photograph first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const analysis = await analyzeVehicleImage(selectedFile, {
        workspaceId,
        intent,
        manualPlateHint: manualHint,
        cameraName: 'Vehicle Image Recognition Desk',
      });
      setResult(analysis);
      onAlertsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vehicle image recognition failed.');
    } finally {
      setBusy(false);
    }
  }

  const verdictStyle = (v: VehicleRecognitionResult['statusVerdict']) => {
    if (v === 'stolen_or_wanted' || v === 'weapon_threat') {
      return { border: '#ef4444', bg: 'rgba(127, 29, 29, 0.32)', badge: 'high' };
    }
    if (v === 'watchlist_interest' || v === 'unregistered_or_expired' || v === 'suspicious_flag') {
      return { border: '#f59e0b', bg: 'rgba(120, 53, 15, 0.28)', badge: 'medium' };
    }
    return { border: '#2dd4bf', bg: 'rgba(11, 34, 41, 0.45)', badge: 'info' };
  };

  return (
    <section
      className="lv-card"
      aria-label="Vehicle image recognition"
      style={{ marginTop: '1rem', borderColor: '#243547', background: '#091017' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Car size={18} aria-hidden="true" /> Vehicle Image Recognition (Stolen / Threat / Plate Scan)
          </h3>
          <small style={{ color: '#94a3b8' }}>
            Upload a vehicle photo to classify vehicle type &amp; exterior colour, detect visible weapons/threats, extract
            license plates via OCR, and cross-check active stolen/wanted watchlists &amp; registry records.
          </small>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
          gap: '1rem',
          marginTop: '0.85rem',
          alignItems: 'start',
        }}
      >
        <form onSubmit={(e) => void runRecognition(e)}>
          <label>
            Vehicle photograph (JPEG, PNG, WebP)
            <input
              ref={fileInputRef}
              name="vehicle_photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => handleSelectFile(e.target.files)}
            />
          </label>
          <label>
            Incident / inspection classification
            <select
              name="vehicle_intent"
              value={intent}
              disabled={busy}
              onChange={(e) => setIntent(e.target.value as VehicleReportIntent)}
            >
              <option value="auto_check">Auto-check (Watchlist, Registry, Weapons &amp; Type)</option>
              <option value="suspected_stolen">Suspected Stolen Vehicle</option>
              <option value="wanted_escape">Wanted / Getaway Suspect Vehicle</option>
              <option value="damaged_accident">Damaged / Hit-and-Run Vehicle</option>
              <option value="abandoned_suspicious">Abandoned / Suspicious Vehicle</option>
            </select>
          </label>
          <label>
            Plate hint if partially obscured (optional)
            <input
              name="plate_hint"
              value={manualHint}
              onChange={(e) => setManualHint(e.target.value)}
              placeholder="e.g. KJA-492-AX"
              maxLength={20}
              disabled={busy}
            />
          </label>
          <div className="lv-video-actions">
            <button type="submit" disabled={busy || !selectedFile}>
              {busy ? 'Analyzing vehicle image…' : 'Analyze vehicle image'}
            </button>
          </div>
          {error && <p role="alert" style={{ color: '#ff8b89' }}>{error}</p>}
        </form>

        <aside
          aria-label="Vehicle photo preview"
          className="lv-card"
          style={{
            background: '#0c131b',
            border: '1px solid #354858',
            minHeight: '190px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.88rem' }}>Uploaded Vehicle Preview</strong>
            {selectedFile && (
              <button
                type="button"
                className="lv-secondary"
                style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                onClick={() => {
                  if (fileInputRef.current) fileInputRef.current.value = '';
                  handleSelectFile(null);
                }}
              >
                Clear
              </button>
            )}
          </div>
          {selectedFile ? (
            <div>
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt={`Uploaded vehicle preview: ${selectedFile.name}`}
                  style={{ width: '100%', maxHeight: '210px', objectFit: 'contain', borderRadius: '6px', border: '1px solid #76efd6' }}
                />
              )}
              <div style={{ marginTop: '0.45rem', display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                <span className="lv-badge">{selectedFile.name}</span>
                <span className="lv-badge">{Math.max(1, Math.round(selectedFile.size / 1024))} KB</span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                flex: 1,
                minHeight: '140px',
                background: 'transparent',
                border: '1px dashed #354858',
                borderRadius: '6px',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
              }}
            >
              <Upload size={18} />
              <span>Upload a vehicle photo to preview &amp; run stolen/plate/threat recognition</span>
            </button>
          )}
        </aside>
      </div>

      {result && (
        <div
          role="status"
          className="lv-card"
          style={{
            marginTop: '0.85rem',
            border: `2px solid ${verdictStyle(result.statusVerdict).border}`,
            background: verdictStyle(result.statusVerdict).bg,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '1.05rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              {result.statusVerdict === 'cleared' ? (
                <CheckCircle size={18} color="#2dd4bf" />
              ) : result.statusVerdict === 'weapon_threat' ? (
                <ShieldAlert size={18} color="#ef4444" />
              ) : (
                <AlertTriangle size={18} color="#f59e0b" />
              )}
              {result.summary}
            </strong>
            <span className={`lunar-badge ${verdictStyle(result.statusVerdict).badge}`} style={{ fontWeight: 800 }}>
              {result.statusVerdict.replace(/_/g, ' ').toUpperCase()}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
            <span className="lv-badge" style={{ fontWeight: 700 }}>
              Type: {result.vehicleClass.toUpperCase()} ({result.vehicleConfidence || 0}%)
            </span>
            <span className="lv-badge" style={{ fontWeight: 700 }}>
              Colour: {result.dominantColor}
            </span>
            <span className="lv-badge" style={{ fontWeight: 800, fontFamily: 'monospace' }}>
              Plate: {result.extractedPlate || 'Not read'}
            </span>
            {result.weaponsDetected.length > 0 && (
              <span className="lunar-badge high" style={{ fontWeight: 800 }}>
                WEAPONS: {result.weaponsDetected.map((w) => w.label).join(', ')}
              </span>
            )}
          </div>

          <p style={{ margin: '0.55rem 0 0', fontSize: '0.88rem' }}>
            <strong>Recommended Action:</strong> {result.recommendedAction}
          </p>

          {result.watchlistMatch && (
            <div className="lv-card" style={{ marginTop: '0.6rem', background: '#1b0b0e', borderColor: '#ef4444' }}>
              <strong>MATCHED ACTIVE WATCHLIST RECORD: {result.watchlistMatch.plate}</strong>
              <p style={{ margin: '0.25rem 0' }}>
                Reason: <strong>{result.watchlistMatch.reason}</strong> · Case: <strong>{result.watchlistMatch.case_reference}</strong> ·{' '}
                {[result.watchlistMatch.colour, result.watchlistMatch.make, result.watchlistMatch.model].filter(Boolean).join(' ')}
              </p>
            </div>
          )}

          {result.attributeCandidates.length > 0 && !result.watchlistMatch && (
            <div className="lv-card" style={{ marginTop: '0.6rem', background: '#0c131b', borderColor: '#f59e0b' }}>
              <strong>Same-Colour ({result.dominantColor}) Active Watchlist Vehicles:</strong>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                {result.attributeCandidates.map((c) => (
                  <span key={c.id} className="lv-badge">
                    <Camera size={12} style={{ marginRight: '3px' }} />
                    {c.plate} · {c.reason} ({c.colour} {c.make} {c.model})
                  </span>
                ))}
              </div>
            </div>
          )}

          {onPrefillWatchlistPlate && result.extractedPlate && !result.watchlistMatch && (
            <div className="lv-video-actions" style={{ marginTop: '0.65rem' }}>
              <button
                type="button"
                onClick={() =>
                  onPrefillWatchlistPlate(result.extractedPlate!, {
                    colour: result.dominantColor,
                    vehicleClass: result.vehicleClass,
                  })
                }
              >
                Flag {result.extractedPlate} on Vehicle Watchlist
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

