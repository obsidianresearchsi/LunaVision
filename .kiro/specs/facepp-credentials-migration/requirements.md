# Requirements Document

## Introduction

This specification defines the migration of Face++ API credentials from browser localStorage to Supabase database storage. Currently, the EagleEye system stores Face++ API keys and secrets in the browser's localStorage, which is insecure and device-specific. This feature will migrate credential storage to a centralized Supabase table, providing secure server-side storage while maintaining the existing application workflow.

## Glossary

- **EagleEye_System**: The facial recognition application being enhanced
- **Face++_Credentials**: The API key and secret required to authenticate with Face++ facial recognition service
- **Supabase_Database**: The PostgreSQL database hosted on Supabase for centralized data storage
- **Settings_Table**: A new database table for storing application configuration including Face++ credentials
- **localStorage**: Browser-based client-side storage (current insecure storage method)

## Requirements

### Requirement 1

**User Story:** As a system administrator, I want Face++ credentials stored securely in Supabase, so that API keys are not exposed in browser storage.

#### Acceptance Criteria

1. WHEN the EagleEye_System initializes THEN the EagleEye_System SHALL verify that a 'settings' table exists in Supabase
2. WHEN storing Face++ credentials THEN the EagleEye_System SHALL save the api_key, api_secret, use_proxy, and region fields to the settings table
3. WHEN credentials are saved THEN the EagleEye_System SHALL use a single row with a fixed identifier for the Face++ settings
4. WHEN credentials exist in the database THEN the EagleEye_System SHALL retrieve them on application load

### Requirement 2

**User Story:** As an administrator, I want to configure Face++ settings through the Settings page, so that I can update credentials when needed.

#### Acceptance Criteria

1. WHEN an administrator opens the Settings page THEN the EagleEye_System SHALL load existing credentials from Supabase
2. WHEN an administrator saves new credentials THEN the EagleEye_System SHALL update the settings table in Supabase
3. WHEN saving credentials THEN the EagleEye_System SHALL validate that both API key and secret are provided
4. WHEN a save operation fails THEN the EagleEye_System SHALL display an error message to the administrator

### Requirement 3

**User Story:** As a developer, I want the Face++ service to retrieve credentials from Supabase, so that all API calls use centralized configuration.

#### Acceptance Criteria

1. WHEN the Face++ service needs credentials THEN the EagleEye_System SHALL fetch them from the Supabase settings table
2. WHEN credentials are not found in Supabase THEN the EagleEye_System SHALL prompt the user to configure them in Settings
3. WHEN credentials are retrieved THEN the EagleEye_System SHALL cache them in memory for the session to reduce database calls

### Requirement 4

**User Story:** As a developer, I want backward compatibility during migration, so that existing localStorage credentials can be migrated.

#### Acceptance Criteria

1. WHEN the application loads and localStorage contains Face++ credentials THEN the EagleEye_System SHALL offer to migrate them to Supabase
2. WHEN migration completes successfully THEN the EagleEye_System SHALL remove the credentials from localStorage
3. WHEN Supabase credentials exist THEN the EagleEye_System SHALL ignore any localStorage credentials
