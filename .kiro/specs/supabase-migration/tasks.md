# Implementation Plan

- [x] 1. Create Supabase database schema





  - [x] 1.1 Apply migration to create users table with id, username, role, and created_at columns


    - Include CHECK constraint for role values
    - _Requirements: 5.1_
  - [x] 1.2 Apply migration to create suspects table with all columns including coordinates


    - Include CHECK constraints for gender and status
    - Include self-referential foreign key for is_relative_to_id
    - _Requirements: 5.2_
  - [x] 1.3 Apply migration to create audit_logs table with foreign key to users


    - Include CHECK constraint for search_type
    - _Requirements: 5.3_
  - [x] 1.4 Apply migration to insert seed suspect data


    - Insert the three predefined suspects from current db.ts
    - _Requirements: 5.4_

- [x] 2. Set up Supabase client and utilities





  - [x] 2.1 Install @supabase/supabase-js package


    - _Requirements: 4.1_
  - [x] 2.2 Create services/supabase.ts with client initialization


    - Configure with project URL and publishable key
    - _Requirements: 4.1_
  - [x] 2.3 Create utils/caseConversion.ts with toSnakeCase and toCamelCase functions


    - Handle nested objects and arrays
    - Handle coordinates object flattening/unflattening
    - _Requirements: 4.4, 4.5_
  - [x] 2.4 Write property test for case conversion round-trip


    - **Property 8: Case Conversion Round-Trip**
    - **Validates: Requirements 4.4, 4.5**

- [x] 3. Implement Supabase database service





  - [x] 3.1 Create services/supabaseDb.ts with user operations (getUsers, addUser, bulkCreateOfficers)


    - Implement async versions of user methods
    - Use case conversion utilities
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 3.2 Write property tests for user operations

    - **Property 1: User Round-Trip Consistency**
    - **Property 2: Bulk Officer Creation Count**
    - **Validates: Requirements 1.2, 1.3, 1.4**
  - [x] 3.3 Add suspect operations (getSuspects, addSuspect, updateSuspect, updateSuspectStatus)


    - Handle coordinates object mapping to flat columns
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.4 Write property tests for suspect operations

    - **Property 3: Suspect Round-Trip Consistency**
    - **Property 4: Suspect Update Persistence**
    - **Property 5: Status Update Isolation**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5**
  - [x] 3.5 Add audit log operations (getAuditLogs, logSearch)


    - Ensure ordering by timestamp descending
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 3.6 Write property tests for audit log operations

    - **Property 6: Audit Log Round-Trip Consistency**
    - **Property 7: Audit Log Ordering**
    - **Validates: Requirements 3.1, 3.2**

- [x] 4. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update existing services to use Supabase






  - [x] 5.1 Update services/crawler.ts to use supabaseDb instead of localStorage db

    - Change db.addSuspect calls to await supabaseDb.addSuspect
    - _Requirements: 6.1_

  - [x] 5.2 Update services/faceEngine.ts to use supabaseDb

    - Change db.getSuspects to await supabaseDb.getSuspects
    - _Requirements: 6.2_

- [x] 6. Update page components to use async Supabase service





  - [x] 6.1 Update pages/Enrollment.tsx to use supabaseDb


    - Add async/await for suspect operations
    - _Requirements: 6.3_

  - [x] 6.2 Update pages/Dashboard.tsx to use supabaseDb

    - Fetch users and suspects asynchronously
    - _Requirements: 6.3_

  - [x] 6.3 Update pages/Results.tsx to use supabaseDb

    - Update suspect status calls to be async
    - _Requirements: 6.3_

  - [x] 6.4 Update pages/GlobalMap.tsx to use supabaseDb

    - Fetch suspects with coordinates asynchronously
    - _Requirements: 6.3_

  - [x] 6.5 Update pages/Settings.tsx to use supabaseDb for user management

    - Update bulk officer creation to be async
    - _Requirements: 6.3_

- [x] 7. Remove localStorage dependencies






  - [x] 7.1 Remove localStorage initialization and seed data from services/db.ts

    - Keep the file for backwards compatibility or remove entirely
    - _Requirements: 6.4_

  - [x] 7.2 Update any remaining localStorage references for core data

    - Settings (FacePP credentials) can remain in localStorage
    - _Requirements: 6.4_

- [x] 8. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
