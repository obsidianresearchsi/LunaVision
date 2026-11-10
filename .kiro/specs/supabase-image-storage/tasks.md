# Implementation Plan

- [x] 1. Create Supabase storage bucket for mugshots






  - [x] 1.1 Apply migration to create 'mugshots' storage bucket with public read access

    - Use Supabase dashboard or SQL to create bucket
    - Configure public access policy for read operations
    - _Requirements: 1.1, 1.2, 5.2_

- [x] 2. Create storage service and utilities





  - [x] 2.1 Create services/supabaseStorage.ts with StorageError class


    - Define StorageError extending Error with code and details
    - _Requirements: 4.4_

  - [x] 2.2 Implement generateFilename function
    - Generate filename in format '{face_token}.jpg'
    - _Requirements: 1.3, 4.3_
  - [x] 2.3 Write property test for filename generation


    - **Property 1: Filename Generation Consistency**
    - **Validates: Requirements 1.3, 4.3**

  - [x] 2.4 Implement getPublicUrl function
    - Construct Supabase public URL from face_token
    - _Requirements: 1.4, 5.1_
  - [x] 2.5 Write property test for URL format

    - **Property 2: Public URL Format Validity**
    - **Validates: Requirements 1.4, 2.3, 3.3, 5.1**
  - [x] 2.6 Implement uploadMugshot function


    - Accept File, Blob, or base64 string input
    - Convert base64 to Blob if needed
    - Upload to mugshots bucket
    - Return public URL
    - _Requirements: 1.3, 1.4, 4.2_
  - [x] 2.7 Write property test for input flexibility


    - **Property 4: Input Format Flexibility**
    - **Validates: Requirements 4.2**
  - [x] 2.8 Implement deleteMugshot function


    - Delete image from storage by face_token
    - _Requirements: 3.1_



- [x] 3. Create image compression utility




  - [x] 3.1 Create utils/imageCompression.ts with compressImage function

    - Accept File or Blob input
    - Compress to max width 450px maintaining aspect ratio
    - Return compressed Blob with JPEG quality 0.9
    - _Requirements: 2.1_

  - [x] 3.2 Write property test for image compression bounds

    - **Property 3: Image Compression Bounds**
    - **Validates: Requirements 2.1**

- [x] 4. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update Enrollment page to use Supabase Storage





  - [x] 5.1 Import supabaseStorage and compressImage utilities


    - Remove inline compressImage function
    - _Requirements: 2.1, 2.2_
  - [x] 5.2 Update handleSubmit to upload compressed image to storage


    - Compress image after Face++ detection
    - Upload to Supabase Storage
    - Use returned URL for imageUrl field
    - _Requirements: 2.2, 2.3_
  - [x] 5.3 Handle image update for existing suspects


    - Delete old image before uploading new one
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 5.4 Add error handling for upload failures


    - Display error message on upload failure
    - Prevent suspect creation if upload fails
    - _Requirements: 2.4_

- [x] 6. Update Crawler to use Supabase Storage







  - [x] 6.1 Update services/crawler.ts to upload crawled images to storage





    - Fetch and compress crawled images
    - Upload to Supabase Storage before saving suspect
    - _Requirements: 2.2, 2.3_

- [x] 7. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

