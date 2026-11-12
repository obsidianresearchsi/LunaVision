export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const CITY_COORDS: Record<string, GeoPoint> = {
  lagos: { latitude: 6.5244, longitude: 3.3792 },
  ikeja: { latitude: 6.6018, longitude: 3.3515 },
  apapa: { latitude: 6.4488, longitude: 3.359 },
  victoria: { latitude: 6.4281, longitude: 3.4219 },
  abuja: { latitude: 9.0765, longitude: 7.3986 },
  kuje: { latitude: 8.8797, longitude: 7.2275 },
  kano: { latitude: 12.0022, longitude: 8.592 },
  'port harcourt': { latitude: 4.8156, longitude: 7.0498 },
  ibadan: { latitude: 7.3775, longitude: 3.947 },
  enugu: { latitude: 6.4584, longitude: 7.5464 },
  kaduna: { latitude: 10.5105, longitude: 7.4165 },
  benin: { latitude: 6.335, longitude: 5.6037 },
  maiduguri: { latitude: 11.8311, longitude: 13.151 },
  calabar: { latitude: 4.9757, longitude: 8.3417 },
  jos: { latitude: 9.8965, longitude: 8.8583 },
  owerri: { latitude: 5.4891, longitude: 7.0176 },
  warri: { latitude: 5.516, longitude: 5.75 },
  uyo: { latitude: 5.0377, longitude: 7.9128 },
  abeokuta: { latitude: 7.1475, longitude: 3.3619 },
  onitsha: { latitude: 6.1498, longitude: 6.7857 },
  ilorin: { latitude: 8.4799, longitude: 4.5418 },
  zaria: { latitude: 11.0855, longitude: 7.7199 },
  sokoto: { latitude: 13.0059, longitude: 5.2476 },
  yola: { latitude: 9.2035, longitude: 12.4954 },
  asaba: { latitude: 6.2059, longitude: 6.6959 },
  makurdi: { latitude: 7.7322, longitude: 8.5391 },
  akure: { latitude: 7.2571, longitude: 5.2058 },
  lokoja: { latitude: 7.7969, longitude: 6.7405 },
  minna: { latitude: 9.5836, longitude: 6.5463 },
  bauchi: { latitude: 10.301, longitude: 9.8237 },
  gombe: { latitude: 10.2897, longitude: 11.1673 },
  katsina: { latitude: 12.9816, longitude: 7.6223 },
};

const COORD_TAG_RE = /\s*\[(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\]\s*$/;

export function stripLocationCoords(raw: string | null | undefined): string {
  return String(raw || '').replace(COORD_TAG_RE, '').trim();
}

export function formatLocationWithCoords(text: string | null | undefined, pos: GeoPoint | null | undefined): string {
  const clean = stripLocationCoords(text);
  if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) return clean;
  const tag = `[${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}]`;
  return clean ? `${clean} ${tag}`.slice(0, 240) : tag;
}

export function parseSubjectLocation(
  rawLocation: string | null | undefined,
  explicitLat?: number | null,
  explicitLng?: number | null,
): { latitude: number | null; longitude: number | null; displayLocation: string; approximate: boolean } {
  const displayLocation = stripLocationCoords(rawLocation);
  if (
    explicitLat !== null &&
    explicitLat !== undefined &&
    explicitLng !== null &&
    explicitLng !== undefined &&
    Number.isFinite(Number(explicitLat)) &&
    Number.isFinite(Number(explicitLng))
  ) {
    return {
      latitude: Number(explicitLat),
      longitude: Number(explicitLng),
      displayLocation,
      approximate: false,
    };
  }

  const tagMatch = String(rawLocation || '').match(COORD_TAG_RE);
  if (tagMatch) {
    const lat = Number(tagMatch[1]);
    const lng = Number(tagMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { latitude: lat, longitude: lng, displayLocation, approximate: false };
    }
  }

  const lower = displayLocation.toLowerCase();
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (lower.includes(city)) {
      return { latitude: coords.latitude, longitude: coords.longitude, displayLocation, approximate: true };
    }
  }

  return { latitude: null, longitude: null, displayLocation, approximate: false };
}

