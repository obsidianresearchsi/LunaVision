/**
 * Image compression utility for mugshot images.
 * Compresses images to a maximum width while maintaining aspect ratio.
 */

/**
 * Compresses an image to a maximum width while maintaining aspect ratio.
 * 
 * @param file - The input File or Blob to compress
 * @param maxWidth - Maximum width in pixels (default: 450)
 * @param quality - JPEG quality from 0 to 1 (default: 0.9)
 * @returns Promise resolving to a compressed Blob in JPEG format
 */
export async function compressImage(
  file: File | Blob,
  maxWidth: number = 450,
  quality: number = 0.9
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Create object URL for the input file
    const objectUrl = URL.createObjectURL(file);
    
    const img = new Image();
    
    img.onload = () => {
      // Clean up object URL
      URL.revokeObjectURL(objectUrl);
      
      const canvas = document.createElement('canvas');
      
      // Calculate new dimensions maintaining aspect ratio
      let newWidth = img.width;
      let newHeight = img.height;
      
      if (img.width > maxWidth) {
        const scaleRatio = maxWidth / img.width;
        newWidth = maxWidth;
        newHeight = Math.round(img.height * scaleRatio);
      }
      
      canvas.width = newWidth;
      canvas.height = newHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      
      // Convert to Blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to compress image'));
          }
        },
        'image/jpeg',
        quality
      );
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    
    img.src = objectUrl;
  });
}
