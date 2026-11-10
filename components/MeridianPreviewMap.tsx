import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { LocateFixed } from 'lucide-react';
import { commandBasemap } from '../services/mapConfig';

const cameras: { id: string; name: string; position: L.LatLngTuple; heading: number }[] = [
  { id: 'CAM-017', name: 'North Gate', position: [6.4461, 3.3738], heading: 120 },
  { id: 'CAM-024', name: 'Container Yard', position: [6.4437, 3.3725], heading: 74 },
  { id: 'CAM-041', name: 'Berth 02', position: [6.4429, 3.3766], heading: 194 },
  { id: 'CAM-033', name: 'Truck Checkpoint', position: [6.4454, 3.3715], heading: 285 },
];

const restrictedZone: L.LatLngTuple[] = [
  [6.4470, 3.3728], [6.4472, 3.3744], [6.4466, 3.3750],
  [6.4455, 3.3746], [6.4453, 3.3730], [6.4460, 3.3725],
];
const northGate = cameras[0];
const siteBounds = L.latLngBounds([...cameras.map(camera => camera.position), ...restrictedZone]);
const fitOptions: L.FitBoundsOptions = { padding: [42, 42], maxZoom: 17, animate: false };

function cameraCoverage([lat, lng]: L.LatLngTuple, heading: number): L.LatLngTuple[] {
  const footprint: L.LatLngTuple[] = [[lat, lng]];
  const range = 115 / 111320;
  for (let offset = -30; offset <= 30; offset += 10) {
    const angle = (heading + offset) * Math.PI / 180;
    footprint.push([lat + range * Math.cos(angle), lng + range * Math.sin(angle) / Math.cos(lat * Math.PI / 180)]);
  }
  return footprint;
}

function popupContent(title: string, description: string, label?: string, action?: () => void) {
  const popup = document.createElement('div');
  popup.className = 'lunar-map-popup';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const caption = document.createElement('small');
  caption.textContent = description;
  popup.append(heading, caption);
  if (label && action) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'lunar-button lunar-primary';
    open.textContent = label;
    open.onclick = action;
    popup.append(open);
  }
  return popup;
}

export function MeridianPreviewMap({ onCamera, onAlert, onZone, priorityActive = true }: {
  onCamera: (index: number) => void;
  onAlert: () => void;
  onZone: () => void;
  priorityActive?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<L.Map | null>(null);
  const priorityLayer = useRef<L.LayerGroup | null>(null);
  const actions = useRef({ onCamera, onAlert, onZone });
  const [tilesUnavailable, setTilesUnavailable] = useState(false);

  useEffect(() => {
    actions.current = { onCamera, onAlert, onZone };
  }, [onCamera, onAlert, onZone]);

  useEffect(() => {
    if (!host.current) return;
    const map = L.map(host.current, { zoomControl: false, scrollWheelZoom: false, zoomAnimation: false });
    instance.current = map;
    map.setView(siteBounds.getCenter(), 16);
    let fitted = false;
    const fitWhenVisible = () => {
      if (!host.current?.clientWidth || !host.current.clientHeight) return;
      map.invalidateSize({ pan: false });
      if (!fitted) {
        map.fitBounds(siteBounds, fitOptions);
        fitted = true;
      }
    };
    fitWhenVisible();

    let tileLoaded = false;
    L.tileLayer(commandBasemap.url, commandBasemap.options)
      .on('tileerror', () => { if (!tileLoaded) setTilesUnavailable(true); })
      .on('tileload', () => { tileLoaded = true; setTilesUnavailable(false); })
      .addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

    const zones = L.layerGroup().addTo(map);
    const coverage = L.layerGroup().addTo(map);
    const devices = L.layerGroup().addTo(map);
    const alerts = L.layerGroup();
    priorityLayer.current = alerts;

    L.polygon(restrictedZone, { color: '#ff8b89', fillColor: '#c06365', fillOpacity: 0.12, className: 'lunar-restricted-zone', dashArray: '6 5', weight: 1.7 })
      .bindTooltip('Z-04 / RESTRICTED', { permanent: true, direction: 'center', className: 'lunar-zone-tooltip', offset: [0, -29] })
      .bindPopup(popupContent('North Gate · Restricted zone Z-04', 'Sample geofence for the after-hours perimeter rule.', 'Open zone rule', () => {
        actions.current.onZone();
      }))
      .addTo(zones);

    cameras.forEach((camera, index) => {
      L.polygon(cameraCoverage(camera.position, camera.heading), {
        color: '#76efd6', fillColor: '#76efd6', fillOpacity: 0.21, className: 'lunar-camera-coverage', weight: 1, interactive: false,
      }).addTo(coverage);
      L.marker(camera.position, {
        title: camera.name,
        alt: camera.name,
        icon: L.divIcon({
          className: 'lunar-demo-marker',
          html: '<span aria-hidden="true"></span>',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      }).addTo(devices)
        .bindTooltip(camera.name, { permanent: true, direction: 'right', className: index === 0 ? 'lunar-camera-tooltip lunar-camera-tooltip-primary' : 'lunar-camera-tooltip', offset: [13, 0] })
        .bindPopup(popupContent(camera.name, camera.id + ' · Sample camera', 'Open sample camera', () => actions.current.onCamera(index)));
    });

    for (const radius of [23, 43, 69]) {
      L.circle(northGate.position, { radius, interactive: false, fill: false, color: '#ff8b89', opacity: 0.61, weight: 1 })
        .addTo(alerts);
    }
    L.marker([6.44626, 3.3736], {
      title: 'North Gate priority alert',
      alt: 'North Gate priority alert',
      zIndexOffset: 200,
      icon: L.divIcon({ className: 'lunar-demo-marker lunar-demo-marker-alert', html: '<span aria-hidden="true"></span>', iconSize: [23, 23], iconAnchor: [12, 12] }),
    }).addTo(alerts)
      .bindPopup(popupContent('Perimeter intrusion', 'High priority · North Gate / Z-04', 'Open sample alert', () => actions.current.onAlert()));

    L.control.layers(undefined, {
      Cameras: devices, 'Camera coverage': coverage, 'Restricted zone': zones, 'Priority alerts': alerts,
    }, { position: 'bottomright' }).addTo(map);

    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fitWhenVisible);
    observer?.observe(host.current);
    return () => {
      observer?.disconnect();
      instance.current = null;
      priorityLayer.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = instance.current;
    const alerts = priorityLayer.current;
    if (map && alerts) {
      if (priorityActive) map.addLayer(alerts);
      else map.removeLayer(alerts);
    }
  }, [priorityActive]);

  return <section className="lunar-panel lunar-preview-map" aria-label="Interactive Meridian Port preview map">
    <div className="lunar-preview-map-canvas" ref={host} aria-label="Map of Lagos Harbour with fictional site layers" />
    <div className="lunar-preview-map-label"><strong>Meridian Port</strong><small>Lagos Harbour · Sample site</small></div>
    <span className="lunar-map-north" aria-label="North is up"><span aria-hidden="true">▲</span>N</span>
    <button className="lunar-icon lunar-map-recenter" aria-label="Fit sample site" title="Fit sample site"
      onClick={() => instance.current?.fitBounds(siteBounds, fitOptions)}><LocateFixed size={17} /></button>
    {tilesUnavailable && <span className="lunar-preview-map-status" role="status">Basemap tiles unavailable</span>}
  </section>;
}

