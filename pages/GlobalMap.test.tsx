import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraStatus } from '../types';

vi.mock('../services/supabaseDb', () => ({ supabaseDb: {
  getSuspects: vi.fn().mockResolvedValue([
    { faceToken: 'wanted', name: 'Wanted subject', crime: 'Test', nin: '1', location: 'Abuja', imageUrl: '', sourceUrl: 'police_db', status: 'WANTED', coordinates: { lat: 9, lng: 7 } },
    { faceToken: 'cleared', name: 'Cleared subject', crime: 'Test', nin: '2', location: 'Lagos', imageUrl: '', sourceUrl: 'police_db', status: 'CLEARED', coordinates: { lat: 6, lng: 3 } }
  ])
} }));
vi.mock('../services/cameraService', () => ({ getCameras: vi.fn().mockResolvedValue([
  { id: 'camera-1', name: 'Test camera', description: '', streamUrl: '', status: CameraStatus.ONLINE, coordinates: { lat: 8, lng: 4 } }
]) }));
vi.mock('leaflet', () => ({ default: (globalThis as any).L }));
vi.mock('../components/CameraFeedModal', () => ({ CameraFeedModal: () => null }));
vi.mock('../services/mapConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/mapConfig')>();
  return { ...actual, basemap: actual.getBasemap('pk.test-token') };
});

describe('GlobalMap basemap and overlay preservation', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    container?.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses Mapbox tiles while retaining HQ, subject filters, cameras, and zoom controls', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const map = { setView: vi.fn().mockReturnThis(), remove: vi.fn(), fitBounds: vi.fn(), on: vi.fn(), off: vi.fn(), stop: vi.fn() };
    const marker = () => ({ addTo: vi.fn().mockReturnThis(), bindPopup: vi.fn().mockReturnThis(), remove: vi.fn() });
    const leaflet = {
      map: vi.fn(() => map), tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
      marker: vi.fn(marker), divIcon: vi.fn(value => value),
      control: { zoom: vi.fn(() => ({ addTo: vi.fn() })) },
      featureGroup: vi.fn(() => ({ getBounds: () => ({ pad: () => 'bounds' }) }))
    };
    vi.stubGlobal('L', leaflet);
    const { GlobalMap } = await import('./GlobalMap');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<GlobalMap />));
    expect(leaflet.tileLayer).toHaveBeenLastCalledWith(
      expect.stringContaining('satellite-streets-v12/tiles/512/{z}/{x}/{y}?access_token=pk.test-token'),
      expect.objectContaining({ tileSize: 512, zoomOffset: -1, maxZoom: 19, attribution: expect.stringContaining('Mapbox') })
    );
    expect(leaflet.map).toHaveBeenLastCalledWith(expect.anything(), { zoomControl: false, attributionControl: true });
    expect(map.setView).toHaveBeenCalledWith([9.0765, 7.3986], 6);
    expect(leaflet.control.zoom).toHaveBeenCalledWith({ position: 'bottomright' });
    for (const coordinates of [[9, 7], [6, 3], [8, 4]]) {
      expect(leaflet.marker).toHaveBeenCalledWith(coordinates, expect.anything());
    }
    leaflet.marker.mockClear();
    const wantedFilter = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('WANTED (HVT)'));
    expect(wantedFilter).toBeTruthy();
    await act(async () => wantedFilter!.click());
    expect(leaflet.marker).toHaveBeenCalledWith([9, 7], expect.anything());
    expect(leaflet.marker).not.toHaveBeenCalledWith([6, 3], expect.anything());
    expect(leaflet.marker).toHaveBeenCalledWith([8, 4], expect.anything());
    expect(leaflet.map).toHaveBeenCalledOnce();
    expect(leaflet.tileLayer).toHaveBeenCalledOnce();
  });

  it('retains the previous basemap when no Mapbox token is configured', async () => {
    const { getBasemap } = await import('../services/mapConfig');
    const basemap = getBasemap('');
    expect(basemap.url).toContain('basemaps.cartocdn.com');
    expect(basemap.options).toMatchObject({ subdomains: 'abcd', maxZoom: 19 });
  });
});
