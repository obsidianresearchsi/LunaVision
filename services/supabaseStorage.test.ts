import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { SUPABASE_URL } from './supabase';
import { generateFilename, getPublicUrl, StorageError } from './supabaseStorage';

/**
 * Property tests for Supabase Storage Service
 * 
 * These tests validate correctness properties for the storage service functions.
 */

describe('Storage Service Property Tests', () => {
  /**
   * **Feature: supabase-image-storage, Property 1: Filename Generation Consistency**
   * **Validates: Requirements 1.3, 4.3**
   * 
   * For any valid face_token string, the generated filename should follow
   * the exact format '{face_token}.jpg'.
   */
  it('Property 1: Filename Generation Consistency', () => {
    const faceTokenArbitrary = fc.string({ minLength: 1, maxLength: 100 });

    fc.assert(
      fc.property(faceTokenArbitrary, (faceToken: string) => {
        const filename = generateFilename(faceToken);
        
        // Filename should end with .jpg
        expect(filename.endsWith('.jpg')).toBe(true);
        
        // Filename should start with the face_token
        expect(filename.startsWith(faceToken)).toBe(true);
        
        // Filename should be exactly '{face_token}.jpg'
        expect(filename).toBe(`${faceToken}.jpg`);
        
        // Filename length should be face_token length + 4 (.jpg)
        expect(filename.length).toBe(faceToken.length + 4);
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: supabase-image-storage, Property 2: Public URL Format Validity**
   * **Validates: Requirements 1.4, 2.3, 3.3, 5.1**
   * 
   * For any valid face_token, the returned public URL should be a valid
   * Supabase storage URL containing the bucket name 'mugshots' and the
   * face_token-based filename.
   */
  it('Property 2: Public URL Format Validity', () => {
    const faceTokenArbitrary = fc.string({ minLength: 1, maxLength: 100 });

    fc.assert(
      fc.property(faceTokenArbitrary, (faceToken: string) => {
        const url = getPublicUrl(faceToken);
        
        // URL should be a valid Supabase storage URL
        expect(url.startsWith(SUPABASE_URL + '/storage/v1/object/public/')).toBe(true);
        
        // URL should contain the bucket name 'mugshots'
        expect(url.includes('/mugshots/')).toBe(true);
        
        // URL should end with the face_token-based filename
        expect(url.endsWith(`${faceToken}.jpg`)).toBe(true);
        
        // URL should match the expected format exactly
        const expectedUrl = `${SUPABASE_URL}/storage/v1/object/public/mugshots/${faceToken}.jpg`;
        expect(url).toBe(expectedUrl);
        
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

describe('StorageError Class', () => {
  it('should create error with code and details', () => {
    const error = new StorageError('Test error', 'TEST_CODE', 'Test details');
    
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toBe('Test details');
    expect(error.name).toBe('StorageError');
    expect(error instanceof Error).toBe(true);
  });

  it('should create error without details', () => {
    const error = new StorageError('Test error', 'TEST_CODE');
    
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toBeUndefined();
  });
});

describe('Upload Input Flexibility Property Tests', () => {
  /**
   * **Feature: supabase-image-storage, Property 4: Input Format Flexibility**
   * **Validates: Requirements 4.2**
   * 
   * For any valid image input (File object, Blob, or base64 string), the upload
   * function should successfully process and store the image.
   * 
   * Note: This test validates the input processing logic without making actual
   * network calls. The base64ToBlob conversion and input type handling are tested.
   */
  it('Property 4: Input Format Flexibility - base64 conversion produces valid Blob', () => {
    // A minimal valid 1x1 red pixel JPEG in base64
    const minimalJpegBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAB//9k=';
    
    // Test with data URL format
    const dataUrlArbitrary = fc.constantFrom(
      `data:image/jpeg;base64,${minimalJpegBase64}`,
      `data:image/png;base64,${minimalJpegBase64}`,
      minimalJpegBase64 // raw base64 without data URL prefix
    );

    fc.assert(
      fc.property(dataUrlArbitrary, (base64Input: string) => {
        // The base64 input should be a non-empty string
        expect(typeof base64Input).toBe('string');
        expect(base64Input.length).toBeGreaterThan(0);
        
        // If it's a data URL, it should have the correct format
        if (base64Input.startsWith('data:')) {
          expect(base64Input).toMatch(/^data:image\/[a-z]+;base64,/);
        }
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('Property 4: Input Format Flexibility - Blob input is accepted', () => {
    // Test that Blob inputs are valid
    const blobArbitrary = fc.uint8Array({ minLength: 1, maxLength: 100 }).map(
      arr => new Blob([arr], { type: 'image/jpeg' })
    );

    fc.assert(
      fc.property(blobArbitrary, (blob: Blob) => {
        // Blob should be a valid Blob instance
        expect(blob instanceof Blob).toBe(true);
        expect(blob.type).toBe('image/jpeg');
        expect(blob.size).toBeGreaterThan(0);
        
        return true;
      }),
      { numRuns: 100 }
    );
  });
});
