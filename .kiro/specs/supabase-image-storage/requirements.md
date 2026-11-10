# Requirements Document

## Introduction

This specification defines the implementation of Supabase Storage for mugshot images in the EagleEye facial recognition system. Currently, suspect images are stored as base64-encoded data URLs directly in the database, which is inefficient and limits scalability. This feature will migrate image storage to Supabase Storage buckets, providing proper cloud-based file storage with CDN delivery, while maintaining the existing application workflow.

## Glossary

- **EagleEye_System**: The facial recognition application being enhanced
- **Supabase_Storage**: Supabase's file storage service built on S3-compatible object storage
- **Mugshot**: A photograph of a suspect's face used for identification
- **Bucket**: A storage container in Supabase Storage for organizing files
- **Public_URL**: A publicly accessible URL for retrieving stored images
- **Base64_Data_URL**: A data URI scheme encoding image data as a base64 string (current storage method)

## Requirements

### Requirement 1

**User Story:** As a system administrator, I want mugshot images stored in Supabase Storage, so that the database is not bloated with base64 image data.

#### Acceptance Criteria

1. WHEN the EagleEye_System initializes THEN the EagleEye_System SHALL verify that a 'mugshots' storage bucket exists in Supabase
2. WHEN a mugshot bucket does not exist THEN the EagleEye_System SHALL create the bucket with public read access
3. WHEN storing an image THEN the EagleEye_System SHALL upload the file to the mugshots bucket with a unique filename based on the face_token
4. WHEN an image is uploaded THEN the EagleEye_System SHALL return the public URL for the stored image

### Requirement 2

**User Story:** As an officer, I want to upload suspect mugshots during enrollment, so that images are properly stored in the cloud.

#### Acceptance Criteria

1. WHEN an officer uploads a mugshot during enrollment THEN the EagleEye_System SHALL compress the image to a maximum width of 450 pixels
2. WHEN the image is compressed THEN the EagleEye_System SHALL upload the compressed image to Supabase Storage
3. WHEN the upload completes THEN the EagleEye_System SHALL store the public URL in the suspect's imageUrl field
4. WHEN an upload fails THEN the EagleEye_System SHALL display an error message and prevent suspect creation

### Requirement 3

**User Story:** As an officer, I want to update suspect mugshots, so that I can replace outdated or incorrect images.

#### Acceptance Criteria

1. WHEN an officer uploads a new mugshot for an existing suspect THEN the EagleEye_System SHALL delete the old image from storage
2. WHEN the old image is deleted THEN the EagleEye_System SHALL upload the new image to Supabase Storage
3. WHEN the new image is uploaded THEN the EagleEye_System SHALL update the suspect's imageUrl field with the new public URL

### Requirement 4

**User Story:** As a developer, I want a storage service layer, so that image operations are centralized and maintainable.

#### Acceptance Criteria

1. WHEN the storage service is initialized THEN the EagleEye_System SHALL provide methods for upload, delete, and getPublicUrl operations
2. WHEN uploading an image THEN the EagleEye_System SHALL accept either a File object or a base64 string as input
3. WHEN generating filenames THEN the EagleEye_System SHALL use the format '{face_token}.jpg' for consistent naming
4. WHEN any storage operation fails THEN the EagleEye_System SHALL throw a descriptive error with the failure reason

### Requirement 5

**User Story:** As a user, I want mugshot images to load quickly, so that the application remains responsive.

#### Acceptance Criteria

1. WHEN displaying suspect images THEN the EagleEye_System SHALL use the Supabase public URL directly
2. WHEN the bucket is configured THEN the EagleEye_System SHALL enable public access for read operations
3. WHEN images are requested THEN the EagleEye_System SHALL serve them via Supabase's CDN infrastructure

