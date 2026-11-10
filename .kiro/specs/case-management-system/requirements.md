# Requirements Document

## Introduction

The Case Management System is a comprehensive feature for EagleEye Nigeria Intelligence System that enables officers to create, manage, and track investigation cases. This system provides a structured workflow for investigations, allowing multiple searches and subjects to be linked to cases, maintaining detailed activity timelines, and facilitating case assignment with notifications. The system integrates with the existing Supabase backend and the facial recognition search functionality.

## Glossary

- **Case**: A formal investigation record containing linked subjects, searches, notes, and activity history
- **Case_Status**: The current state of a case in the workflow (OPEN, IN_PROGRESS, UNDER_REVIEW, CLOSED)
- **Case_Priority**: The urgency level of a case (LOW, MEDIUM, HIGH, CRITICAL)
- **Case_Note**: A timestamped comment or observation added to a case by an officer
- **Case_Activity**: An automated log entry recording actions taken on a case
- **Linked_Subject**: A suspect record associated with a specific case
- **Linked_Search**: A search result/audit log associated with a specific case
- **Assigned_Officer**: The user responsible for investigating a case
- **EagleEye_System**: The biometric intelligence application

## Requirements

### Requirement 1

**User Story:** As an officer, I want to create new investigation cases, so that I can formally track and document my investigations.

#### Acceptance Criteria

1. WHEN an officer clicks the "New Case" button THEN the EagleEye_System SHALL display a case creation form with fields for title, description, priority, and initial notes
2. WHEN an officer submits a valid case creation form THEN the EagleEye_System SHALL generate a unique case number in format "CASE-YYYYMMDD-XXXX" and persist the case to the database
3. WHEN a case is created THEN the EagleEye_System SHALL set the initial status to OPEN and record the creating officer as the case owner
4. WHEN a case is created THEN the EagleEye_System SHALL create an initial activity log entry recording the creation event with timestamp and officer ID
5. IF an officer submits a case form with empty required fields THEN the EagleEye_System SHALL display validation errors and prevent submission

### Requirement 2

**User Story:** As an officer, I want to view and manage case status through a defined workflow, so that I can track investigation progress systematically.

#### Acceptance Criteria

1. WHEN viewing a case THEN the EagleEye_System SHALL display the current status with visual indicators (color-coded badges)
2. WHEN an officer changes case status THEN the EagleEye_System SHALL only allow valid transitions: OPEN → IN_PROGRESS → UNDER_REVIEW → CLOSED
3. WHEN an officer changes case status THEN the EagleEye_System SHALL record the transition in the activity log with timestamp, previous status, new status, and officer ID
4. WHEN a case status changes to CLOSED THEN the EagleEye_System SHALL require a closing summary note
5. WHEN a case is CLOSED THEN the EagleEye_System SHALL prevent further modifications except by CHIEF_COMMANDER role

### Requirement 3

**User Story:** As an officer, I want to link suspects and search results to cases, so that I can consolidate all investigation evidence in one place.

#### Acceptance Criteria

1. WHEN viewing search results THEN the EagleEye_System SHALL display an "Add to Case" button for each matched suspect
2. WHEN an officer clicks "Add to Case" THEN the EagleEye_System SHALL display a modal allowing selection from existing cases or creation of a new case
3. WHEN a suspect is linked to a case THEN the EagleEye_System SHALL store the link with timestamp, linking officer, and match confidence score
4. WHEN a search is performed THEN the EagleEye_System SHALL allow the entire search session (probe image and all results) to be linked to a case
5. WHEN viewing a case THEN the EagleEye_System SHALL display all linked subjects with their images, match types, and confidence scores
6. WHEN a subject is already linked to a case THEN the EagleEye_System SHALL indicate this status and prevent duplicate linking to the same case

### Requirement 4

**User Story:** As an officer, I want to add notes and view activity timeline on cases, so that I can document findings and track investigation history.

#### Acceptance Criteria

1. WHEN viewing a case THEN the EagleEye_System SHALL display a chronological timeline of all activities and notes
2. WHEN an officer adds a note THEN the EagleEye_System SHALL persist the note with timestamp, officer ID, and note content
3. WHEN an officer adds a note THEN the EagleEye_System SHALL support text formatting and allow attachment references
4. WHEN any action is performed on a case THEN the EagleEye_System SHALL automatically create an activity log entry
5. WHEN viewing the timeline THEN the EagleEye_System SHALL distinguish between manual notes and system-generated activities with different visual styles
6. WHEN viewing the timeline THEN the EagleEye_System SHALL display officer names and timestamps in a readable format

### Requirement 5

**User Story:** As a commander, I want to assign cases to officers and receive notifications, so that I can distribute workload and stay informed of case progress.

#### Acceptance Criteria

1. WHEN a CHIEF_COMMANDER views a case THEN the EagleEye_System SHALL display an "Assign Officer" control
2. WHEN a case is assigned to an officer THEN the EagleEye_System SHALL record the assignment in the activity log
3. WHEN a case is assigned THEN the EagleEye_System SHALL display an in-app notification to the assigned officer
4. WHEN a case status changes THEN the EagleEye_System SHALL notify the case owner and assigned officer via in-app notification
5. WHEN viewing the case list THEN the EagleEye_System SHALL allow filtering by assigned officer, status, and priority
6. WHEN an officer logs in THEN the EagleEye_System SHALL display a notification badge showing unread case notifications

### Requirement 6

**User Story:** As an officer, I want to view and search all cases, so that I can find relevant investigations quickly.

#### Acceptance Criteria

1. WHEN an officer navigates to the Cases page THEN the EagleEye_System SHALL display a paginated list of cases with key information (case number, title, status, priority, assigned officer)
2. WHEN viewing the case list THEN the EagleEye_System SHALL provide search functionality by case number, title, or linked subject name
3. WHEN viewing the case list THEN the EagleEye_System SHALL provide filters for status, priority, date range, and assigned officer
4. WHEN an officer clicks on a case THEN the EagleEye_System SHALL navigate to the detailed case view
5. WHEN viewing the case list THEN the EagleEye_System SHALL sort cases by last activity date by default with option to sort by other fields

### Requirement 7

**User Story:** As an officer, I want to generate case reports, so that I can share investigation summaries with stakeholders.

#### Acceptance Criteria

1. WHEN viewing a case THEN the EagleEye_System SHALL provide a "Generate Report" button
2. WHEN generating a report THEN the EagleEye_System SHALL create a formatted document containing case details, linked subjects, timeline, and notes
3. WHEN generating a report THEN the EagleEye_System SHALL support PDF export format
4. WHEN generating a report THEN the EagleEye_System SHALL include the official EagleEye header and classification markings
5. WHEN generating a report THEN the EagleEye_System SHALL record the report generation in the case activity log
