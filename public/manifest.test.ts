import { beforeAll, describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Unit tests for PWA Web Manifest structure validation
 * 
 * These tests verify that the manifest.json file exists, is valid JSON,
 * and contains all required fields with correct values for PWA installation.
 * 
 * _Requirements: 1.1, 1.2, 2.2, 3.1, 3.2, 3.3_
 */
describe('Web Manifest Structure Tests', () => {
  const manifestPath = path.resolve(__dirname, 'manifest.json');
  
  describe('Manifest file existence and validity', () => {
    it('should have manifest.json file in public directory', () => {
      expect(fs.existsSync(manifestPath)).toBe(true);
    });

    it('should be valid JSON', () => {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });
  });

  describe('Required fields validation', () => {
    let manifest: Record<string, unknown>;

    beforeAll(() => {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
    });

    /**
     * Validates: Requirement 1.2
     * WHEN the manifest is loaded THEN the Lunar Vision SHALL provide 
     * the app name "Lunar Vision" as the app name and short name
     */
    it('should have correct app name', () => {
      expect(manifest.name).toBe('Lunar Vision');
    });

    it('should have correct short name', () => {
      expect(manifest.short_name).toBe('Lunar Vision');
    });

    /**
     * Validates: Requirement 3.3
     * WHEN the manifest is parsed THEN the Lunar Vision SHALL provide 
     * a description of the application purpose
     */
    it('should have a description', () => {
      expect(manifest.description).toBeDefined();
      expect(typeof manifest.description).toBe('string');
      expect((manifest.description as string).length).toBeGreaterThan(0);
    });

    /**
     * Validates: Requirement 1.4
     * WHEN the app is launched THEN the Lunar Vision SHALL start at the root URL path
     */
    it('should have start_url set to root', () => {
      expect(manifest.start_url).toBe('/');
    });

    /**
     * Validates: Requirement 1.3
     * WHEN the app is installed THEN the Lunar Vision SHALL display 
     * in standalone mode without browser UI elements
     */
    it('should have display mode set to standalone', () => {
      expect(manifest.display).toBe('standalone');
    });

    /**
     * Validates: Requirement 3.1
     * WHEN the app is installed THEN the Lunar Vision SHALL use 
     * the dark theme color (#0c131b) for browser UI elements
     */
    it('should have correct theme_color', () => {
      expect(manifest.theme_color).toBe('#0c131b');
    });

    /**
     * Validates: Requirement 3.2
     * WHEN the app launches THEN the Lunar Vision SHALL display 
     * a dark background (#0c131b) matching the app theme
     */
    it('should have correct background_color', () => {
      expect(manifest.background_color).toBe('#0c131b');
    });
  });

  describe('Icons array validation', () => {
    let manifest: Record<string, unknown>;
    let icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;

    beforeAll(() => {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
      icons = manifest.icons as typeof icons;
    });

    /**
     * Validates: Requirement 2.2
     * WHEN the manifest is loaded THEN the Lunar Vision SHALL provide 
     * icons in multiple sizes (192x192 and 512x512 pixels)
     */
    it('should have icons array', () => {
      expect(Array.isArray(icons)).toBe(true);
      expect(icons.length).toBeGreaterThanOrEqual(2);
    });

    it('should have 192x192 icon', () => {
      const icon192 = icons.find(icon => icon.sizes === '192x192');
      expect(icon192).toBeDefined();
      expect(icon192?.src).toContain('icon-192x192.png');
      expect(icon192?.type).toBe('image/png');
    });

    it('should have 512x512 icon', () => {
      const icon512 = icons.find(icon => icon.sizes === '512x512');
      expect(icon512).toBeDefined();
      expect(icon512?.src).toContain('icon-512x512.png');
      expect(icon512?.type).toBe('image/png');
    });

    it('should have icons with valid purpose', () => {
      icons.forEach(icon => {
        if (icon.purpose) {
          // Valid purposes: any, maskable, or combination
          expect(icon.purpose).toMatch(/^(any|maskable|any maskable|maskable any)$/);
        }
      });
    });
  });
});
