/**
 * Case conversion utilities for converting between TypeScript camelCase
 * and PostgreSQL snake_case column names.
 * 
 * Handles:
 * - Nested objects and arrays
 * - Coordinates object flattening (coordinates: {lat, lng} -> coordinates_lat, coordinates_lng)
 */

/**
 * Converts a camelCase string to snake_case
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Converts a snake_case string to camelCase
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Converts a TypeScript object with camelCase keys to snake_case keys for Supabase.
 * Handles nested objects and arrays.
 * Special handling: flattens coordinates object to coordinates_lat and coordinates_lng.
 */
export function toSnakeCase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  if (obj === null || obj === undefined) {
    return obj as unknown as Record<string, unknown>;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => 
      typeof item === 'object' && item !== null 
        ? toSnakeCase(item as Record<string, unknown>) 
        : item
    ) as unknown as Record<string, unknown>;
  }

  if (typeof obj !== 'object') {
    return obj as unknown as Record<string, unknown>;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Special handling for coordinates object - flatten it
    if (key === 'coordinates' && value && typeof value === 'object' && !Array.isArray(value)) {
      const coords = value as { lat?: number; lng?: number };
      if (coords.lat !== undefined) {
        result['coordinates_lat'] = coords.lat;
      }
      if (coords.lng !== undefined) {
        result['coordinates_lng'] = coords.lng;
      }
      continue;
    }

    const snakeKey = camelToSnake(key);

    if (value === null || value === undefined) {
      result[snakeKey] = value;
    } else if (Array.isArray(value)) {
      result[snakeKey] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? toSnakeCase(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === 'object') {
      result[snakeKey] = toSnakeCase(value as Record<string, unknown>);
    } else {
      result[snakeKey] = value;
    }
  }

  return result;
}

/**
 * Converts a Supabase object with snake_case keys to camelCase keys for TypeScript.
 * Handles nested objects and arrays.
 * Special handling: unflattens coordinates_lat and coordinates_lng to coordinates object.
 */
export function toCamelCase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  if (obj === null || obj === undefined) {
    return obj as unknown as Record<string, unknown>;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === 'object' && item !== null
        ? toCamelCase(item as Record<string, unknown>)
        : item
    ) as unknown as Record<string, unknown>;
  }

  if (typeof obj !== 'object') {
    return obj as unknown as Record<string, unknown>;
  }

  const result: Record<string, unknown> = {};
  let hasCoordinatesLat = false;
  let hasCoordinatesLng = false;
  let coordinatesLat: number | null = null;
  let coordinatesLng: number | null = null;

  for (const [key, value] of Object.entries(obj)) {
    // Special handling for flattened coordinates - collect them
    if (key === 'coordinates_lat') {
      hasCoordinatesLat = true;
      coordinatesLat = value as number | null;
      continue;
    }
    if (key === 'coordinates_lng') {
      hasCoordinatesLng = true;
      coordinatesLng = value as number | null;
      continue;
    }

    const camelKey = snakeToCamel(key);

    if (value === null || value === undefined) {
      result[camelKey] = value;
    } else if (Array.isArray(value)) {
      result[camelKey] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? toCamelCase(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === 'object') {
      result[camelKey] = toCamelCase(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }

  // Unflatten coordinates if both lat and lng were present
  if (hasCoordinatesLat || hasCoordinatesLng) {
    if (coordinatesLat !== null && coordinatesLng !== null) {
      result['coordinates'] = { lat: coordinatesLat, lng: coordinatesLng };
    }
    // If only one is present or both are null, don't create the coordinates object
  }

  return result;
}
