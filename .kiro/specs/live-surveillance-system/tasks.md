# Implementation Plan

- [x] 1. Set up database schema and types
  - [x] 1.1 Create Supabase migration for cameras table
    - Create cameras table with all columns (id, name, description, stream_url, lat, lng, status, last_online, timestamps)
    - Add indexes for status and coordinates
    - _Requirements: 1.1, 3.2_

  - [x] 1.2 Create Supabase migration for watchlist table
    - Create watchlist table with foreign key to cases
    - Add indexes for is_active and priority
    - _Requirements: 4.1, 4.2_

  - [x] 1.3 Create Supabase migration for detections table
    - Create detections table with foreign keys to cameras and watchlist
    - Add indexes for camera_id, poi_id, and detected_at
    - _Requirements: 7.1, 8.2_

  - [x] 1.4 Create Supabase migration for surveillance_alerts table
    - Create surveillance_alerts table with foreign keys
    - Add indexes for status and created_at
    - _Requirements: 6.1, 6.5_

  - [x] 1.5 Add TypeScript types for Surveillance System
    - Add CameraStatus, POIPriority, AlertStatus enums to types.ts
    - Add Camera, WatchlistPOI, Detection, SurveillanceAlert interfaces
    - _Requirements: 1.1, 4.1, 6.1_

- [x] 2. Implement CameraService core functionality
  - [x] 2.1 Create CameraService with CRUD operations
    - Implement getCameras(), getCamera(), createCamera(), updateCamera(), deleteCamera()
    - Include cascade deletion for detections and alerts
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.2 Write property test for camera operations
    - **Property 7: Camera deletion cascades**
    - **Validates: Requirements 3.4**

  - [x] 2.3 Implement camera status management
    - Implement updateCameraStatus() method
    - Track last_online timestamp
    - _Requirements: 1.4_

  - [x] 2.4 Implement stream URL validation
    - Implement validateStreamUrl() method
    - Check connectivity before saving
    - _Requirements: 3.5_

- [x] 3. Implement WatchlistService
  - [x] 3.1 Create WatchlistService with POI management
    - Implement getPOIs(), getPOI(), addPOI(), updatePOI(), removePOI()
    - Set is_active flag on removal instead of hard delete
    - _Requirements: 4.1, 4.2, 4.4_

  - [x] 3.2 Write property test for watchlist operations
    - **Property 3: Watchlist POI registration**
    - **Validates: Requirements 4.2, 4.3**

  - [x] 3.3 Write property test for watchlist removal
    - **Property 8: Watchlist removal stops monitoring**
    - **Validates: Requirements 4.4**

  - [x] 3.4 Implement detection history for POI
    - Implement getDetectionHistory() method
    - Return all detections for a specific POI
    - _Requirements: 4.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement DetectionService
  - [x] 5.1 Create DetectionService for frame processing
    - Implement processFrame() method
    - Compare detected faces against active watchlist
    - _Requirements: 8.1, 8.2_

  - [x] 5.2 Implement detection storage and retrieval
    - Implement getDetections(), getDetection() methods
    - Support filtering by POI, camera, date range, confidence
    - _Requirements: 7.1, 7.2_

  - [x] 5.3 Write property test for detection filtering
    - **Property 6: Detection history filtering**
    - **Validates: Requirements 7.2**

  - [x] 5.4 Implement case linking for detections
    - Implement linkDetectionToCase() method
    - _Requirements: 7.4_

- [x] 6. Implement AlertService
  - [x] 6.1 Create AlertService for alert management
    - Implement getAlerts(), getUnreadCount() methods
    - Support filtering by status, camera, POI
    - _Requirements: 6.1, 6.2_

  - [x] 6.2 Implement alert acknowledgment
    - Implement acknowledgeAlert() method
    - Record officer ID and timestamp
    - _Requirements: 6.5_

  - [x] 6.3 Write property test for alert acknowledgment
    - **Property 5: Alert acknowledgment is logged**
    - **Validates: Requirements 6.5**

  - [x] 6.4 Implement alert creation from detections
    - Create alert when detection confidence exceeds threshold
    - _Requirements: 6.1, 8.3_

  - [x] 6.5 Write property test for alert creation
    - **Property 4: Detection creates alert**
    - **Validates: Requirements 6.1, 8.3**

  - [x] 6.6 Implement case linking for alerts
    - Implement linkAlertToCase() method
    - _Requirements: 6.4_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Camera Markers on GlobalMap





  - [x] 8.1 Create CameraMarker component


    - Display camera icon with status color (green/red/yellow)
    - Show tooltip on hover with camera name and location
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 8.2 Write property test for camera markers
    - **Property 1: Camera markers reflect database state**
    - **Validates: Requirements 1.1, 1.2, 1.4**


  - [x] 8.3 Integrate camera markers into GlobalMap

    - Fetch cameras from CameraService
    - Render CameraMarker for each camera
    - Handle click to open feed modal
    - _Requirements: 1.1, 2.1_


  - [x] 8.4 Implement camera status auto-refresh

    - Poll camera status every 30 seconds
    - Update marker colors on status change
    - _Requirements: 1.4_

- [x] 9. Implement Camera Feed Modal





  - [x] 9.1 Create CameraFeedModal component


    - Display live video stream using stream URL
    - Show camera name, location, timestamp
    - _Requirements: 2.1, 2.2_


  - [x] 9.2 Implement feed controls

    - Add fullscreen toggle button
    - Add snapshot capture button
    - Add close button
    - _Requirements: 2.3_


  - [x] 9.3 Implement snapshot capture

    - Capture current frame as image
    - Save with timestamp and camera metadata
    - _Requirements: 2.5_


  - [x] 9.4 Handle offline camera state

    - Display offline message when camera unavailable
    - Show last known online timestamp
    - _Requirements: 2.4_

- [x] 10. Implement Surveillance Dashboard Page





  - [x] 10.1 Create SurveillanceDashboard page component


    - Display grid of camera feeds
    - Support 2x2, 3x3, 4x4 layout options
    - _Requirements: 5.1, 5.2_


  - [x] 10.2 Create CameraFeedCard component

    - Display individual feed in grid
    - Show camera name and status indicator
    - _Requirements: 5.3_


  - [x] 10.3 Implement feed selection

    - Allow selecting which cameras to display
    - Persist selection in local storage
    - _Requirements: 5.2_


  - [x] 10.4 Implement fullscreen expansion

    - Click on feed to expand to fullscreen
    - _Requirements: 5.4_

  - [x] 10.5 Highlight cameras with recent detections


    - Add visual indicator for cameras with POI detections
    - _Requirements: 5.5_

- [x] 11. Checkpoint - Ensure all tests pass
  - All 21 surveillance system property tests pass (cameraService, alertService, detectionService, watchlistService)

- [x] 12. Implement Watchlist Management Page
  - [x] 12.1 Create WatchlistPage component
    - Display all POI with images, names, priority
    - Support filtering by priority and active status
    - _Requirements: 4.1_

  - [x] 12.2 Create POICard component
    - Display POI image, name, priority badge
    - Show detection count and last seen
    - _Requirements: 4.1, 4.5_

  - [x] 12.3 Create AddPOIModal component
    - Form for face token, name, priority, case link
    - Validate face token exists in Face++ faceset
    - _Requirements: 4.2, 4.3_

  - [x] 12.4 Implement POI removal
    - Soft delete by setting is_active to false
    - Confirm before removal
    - _Requirements: 4.4_

  - [x] 12.5 Implement detection history view
    - Show all detections for selected POI
    - Display timestamps and camera locations
    - _Requirements: 4.5_

- [x] 13. Implement Detection Alert System
  - [x] 13.1 Create DetectionAlertPopup component
    - Display POI image and detection snapshot
    - Show camera name, timestamp, confidence
    - _Requirements: 6.2_

  - [x] 13.2 Implement audio notification
    - Play alert sound on new detection using Web Audio API
    - Auto-close after 10 seconds
    - _Requirements: 6.3_

  - [x] 13.3 Implement alert actions
    - View live feed button
    - View POI profile button
    - Link to case button
    - _Requirements: 6.4_

  - [x] 13.4 Integrate alerts with notification system
    - Add surveillance alerts to NotificationBell with tabs
    - Show unread count badge for both case and surveillance alerts
    - _Requirements: 6.2_

- [x] 14. Implement Detection History Page
  - [x] 14.1 Create DetectionHistoryPage component
    - Display chronological list of detections
    - _Requirements: 7.1_

  - [x] 14.2 Implement detection filters
    - Filter by POI, camera, date range, confidence
    - _Requirements: 7.2_

  - [x] 14.3 Create DetectionCard component
    - Display snapshot, POI match, confidence, camera (inline in page)
    - _Requirements: 7.3_

  - [x] 14.4 Implement case linking from detection
    - linkDetectionToCase function available in detectionService
    - _Requirements: 7.4_

  - [x] 14.5 Implement detection export
    - Export to CSV with detection details
    - _Requirements: 7.5_

- [x] 15. Implement Camera Management (Admin)
  - [x] 15.1 Create CameraManagementModal component
    - Form for camera name, stream URL, coordinates, description
    - _Requirements: 3.2_

  - [x] 15.2 Implement camera list view
    - Display all cameras with status
    - Only visible to CHIEF_COMMANDER role
    - _Requirements: 3.1_

  - [x] 15.3 Implement camera editing
    - Allow modification of camera details
    - _Requirements: 3.3_

  - [x] 15.4 Implement camera deletion
    - Confirm before deletion
    - Cascade delete detections and alerts
    - _Requirements: 3.4_

  - [x] 15.5 Implement stream URL validation
    - Test connectivity before saving
    - Show error if URL not accessible
    - _Requirements: 3.5_

- [x] 16. Add Navigation and Routing
  - [x] 16.1 Add Surveillance menu item to sidebar
    - Add navigation for Surveillance Dashboard
    - Add navigation for Watchlist
    - Add navigation for Detection History
    - _Requirements: 5.1, 4.1, 7.1_

  - [x] 16.2 Update App.tsx routing
    - Add routes for surveillance, watchlist, and detection history pages
    - _Requirements: 5.1_

- [x] 17. Final Checkpoint - Ensure all tests pass
  - All 21 surveillance system property tests pass (cameraService: 7, alertService: 5, detectionService: 4, watchlistService: 5)
