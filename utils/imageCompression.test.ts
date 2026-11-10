import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { compressImage } from './imageCompression';

/**
 * **Feature: supabase-image-storage, Property 3: Image Compression Bounds**
 * **Validates: Requirements 2.1**
 * 
 * For any image with width greater than 450 pixels, after compression the
 * resulting image width should be exactly 450 pixels while maintaining aspect ratio.
 */
describe('Image Compression Property Tests', () => {
  // Store original globals
  let originalImage: typeof Image;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    // Store originals
    originalImage = globalThis.Image;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    originalCreateElement = document.createElement.bind(document);

    // Mock URL methods
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    // Restore originals
    globalThis.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  /**
   * **Feature: supabase-image-storage, Property 3: Image Compression Bounds**
   * **Validates: Requirements 2.1**
   * 
   * Property: For any image dimensions where width > maxWidth, the output
   * width should be exactly maxWidth and height should maintain aspect ratio.
   */
  it('Property 3: Image Compression Bounds - width is bounded to maxWidth', async () => {
    // Generate arbitrary image dimensions
    const imageDimensionsArbitrary = fc.record({
      width: fc.integer({ min: 1, max: 2000 }),
      height: fc.integer({ min: 1, max: 2000 })
    });

    await fc.assert(
      fc.asyncProperty(imageDimensionsArbitrary, async ({ width, height }) => {
        const maxWidth = 450;
        
        // Calculate expected dimensions
        let expectedWidth: number;
        let expectedHeight: number;
        
        if (width > maxWidth) {
          const scaleRatio = maxWidth / width;
          expectedWidth = maxWidth;
          expectedHeight = Math.round(height * scaleRatio);
        } else {
          expectedWidth = width;
          expectedHeight = height;
        }

        // Track canvas dimensions
        let canvasWidth = 0;
        let canvasHeight = 0;
        let toBlobCalled = false;

        // Mock Image class
        class MockImage {
          width = width;
          height = height;
          src = '';
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;

          constructor() {
            // Trigger onload asynchronously
            setTimeout(() => {
              if (this.onload) this.onload();
            }, 0);
          }
        }
        globalThis.Image = MockImage as unknown as typeof Image;

        // Mock canvas
        const mockCtx = {
          drawImage: vi.fn()
        };

        const mockCanvas = {
          width: 0,
          height: 0,
          getContext: vi.fn(() => mockCtx),
          toBlob: vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
            canvasWidth = mockCanvas.width;
            canvasHeight = mockCanvas.height;
            toBlobCalled = true;
            callback(new Blob(['test'], { type: type || 'image/jpeg' }));
          })
        };

        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
          if (tagName === 'canvas') {
            return mockCanvas as unknown as HTMLCanvasElement;
          }
          return originalCreateElement(tagName);
        });

        // Create test blob
        const testBlob = new Blob(['test image data'], { type: 'image/jpeg' });

        // Run compression
        const result = await compressImage(testBlob, maxWidth, 0.9);

        // Verify compression was called
        expect(toBlobCalled).toBe(true);
        expect(result instanceof Blob).toBe(true);

        // Verify dimensions
        expect(canvasWidth).toBe(expectedWidth);
        expect(canvasHeight).toBe(expectedHeight);

        // Verify aspect ratio is maintained (within rounding tolerance)
        // For very small heights, rounding can cause larger ratio differences
        // so we use a relative tolerance based on the original ratio
        if (width > 0 && height > 0 && canvasHeight > 0) {
          const originalRatio = width / height;
          const compressedRatio = canvasWidth / canvasHeight;
          // Use relative tolerance: allow up to 1% difference or 1 pixel worth of error
          const relativeTolerance = Math.max(0.01, 1 / Math.min(height, canvasHeight));
          const ratioDiff = Math.abs(originalRatio - compressedRatio) / originalRatio;
          expect(ratioDiff).toBeLessThan(relativeTolerance);
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Images smaller than maxWidth should not be upscaled
   */
  it('Property 3: Images smaller than maxWidth are not upscaled', async () => {
    const smallImageArbitrary = fc.record({
      width: fc.integer({ min: 1, max: 449 }),
      height: fc.integer({ min: 1, max: 2000 })
    });

    await fc.assert(
      fc.asyncProperty(smallImageArbitrary, async ({ width, height }) => {
        const maxWidth = 450;
        
        let canvasWidth = 0;
        let canvasHeight = 0;

        // Mock Image class
        class MockImage {
          width = width;
          height = height;
          src = '';
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;

          constructor() {
            setTimeout(() => {
              if (this.onload) this.onload();
            }, 0);
          }
        }
        globalThis.Image = MockImage as unknown as typeof Image;

        const mockCtx = { drawImage: vi.fn() };
        const mockCanvas = {
          width: 0,
          height: 0,
          getContext: vi.fn(() => mockCtx),
          toBlob: vi.fn((callback: BlobCallback) => {
            canvasWidth = mockCanvas.width;
            canvasHeight = mockCanvas.height;
            callback(new Blob(['test'], { type: 'image/jpeg' }));
          })
        };

        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
          if (tagName === 'canvas') {
            return mockCanvas as unknown as HTMLCanvasElement;
          }
          return originalCreateElement(tagName);
        });

        const testBlob = new Blob(['test'], { type: 'image/jpeg' });
        await compressImage(testBlob, maxWidth, 0.9);

        // Small images should keep original dimensions
        expect(canvasWidth).toBe(width);
        expect(canvasHeight).toBe(height);

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
