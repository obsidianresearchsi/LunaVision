import { describe, expect, it } from 'vitest';
import {
  PlateConsensusBuffer,
  VideoIntelligenceTracker,
  crossedCountLine,
  defaultCameraIntelSettings,
  isValidNormalizedPlate,
  isWithinOperatingSchedule,
  normalizeCameraIntelSettings,
  normalizePlate,
  parseCsvRows,
  parseSubjectMigrationFile,
  parseWatchlistImportFile,
  pointInPolygon,
  roleCan,
} from './videoIntelligence';

describe('videoIntelligence service', () => {
  it('normalizes and validates vehicle plates across formatting variants', () => {
    expect(normalizePlate(' kja - 492 ax ')).toBe('KJA492AX');
    expect(normalizePlate('ABJ 123 zz')).toBe('ABJ123ZZ');
    expect(isValidNormalizedPlate(normalizePlate('kja-492-ax'))).toBe(true);
    expect(isValidNormalizedPlate(normalizePlate('!@#'))).toBe(false);
    expect(isValidNormalizedPlate(normalizePlate('A'))).toBe(false);
  });

  it('enforces operating schedules including overnight ranges', () => {
    const monTenAm = new Date(2026, 10, 9, 10, 0); // Monday Nov 9 2026 10:00
    expect(
      isWithinOperatingSchedule({ enabled: true, days: [1, 2, 3], start: '08:00', end: '18:00' }, monTenAm),
    ).toBe(true);
    expect(
      isWithinOperatingSchedule({ enabled: true, days: [0, 6], start: '08:00', end: '18:00' }, monTenAm),
    ).toBe(false);

    const lateNight = new Date(2026, 10, 9, 23, 30);
    expect(
      isWithinOperatingSchedule({ enabled: true, days: [1], start: '22:00', end: '06:00' }, lateNight),
    ).toBe(true);
  });

  it('computes polygon inclusion and directional count-line crossings', () => {
    const square: [number, number][] = [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ];
    expect(pointInPolygon([0.5, 0.5], square)).toBe(true);
    expect(pointInPolygon([0.1, 0.1], square)).toBe(false);

    const line: [number, number][] = [
      [0.1, 0.5],
      [0.9, 0.5],
    ];
    expect(crossedCountLine([0.5, 0.4], [0.5, 0.6], line, 'down')).toBe('in');
    expect(crossedCountLine([0.5, 0.6], [0.5, 0.4], line, 'down')).toBe('out');
    expect(crossedCountLine([0.5, 0.2], [0.5, 0.3], line, 'down')).toBeNull();
  });

  it('enforces the 5-tier RBAC permission hierarchy', () => {
    expect(roleCan('owner', 'watchlist_delete')).toBe(true);
    expect(roleCan('admin', 'configure')).toBe(true);
    expect(roleCan('supervisor', 'configure')).toBe(false);
    expect(roleCan('supervisor', 'watchlist_archive')).toBe(true);
    expect(roleCan('supervisor', 'registry_write')).toBe(true);
    expect(roleCan('supervisor', 'watchlist_delete')).toBe(false);
    expect(roleCan('investigator', 'watchlist_write')).toBe(true);
    expect(roleCan('investigator', 'watchlist_archive')).toBe(false);
    expect(roleCan('member', 'watchlist_write')).toBe(false);
    expect(roleCan('member', 'alert_ack')).toBe(true);
  });

  it('strips agency-only capabilities when normalizing business camera settings', () => {
    const normalized = normalizeCameraIntelSettings(
      {
        capabilities: {
          anpr: { enabled: true, sensitivity: 'high' },
          people_counting: { enabled: true, sensitivity: 'medium' },
        },
        notify: { categories: ['crowd', 'watchlist_match'] },
      },
      false,
    );
    expect(normalized.capabilities.anpr.enabled).toBe(false);
    expect(normalized.capabilities.people_counting.enabled).toBe(true);
    expect(normalized.notify.categories).not.toContain('watchlist_match');
  });

  it('tracks people, line crossings, restricted intrusion, abandoned objects, stationary vehicles & tampering', () => {
    const tracker = new VideoIntelligenceTracker();
    const settings = defaultCameraIntelSettings(true);
    settings.capabilities.loitering.enabled = true;
    settings.capabilities.vehicle_stationary.enabled = true;
    settings.capabilities.abandoned_object.enabled = true;
    settings.capabilities.tamper.enabled = true;
    settings.thresholds.crowd_max = 2;
    settings.thresholds.loiter_seconds = 10;
    settings.thresholds.stationary_seconds = 30;
    settings.thresholds.abandoned_seconds = 15;
    settings.zones = [
      { id: 'gate', name: 'Main Gate', kind: 'count_line', points: [[0, 0.5], [1, 0.5]], direction: 'down' },
      { id: 'vault', name: 'Vault', kind: 'restricted', points: [[0.6, 0.6], [0.9, 0.6], [0.9, 0.9], [0.6, 0.9]] },
    ];

    const t0 = 1_700_000_000_000;
    // Frame 1: person above line, 1 car, 1 backpack far away
    const r1 = tracker.processFrame({
      detections: [
        { class: 'person', score: 0.9, bbox: [100, 120, 40, 80] }, // norm center y = (120+40)/400 = 0.4
        { class: 'car', score: 0.92, bbox: [300, 100, 100, 60] },
        { class: 'backpack', score: 0.85, bbox: [50, 300, 30, 30] },
      ],
      frameWidth: 800,
      frameHeight: 400,
      settings,
      cameraId: 'cam-1',
      source: 'camera',
      nowMs: t0,
      tamperCheck: { tampered: false, reason: null, signature: [100, 100] },
    });
    expect(r1.summary.peopleCurrent).toBe(1);
    expect(r1.summary.vehiclesCurrent).toBe(1);
    expect(r1.summary.vehicleByType.car).toBe(1);

    // Frame 2: person moves across gate line -> entry count increments
    const r2 = tracker.processFrame({
      detections: [
        { class: 'person', score: 0.9, bbox: [100, 170, 40, 80] }, // norm center y = 210/400 = 0.525
        { class: 'car', score: 0.92, bbox: [300, 100, 100, 60] },
        { class: 'backpack', score: 0.85, bbox: [50, 300, 30, 30] },
      ],
      frameWidth: 800,
      frameHeight: 400,
      settings,
      cameraId: 'cam-1',
      source: 'camera',
      nowMs: t0 + 1000,
      tamperCheck: { tampered: false, reason: null, signature: [100, 100] },
    });
    expect(r2.summary.peopleEntered).toBe(1);
    expect(r2.events.some((e) => e.category === 'line_crossing' && e.direction === 'in')).toBe(true);

    // Continuous frames from +2s to +32s: second person enters restricted zone while first person/car/backpack remain stationary
    const emittedCategories = new Set<string>();
    for (let sec = 2; sec <= 32; sec++) {
      const res = tracker.processFrame({
        detections: [
          { class: 'person', score: 0.9, bbox: [100, 170, 40, 80] },
          { class: 'person', score: 0.88, bbox: [560, 260, 40, 80] }, // inside vault (norm center 0.725, 0.75)
          { class: 'car', score: 0.92, bbox: [300, 100, 100, 60] },
          { class: 'backpack', score: 0.85, bbox: [50, 300, 30, 30] },
        ],
        frameWidth: 800,
        frameHeight: 400,
        settings,
        cameraId: 'cam-1',
        source: 'camera',
        nowMs: t0 + sec * 1000,
        tamperCheck: sec === 32 ? { tampered: true, reason: 'Lens covered', signature: [0, 0] } : { tampered: false, reason: null, signature: [100, 100] },
      });
      for (const e of res.events) emittedCategories.add(e.category);
    }
    expect(emittedCategories.has('crowd')).toBe(true);
    expect(emittedCategories.has('intrusion')).toBe(true);
    expect(emittedCategories.has('loitering')).toBe(true);
    expect(emittedCategories.has('stationary_vehicle')).toBe(true);
    expect(emittedCategories.has('abandoned_object')).toBe(true);

    // Consecutive tamper frame triggers tamper event
    const r4 = tracker.processFrame({
      detections: [],
      frameWidth: 800,
      frameHeight: 400,
      settings,
      cameraId: 'cam-1',
      source: 'camera',
      nowMs: t0 + 33000,
      tamperCheck: { tampered: true, reason: 'Lens covered', signature: [0, 0] },
    });
    expect(r4.summary.tampered).toBe(true);
    expect(r4.events.some((e) => e.category === 'tamper')).toBe(true);
  });

  it('parses quoted CSV data reliably', () => {
    const rows = parseCsvRows('plate,make,notes\n"KJA-492-AX",Toyota,"White, fleet vehicle"\nABJ 111 ZZ,Honda,Clean');
    expect(rows.length).toBe(3);
    expect(rows[1]).toEqual(['KJA-492-AX', 'Toyota', 'White, fleet vehicle']);
  });

  it('requires multi-frame ANPR consensus for medium-confidence reads and passes crisp reads immediately', () => {
    const buffer = new PlateConsensusBuffer(4000);
    // Low confidence rejected
    expect(buffer.push('LAG-123-AA', 35, 1000).confirmed).toBeNull();
    // Medium confidence needs 2 reads
    expect(buffer.push('LAG 123 AA', 68, 1500)).toEqual({ confirmed: null, bestConfidence: 68, votes: 1 });
    expect(buffer.push('LAG-123-AA', 71, 2200)).toEqual({ confirmed: 'LAG123AA', bestConfidence: 71, votes: 2 });

    buffer.reset();
    // Crisp high-confidence read confirms on first frame
    expect(buffer.push('ABJ-901-KL', 84, 3000)).toEqual({ confirmed: 'ABJ901KL', bestConfidence: 84, votes: 1 });
  });

  it('parses bulk vehicle watchlist CSV and criminal subject migration CSV accurately', async () => {
    const wlCsv = new File(
      ['plate,category,case_reference,make,model,colour,status,description,notes,photo_filename\n"LAG-123-AA",stolen,CR-2026-101,Toyota,Hilux,White,active,"Snatched at port",Dispatch team,LAG123AA.jpg'],
      'watchlist.csv',
      { type: 'text/csv' },
    );
    const wlRows = await parseWatchlistImportFile(wlCsv);
    expect(wlRows).toHaveLength(1);
    expect(wlRows[0]).toEqual(
      expect.objectContaining({
        plate: 'LAG-123-AA',
        category: 'stolen',
        case_reference: 'CR-2026-101',
        photo_filename: 'LAG123AA.jpg',
      }),
    );

    const subCsv = new File(
      ['subject_code,full_name,aliases,category,threat_level,offense_summary,warrant_reference,case_reference,photo_filename\nAFIS-1042,Musa Danladi,"Bala",wanted,high,Armed robbery syndicate,WR-44,CR-88,AFIS-1042.jpg'],
      'subjects.csv',
      { type: 'text/csv' },
    );
    const subRows = await parseSubjectMigrationFile(subCsv);
    expect(subRows).toHaveLength(1);
    expect(subRows[0]).toEqual(
      expect.objectContaining({
        subject_code: 'AFIS-1042',
        full_name: 'Musa Danladi',
        category: 'wanted',
        threat_level: 'high',
        warrant_reference: 'WR-44',
        photo_filename: 'AFIS-1042.jpg',
      }),
    );
  });
});
