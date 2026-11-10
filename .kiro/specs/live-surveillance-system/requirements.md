# Requirements Document

## Introduction

The Live Surveillance Monitoring System is a comprehensive feature for EagleEye Nigeria Intelligence System that enables real-time monitoring of camera feeds placed at strategic locations on the map. Officers can view live feeds by clicking on camera markers, manage a watchlist of Persons of Interest (POI), monitor multiple camera feeds simultaneously through a surveillance dashboard, and receive automatic alerts when POI are detected through facial recognition.

## Glossary

- **Camera_Feed**: A live video stream from a surveillance camera at a specific location
- **Camera_Marker**: A visual indicator on the map representing a camera's location
- **POI (Person_of_Interest)**: An individual added to the watchlist for monitoring
- **Watchlist**: A collection of POI face tokens that the system actively monitors
- **Detection_Alert**: A notification triggered when a POI is detected in a camera feed
- **Surveillance_Dashboard**: A multi-screen view showing multiple camera feeds simultaneously
- **Face_Recognition_Engine**: The Face++ API service used for facial detection and matching
- **EagleEye_System**: The biometric intelligence application

## Requirements

### Requirement 1

**User Story:** As an officer, I want to see camera markers on the map, so that I can identify surveillance coverage areas.

#### Acceptance Criteria

1. WHEN an officer views the GlobalMap page THEN the EagleEye_System SHALL display camera markers at registered camera locations
2. WHEN a camera marker is displayed THEN the EagleEye_System SHALL show a distinct camera icon with status indicator (online/offline)
3. WHEN an officer hovers over a camera marker THEN the EagleEye_System SHALL display a tooltip with camera name and location
4. WHEN camera status changes THEN the EagleEye_System SHALL update the marker color (green for online, red for offline, yellow for recording)

### Requirement 2

**User Story:** As an officer, I want to click on a camera marker to view its live feed, so that I can monitor activity at that location.

#### Acceptance Criteria

1. WHEN an officer clicks on a camera marker THEN the EagleEye_System SHALL open a modal displaying the live video feed
2. WHEN viewing a live feed THEN the EagleEye_System SHALL display camera name, location, and current timestamp
3. WHEN viewing a live feed THEN the EagleEye_System SHALL provide controls for fullscreen, snapshot capture, and close
4. IF a camera is offline THEN the EagleEye_System SHALL display an offline message with last known timestamp
5. WHEN an officer captures a snapshot THEN the EagleEye_System SHALL save the image with timestamp and camera metadata

### Requirement 3

**User Story:** As an officer, I want to manage surveillance cameras, so that I can add, edit, or remove cameras from the system.

#### Acceptance Criteria

1. WHEN an officer with CHIEF_COMMANDER role accesses camera management THEN the EagleEye_System SHALL display a list of all registered cameras
2. WHEN adding a new camera THEN the EagleEye_System SHALL require camera name, stream URL, location coordinates, and description
3. WHEN editing a camera THEN the EagleEye_System SHALL allow modification of camera details and stream URL
4. WHEN deleting a camera THEN the EagleEye_System SHALL remove the camera and all associated detection history
5. WHEN a camera is added THEN the EagleEye_System SHALL validate the stream URL connectivity before saving

### Requirement 4

**User Story:** As an officer, I want to manage a watchlist of Persons of Interest, so that I can monitor specific individuals across all cameras.

#### Acceptance Criteria

1. WHEN an officer accesses the watchlist THEN the EagleEye_System SHALL display all POI with their images, names, and priority levels
2. WHEN adding a POI to the watchlist THEN the EagleEye_System SHALL require face token, name, priority level, and optional case link
3. WHEN a POI is added THEN the EagleEye_System SHALL register the face token with the facial recognition engine for monitoring
4. WHEN removing a POI from the watchlist THEN the EagleEye_System SHALL stop monitoring for that individual
5. WHEN viewing a POI THEN the EagleEye_System SHALL display detection history with timestamps and camera locations

### Requirement 5

**User Story:** As an officer, I want to view multiple camera feeds simultaneously, so that I can monitor several locations at once.

#### Acceptance Criteria

1. WHEN an officer accesses the Surveillance Dashboard THEN the EagleEye_System SHALL display a grid of camera feeds
2. WHEN viewing the dashboard THEN the EagleEye_System SHALL allow selection of which cameras to display (2x2, 3x3, 4x4 layouts)
3. WHEN a camera feed is displayed THEN the EagleEye_System SHALL show camera name and live status indicator
4. WHEN an officer clicks on a feed in the grid THEN the EagleEye_System SHALL expand that feed to fullscreen
5. WHEN viewing the dashboard THEN the EagleEye_System SHALL highlight cameras with recent POI detections

### Requirement 6

**User Story:** As an officer, I want to receive alerts when a Person of Interest is detected, so that I can respond quickly to sightings.

#### Acceptance Criteria

1. WHEN a POI is detected in any camera feed THEN the EagleEye_System SHALL create an alert with timestamp, camera location, and confidence score
2. WHEN an alert is created THEN the EagleEye_System SHALL display a visual notification with POI image and detection snapshot
3. WHEN an alert is created THEN the EagleEye_System SHALL play an audio notification sound
4. WHEN viewing an alert THEN the EagleEye_System SHALL provide options to view live feed, view POI profile, or link to case
5. WHEN an alert is acknowledged THEN the EagleEye_System SHALL mark it as read and log the acknowledging officer

### Requirement 7

**User Story:** As an officer, I want to view detection history, so that I can review past sightings of Persons of Interest.

#### Acceptance Criteria

1. WHEN an officer accesses detection history THEN the EagleEye_System SHALL display a chronological list of all detections
2. WHEN viewing detection history THEN the EagleEye_System SHALL allow filtering by POI, camera, date range, and confidence threshold
3. WHEN viewing a detection record THEN the EagleEye_System SHALL display the captured snapshot, POI match, confidence score, and camera details
4. WHEN viewing a detection record THEN the EagleEye_System SHALL provide option to link detection to an existing case
5. WHEN exporting detection history THEN the EagleEye_System SHALL generate a report with all detection details and images

### Requirement 8

**User Story:** As a system administrator, I want the system to perform facial recognition on camera feeds, so that POI can be automatically detected.

#### Acceptance Criteria

1. WHEN a camera feed is active THEN the EagleEye_System SHALL capture frames at configurable intervals for facial recognition
2. WHEN processing a frame THEN the EagleEye_System SHALL detect all faces and compare against the POI watchlist
3. WHEN a match is found with confidence above threshold THEN the EagleEye_System SHALL create a detection alert
4. WHEN processing fails THEN the EagleEye_System SHALL log the error and continue processing subsequent frames
5. WHEN system load is high THEN the EagleEye_System SHALL prioritize cameras with higher priority POI assignments

