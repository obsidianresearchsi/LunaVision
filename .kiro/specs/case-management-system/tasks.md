# Implementation Plan

- [x] 1. Set up database schema and types






  - [x] 1.1 Create Supabase migration for cases table

    - Create cases table with all columns (id, case_number, title, description, status, priority, owner_id, assigned_officer_id, closing_summary, timestamps)
    - Add indexes for status, priority, owner_id, assigned_officer_id, last_activity_at
    - _Requirements: 1.2, 1.3, 2.1_

  - [x] 1.2 Create Supabase migration for case_activities table

    - Create case_activities table with foreign key to cases
    - Add index on case_id
    - _Requirements: 1.4, 2.3, 4.4_


  - [x] 1.3 Create Supabase migration for case_notes table

    - Create case_notes table with foreign key to cases
    - Add index on case_id

    - _Requirements: 4.2_
  - [x] 1.4 Create Supabase migration for case_linked_subjects table

    - Create case_linked_subjects table with unique constraint on (case_id, suspect_face_token)
    - Add index on case_id
    - _Requirements: 3.3, 3.6_

  - [x] 1.5 Create Supabase migration for case_linked_searches table

    - Create case_linked_searches table with unique constraint on (case_id, audit_log_id)
    - _Requirements: 3.4_
  - [x] 1.6 Create Supabase migration for notifications table


    - Create notifications table with foreign key to cases
    - Add index on (user_id, is_read)
    - _Requirements: 5.3, 5.4, 5.6_
  - [x] 1.7 Add TypeScript types for Case Management


    - Add CaseStatus, CasePriority, ActivityType enums to types.ts
    - Add Case, CaseActivity, CaseNote, CaseLinkedSubject, CaseLinkedSearch, Notification interfaces
    - _Requirements: 1.1, 2.1_

- [x] 2. Implement CaseService core functionality





  - [x] 2.1 Create CaseService with case number generation


    - Implement generateCaseNumber() function with format CASE-YYYYMMDD-XXXX
    - Ensure uniqueness by checking database before returning
    - _Requirements: 1.2_

  - [x] 2.2 Write property test for case number generation

    - **Property 1: Case number format and uniqueness**
    - **Validates: Requirements 1.2**

  - [x] 2.3 Implement createCase() method
    - Validate required fields (title, description)
    - Generate case number, set status to OPEN, set owner_id
    - Create initial CASE_CREATED activity log

    - _Requirements: 1.2, 1.3, 1.4, 1.5_
  - [x] 2.4 Write property test for case creation

    - **Property 2: Case creation initializes correctly**
    - **Validates: Requirements 1.3, 1.4**
  - [x] 2.5 Write property test for case validation

    - **Property 3: Case validation rejects invalid input**
    - **Validates: Requirements 1.5**
  - [x] 2.6 Implement getCase() and getCases() methods

    - Fetch single case with all related data
    - Fetch paginated list with filters (status, priority, assigned_officer, date_range)
    - Default sort by last_activity_at DESC
    - _Requirements: 6.1, 6.3, 6.5_

  - [x] 2.7 Write property test for case filtering

    - **Property 14: Case filters return matching results**
    - **Validates: Requirements 5.5, 6.3**

  - [x] 2.8 Write property test for default sort
    - **Property 16: Default sort is by last activity**
    - **Validates: Requirements 6.5**
  - [x] 2.9 Implement searchCases() method

    - Search by case number, title, or linked subject name
    - _Requirements: 6.2_

  - [x] 2.10 Write property test for case search

    - **Property 15: Case search returns relevant results**
    - **Validates: Requirements 6.2**

- [x] 3. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement status workflow management





  - [x] 4.1 Implement getValidTransitions() method




    - Return valid next statuses based on current status
    - OPEN → [IN_PROGRESS], IN_PROGRESS → [UNDER_REVIEW], UNDER_REVIEW → [CLOSED]
    - _Requirements: 2.2_

  - [x] 4.2 Implement changeStatus() method


    - Validate transition is allowed
    - Require closing summary for CLOSED status
    - Create STATUS_CHANGED activity log
    - Update last_activity_at

    - _Requirements: 2.2, 2.3, 2.4_
  - [x] 4.3 Write property test for status transitions


    - **Property 4: Status transitions follow valid workflow**
    - **Validates: Requirements 2.2**


  - [x] 4.4 Write property test for status change logging
    - **Property 5: Status changes create activity logs**


    - **Validates: Requirements 2.3**
  - [x] 4.5 Write property test for closing summary requirement
    - **Property 6: Closing requires summary**
    - **Validates: Requirements 2.4**
  - [x] 4.6 Implement closed case modification protection

    - Check user role before allowing modifications on CLOSED cases
    - Only CHIEF_COMMANDER can modify closed cases


    - _Requirements: 2.5_

  - [x] 4.7 Write property test for closed case protection


    - **Property 7: Closed cases are immutable for non-commanders**
    - **Validates: Requirements 2.5**

- [x] 5. Implement subject and search linking
  - [x] 5.1 Implement linkSubject() method
    - Store link with all required fields (case_id, face_token, officer_id, confidence, match_type, timestamp)
    - Check for existing link and reject duplicates
    - Create SUBJECT_LINKED activity log
    - _Requirements: 3.3, 3.6_
  - [x] 5.2 Write property test for subject linking data
    - **Property 8: Subject linking stores complete data**
    - **Validates: Requirements 3.3**
  - [x] 5.3 Write property test for duplicate prevention
    - **Property 9: Duplicate subject linking is prevented**
    - **Validates: Requirements 3.6**
  - [x] 5.4 Implement linkSearch() method
    - Store link between case and audit log
    - Create SEARCH_LINKED activity log
    - _Requirements: 3.4_
  - [x] 5.5 Implement unlinkSubject() method
    - Remove subject link from case
    - Create activity log for unlink action
    - _Requirements: 3.5_

- [x] 6. Checkpoint - Ensure all tests pass






  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement ActivityService and timeline






  - [x] 7.1 Implement logActivity() method


    - Create activity log entry with type, metadata, officer_id, timestamp
    - Update case last_activity_at
    - _Requirements: 4.4_

  - [x] 7.2 Implement addNote() method
    - Create note with case_id, officer_id, content, timestamp
    - Create NOTE_ADDED activity log
    - _Requirements: 4.2_
  - [x] 7.3 Write property test for note data completeness


    - **Property 11: Notes contain required fields**

    - **Validates: Requirements 4.2**
  - [x] 7.4 Implement getTimeline() method
    - Combine activities and notes into unified timeline
    - Sort by timestamp descending
    - _Requirements: 4.1, 4.5_

  - [x] 7.5 Write property test for timeline ordering
    - **Property 10: Timeline is chronologically ordered**
    - **Validates: Requirements 4.1**

- [x] 8. Implement NotificationService



  - [x] 8.1 Implement createNotification() method


    - Create notification with user_id, type, case_id, message
    - _Requirements: 5.3, 5.4_

  - [x] 8.2 Implement notification triggers in CaseService

    - Create notification on case assignment
    - Create notifications on status change for owner and assignee
    - _Requirements: 5.3, 5.4_

  - [x] 8.3 Write property test for assignment notifications


    - **Property 12: Assignment creates notifications**
    - **Validates: Requirements 5.2, 5.3**


  - [x] 8.4 Write property test for status change notifications

    - **Property 13: Status changes notify relevant parties**
    - **Validates: Requirements 5.4**
  - [x] 8.5 Implement getNotifications() and getUnreadCount() methods

    - Fetch notifications for user
    - Count unread notifications
    - _Requirements: 5.6_

  - [x] 8.6 Implement markAsRead() and markAllAsRead() methods


    - Mark single or all notifications as read
    - _Requirements: 5.6_

- [x] 9. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement Cases List Page UI





  - [x] 10.1 Create CasesListPage component


    - Display paginated list of cases with CaseCard components
    - Show case number, title, status badge, priority badge, assigned officer
    - _Requirements: 6.1_

  - [x] 10.2 Implement case filters UI
    - Add filter controls for status, priority, assigned officer, date range
    - Connect filters to CaseService.getCases()

    - _Requirements: 6.3_
  - [x] 10.3 Implement case search UI
    - Add search input for case number, title, subject name

    - Connect to CaseService.searchCases()
    - _Requirements: 6.2_
  - [x] 10.4 Add "New Case" button and navigation
    - Button opens case creation modal
    - Click on case navigates to detail page
    - _Requirements: 1.1, 6.4_

- [x] 11. Implement Case Detail Page UI



  - [x] 11.1 Create CaseDetailPage component


    - Display case header with number, title, status, priority
    - Show case description and metadata
    - _Requirements: 2.1_

  - [x] 11.2 Implement status change UI
    - Show current status with color-coded badge
    - Display valid transition buttons
    - Show closing summary modal when closing
    - _Requirements: 2.1, 2.2, 2.4_
  - [x] 11.3 Implement linked subjects section

    - Display all linked subjects with images, confidence, match type
    - Show "Add to Case" integration point
    - _Requirements: 3.5_

  - [x] 11.4 Implement timeline section
    - Display chronological timeline of activities and notes
    - Distinguish between system activities and manual notes
    - Show officer names and formatted timestamps

    - _Requirements: 4.1, 4.5, 4.6_
  - [x] 11.5 Implement add note form

    - Text input for adding notes
    - Submit creates note and refreshes timeline
    - _Requirements: 4.2_

- [x] 12. Implement case assignment and notifications UI





  - [x] 12.1 Create AssignOfficerModal component


    - Show list of available officers
    - Only visible to CHIEF_COMMANDER role
    - _Requirements: 5.1_

  - [x] 12.2 Implement NotificationBell component

    - Show badge with unread count
    - Dropdown with notification list
    - Mark as read on click
    - _Requirements: 5.6_

  - [x] 12.3 Add notification bell to Layout header

    - Integrate NotificationBell into existing header
    - _Requirements: 5.6_

- [x] 13. Implement AddToCaseModal for Results page





  - [x] 13.1 Create AddToCaseModal component


    - Show list of existing cases for selection
    - Option to create new case
    - _Requirements: 3.2_

  - [x] 13.2 Add "Add to Case" button to Results page

    - Button on each matched suspect card
    - Opens AddToCaseModal with subject data
    - _Requirements: 3.1_

  - [x] 13.3 Implement link entire search to case

    - Option to link full search session to case
    - _Requirements: 3.4_

- [x] 14. Implement case report generation






  - [x] 14.1 Create CaseReportGenerator utility

    - Generate formatted report with case details, subjects, timeline, notes
    - Include EagleEye header and CONFIDENTIAL marking
    - _Requirements: 7.2, 7.4_

  - [x] 14.2 Write property test for report content

    - **Property 17: Report contains all required sections**
    - **Validates: Requirements 7.2**

  - [x] 14.3 Write property test for report header
    - **Property 18: Report includes official header**
    - **Validates: Requirements 7.4**
  - [x] 14.4 Implement PDF export


    - Use browser print-to-PDF functionality
    - _Requirements: 7.3_
  - [x] 14.5 Add "Generate Report" button to Case Detail


    - Button triggers report generation
    - Log REPORT_GENERATED activity
    - _Requirements: 7.1, 7.5_
  - [x] 14.6 Write property test for report logging


    - **Property 19: Report generation is logged**
    - **Validates: Requirements 7.5**



- [x] 15. Add Cases navigation to Layout





  - [x] 15.1 Add Cases menu item to sidebar





    - Add navigation item for Cases page

    - Show for all authenticated users
    - _Requirements: 6.1_
  - [x] 15.2 Update App.tsx routing





    - Add cases and case detail routes
    - _Requirements: 6.4_

- [x] 16. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
