/**
 * Supabase Storage Service
 * 
 * Provides storage operations for mugshot images using Supabase Storage.
 * Images are stored in the 'mugshots' bucket with public read access.
 */

import { SUPABASE_URL, supabase } from './supabase';

const BUCKET_NAME = 'mugshots';

/**
 * Custom error class for storage operations
 * _Requirements: 4.4_
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: string
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Generates a filename for a mugshot based on the face_token
 * Format: '{face_token}.jpg'
 * _Requirements: 1.3, 4.3_
 */
export function generateFilename(faceToken: string): string {
  return `${faceToken}.jpg`;
}

/**
 * Constructs the public URL for a mugshot image
 * _Requirements: 1.4, 5.1_
 */
export function getPublicUrl(faceToken: string): string {
  const filename = generateFilename(faceToken);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${filename}`;
}

/**
 * Converts a base64 data URL to a Blob
 */
function base64ToBlob(base64: string): Blob {
  // Handle data URL format (e.g., "data:image/jpeg;base64,...")
  const parts = base64.split(',');
  const base64Data = parts.length > 1 ? parts[1] : parts[0];
  
  // Determine MIME type from data URL or default to JPEG
  let mimeType = 'image/jpeg';
  if (parts.length > 1 && parts[0].includes(':') && parts[0].includes(';')) {
    const mimeMatch = parts[0].match(/:(.*?);/);
    if (mimeMatch) {
      mimeType = mimeMatch[1];
    }
  }
  
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Uploads a mugshot image to Supabase Storage
 * Accepts File, Blob, or base64 string input
 * Returns the public URL for the uploaded image
 * _Requirements: 1.3, 1.4, 4.2_
 */
export async function uploadMugshot(
  faceToken: string,
  image: File | Blob | string
): Promise<string> {
  const filename = generateFilename(faceToken);
  
  // Convert input to Blob if it's a base64 string
  let imageBlob: Blob;
  if (typeof image === 'string') {
    try {
      imageBlob = base64ToBlob(image);
    } catch (error) {
      throw new StorageError(
        'Failed to convert base64 to blob',
        'INVALID_BASE64',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  } else {
    imageBlob = image;
  }
  
  // Upload to Supabase Storage
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filename, imageBlob, {
      contentType: 'image/jpeg',
      upsert: true // Allow overwriting existing files
    });
  
  if (error) {
    throw new StorageError(
      'Failed to upload mugshot',
      error.message,
      error.message
    );
  }
  
  return getPublicUrl(faceToken);
}

/**
 * Deletes a mugshot image from Supabase Storage
 * _Requirements: 3.1_
 */
export async function deleteMugshot(faceToken: string): Promise<void> {
  const filename = generateFilename(faceToken);
  
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([filename]);
  
  if (error) {
    // Log warning but don't throw - deletion failures shouldn't block updates
    console.warn(`Failed to delete mugshot ${filename}:`, error.message);
  }
}
