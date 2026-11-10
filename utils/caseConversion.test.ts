import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { toSnakeCase, toCamelCase } from './caseConversion';

/**
 * **Feature: supabase-migration, Property 8: Case Conversion Round-Trip**
 * **Validates: Requirements 4.4, 4.5**
 * 
 * For any object with camelCase keys, converting to snake_case and back
 * to camelCase should produce an equivalent object.
 */
describe('Case Conversion Round-Trip', () => {
  // Arbitrary for generating camelCase keys (lowercase start, then alphanumeric)
  const camelCaseKey = fc.stringMatching(/^[a-z][a-zA-Z0-9]*$/);

  // Arbitrary for primitive values
  const primitiveValue = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.constant(null)
  );

  // Arbitrary for simple flat objects with camelCase keys
  const simpleCamelCaseObject = fc.dictionary(camelCaseKey, primitiveValue);

  it('Property 8: Round-trip conversion preserves simple objects', () => {
    /**
     * **Feature: supabase-migration, Property 8: Case Conversion Round-Trip**
     * **Validates: Requirements 4.4, 4.5**
     */
    fc.assert(
      fc.property(simpleCamelCaseObject, (obj) => {
        // Skip empty objects
        if (Object.keys(obj).length === 0) return true;
        
        // Skip objects with 'coordinates' key (special handling tested separately)
        if ('coordinates' in obj) return true;
        
        // Skip objects with keys that would conflict with coordinates flattening
        if ('coordinatesLat' in obj || 'coordinatesLng' in obj) return true;

        const snakeCased = toSnakeCase(obj);
        const roundTripped = toCamelCase(snakeCased as Record<string, unknown>);

        // Check all original keys are preserved
        for (const key of Object.keys(obj)) {
          expect(roundTripped).toHaveProperty(key);
          expect(roundTripped[key]).toEqual(obj[key]);
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('Property 8: Round-trip conversion preserves objects with coordinates', () => {
    /**
     * **Feature: supabase-migration, Property 8: Case Conversion Round-Trip**
     * **Validates: Requirements 4.4, 4.5**
     * 
     * Special case: coordinates object should be flattened and unflattened correctly.
     */
    const objectWithCoordinates = fc.record({
      name: fc.string(),
      coordinates: fc.record({
        lat: fc.double({ min: -90, max: 90, noNaN: true }),
        lng: fc.double({ min: -180, max: 180, noNaN: true })
      })
    });

    fc.assert(
      fc.property(objectWithCoordinates, (obj) => {
        const snakeCased = toSnakeCase(obj as Record<string, unknown>);
        
        // Verify coordinates was flattened
        expect(snakeCased).toHaveProperty('coordinates_lat');
        expect(snakeCased).toHaveProperty('coordinates_lng');
        expect(snakeCased).not.toHaveProperty('coordinates');

        const roundTripped = toCamelCase(snakeCased);

        // Verify coordinates was unflattened
        expect(roundTripped).toHaveProperty('coordinates');
        expect(roundTripped.coordinates).toEqual(obj.coordinates);
        expect(roundTripped.name).toEqual(obj.name);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('Property 8: Round-trip conversion preserves nested objects', () => {
    /**
     * **Feature: supabase-migration, Property 8: Case Conversion Round-Trip**
     * **Validates: Requirements 4.4, 4.5**
     */
    const nestedObject = fc.record({
      userId: fc.string(),
      userData: fc.record({
        firstName: fc.string(),
        lastName: fc.string(),
        isActive: fc.boolean()
      })
    });

    fc.assert(
      fc.property(nestedObject, (obj) => {
        const snakeCased = toSnakeCase(obj as Record<string, unknown>);
        const roundTripped = toCamelCase(snakeCased);

        expect(roundTripped).toEqual(obj);
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('Property 8: Round-trip conversion preserves arrays', () => {
    /**
     * **Feature: supabase-migration, Property 8: Case Conversion Round-Trip**
     * **Validates: Requirements 4.4, 4.5**
     */
    const objectWithArray = fc.record({
      itemList: fc.array(fc.record({
        itemId: fc.string(),
        itemName: fc.string()
      }))
    });

    fc.assert(
      fc.property(objectWithArray, (obj) => {
        const snakeCased = toSnakeCase(obj as Record<string, unknown>);
        const roundTripped = toCamelCase(snakeCased);

        expect(roundTripped).toEqual(obj);
        return true;
      }),
      { numRuns: 100 }
    );
  });
});
