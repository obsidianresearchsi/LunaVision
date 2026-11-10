
export enum UserRole {
  CHIEF_COMMANDER = 'CHIEF_COMMANDER',
  OFFICER = 'OFFICER'
}

export interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export interface FacePPSettings {
  apiKey: string;
  apiSecret: string;
  useProxy?: boolean; 
  region?: 'US' | 'CN';
}

export interface GeminiSettings {
  apiKey: string;
}

export interface Biometrics {
  gender: { value: 'Male' | 'Female', confidence: number };
  age: { value: number };
  emotion: { [key: string]: number }; // e.g. happiness: 99.9
}

export interface Suspect {
  faceToken: string;
  name: string;
  crime: string;
  nin: string; // National Identity Number
  location: string;
  imageUrl: string;
  sourceUrl: string; // Page URL where image was found (for crawled data)
  originalImageUrl?: string; // Original image URL from the web
  isRelativeToId?: string; // Legacy relationship field; not validated kinship evidence
  coordinates?: { lat: number; lng: number }; // Geospatial data
  
  // Advanced Fields
  dob?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  physicalMarks?: string; // Tattoos, scars
  status?: 'WANTED' | 'IN_CUSTODY' | 'CLEARED' | 'DECEASED';
  notes?: string;
}

export interface AuditLog {
  logId: string;
  officerId: string;
  searchImagePath: string; // Base64 or URL
  timestamp: string;
  resultCount: number;
  searchType: 'LOCAL' | 'DEEP_WEB';
}

export interface SearchResult {
  suspect: Suspect;
  // Legacy name: provider similarity on a 0–100 scale, not identity probability.
  confidence: number;
  // Legacy provider-tier codes; not identity or kinship determinations.
  matchType: 'EXACT' | 'RELATIVE' | 'NONE';
}

export interface CrawlerStatus {
  isRunning: boolean;
  facesIndexed: number;
  currentUrl: string;
  logs: string[];
}


// ============================================
// Case Management System Types
// ============================================

// Case Status Enum
export enum CaseStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  UNDER_REVIEW = 'UNDER_REVIEW',
  CLOSED = 'CLOSED'
}

// Case Priority Enum
export enum CasePriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

// Activity Type Enum
export enum ActivityType {
  CASE_CREATED = 'CASE_CREATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  OFFICER_ASSIGNED = 'OFFICER_ASSIGNED',
  SUBJECT_LINKED = 'SUBJECT_LINKED',
  SEARCH_LINKED = 'SEARCH_LINKED',
  NOTE_ADDED = 'NOTE_ADDED',
  REPORT_GENERATED = 'REPORT_GENERATED'
}

// Notification Type Enum
export enum NotificationType {
  CASE_ASSIGNED = 'CASE_ASSIGNED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  NOTE_ADDED = 'NOTE_ADDED'
}

// Case Interface
export interface Case {
  id: string;
  caseNumber: string;           // Format: CASE-YYYYMMDD-XXXX
  title: string;
  description: string;
  status: CaseStatus;
  priority: CasePriority;
  ownerId: string;              // Officer who created the case
  assignedOfficerId?: string;   // Officer assigned to investigate
  closingSummary?: string;      // Required when closing
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

// Case Activity Interface
export interface CaseActivity {
  id: string;
  caseId: string;
  activityType: ActivityType;
  officerId: string;
  metadata: Record<string, any>; // Type-specific data
  createdAt: string;
}

// Case Note Interface
export interface CaseNote {
  id: string;
  caseId: string;
  officerId: string;
  content: string;
  createdAt: string;
}

// Case Linked Subject Interface
export interface CaseLinkedSubject {
  id: string;
  caseId: string;
  suspectFaceToken: string;
  linkedByOfficerId: string;
  matchConfidence: number;
  matchType: 'EXACT' | 'RELATIVE';
  linkedAt: string;
}

// Case Linked Search Interface
export interface CaseLinkedSearch {
  id: string;
  caseId: string;
  auditLogId: string;
  linkedByOfficerId: string;
  linkedAt: string;
}

// Notification Interface
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  caseId: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

// Input types for creating/updating cases
export interface CreateCaseInput {
  title: string;
  description: string;
  priority?: CasePriority;
  initialNotes?: string;
}

export interface UpdateCaseInput {
  title?: string;
  description?: string;
  priority?: CasePriority;
}

// Input type for linking subjects
export interface LinkSubjectInput {
  suspectFaceToken: string;
  matchConfidence: number;
  matchType: 'EXACT' | 'RELATIVE';
}

// Case filters for querying
export interface CaseFilters {
  status?: CaseStatus;
  priority?: CasePriority;
  assignedOfficerId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

// Paginated cases response
export interface PaginatedCases {
  cases: Case[];
  total: number;
  page: number;
  pageSize: number;
}

// Case with all related data
export interface CaseWithDetails extends Case {
  linkedSubjects: CaseLinkedSubject[];
  linkedSearches: CaseLinkedSearch[];
  activities: CaseActivity[];
  notes: CaseNote[];
}

// Timeline entry (unified view of activities and notes)
export interface TimelineEntry {
  id: string;
  type: 'activity' | 'note';
  timestamp: string;
  officerId: string;
  content: string | ActivityType;
  metadata?: Record<string, any>;
}

// Notification input
export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  caseId: string;
  message: string;
}


// ============================================
// Live Surveillance Monitoring System Types
// ============================================

// Camera Status Enum
export enum CameraStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  RECORDING = 'RECORDING',
  MAINTENANCE = 'MAINTENANCE'
}

// POI Priority Enum
export enum POIPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

// Alert Status Enum
export enum AlertStatus {
  UNREAD = 'UNREAD',
  READ = 'READ',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  LINKED_TO_CASE = 'LINKED_TO_CASE'
}

// Camera Interface
export interface Camera {
  id: string;
  name: string;
  description: string;
  streamUrl: string;
  coordinates: { lat: number; lng: number };
  status: CameraStatus;
  lastOnline: string | null;
  createdAt: string;
  updatedAt: string;
}

// Watchlist POI Interface
export interface WatchlistPOI {
  id: string;
  faceToken: string;
  name: string;
  imageUrl: string | null;
  priority: POIPriority;
  caseId?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
}

// Detection Interface
export interface Detection {
  id: string;
  cameraId: string;
  poiId: string;
  snapshotUrl: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  detectedAt: string;
  metadata: Record<string, any>;
}

// Surveillance Alert Interface
export interface SurveillanceAlert {
  id: string;
  detectionId: string;
  poiId: string;
  cameraId: string;
  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  linkedCaseId?: string;
  createdAt: string;
}

// Input types for Camera operations
export interface CreateCameraInput {
  name: string;
  description?: string;
  streamUrl: string;
  lat: number;
  lng: number;
}

export interface UpdateCameraInput {
  name?: string;
  description?: string;
  streamUrl?: string;
  lat?: number;
  lng?: number;
}

// Input types for Watchlist operations
export interface AddPOIInput {
  faceToken: string;
  name: string;
  imageUrl?: string;
  priority?: POIPriority;
  caseId?: string;
  notes?: string;
}

export interface UpdatePOIInput {
  name?: string;
  imageUrl?: string;
  priority?: POIPriority;
  caseId?: string;
  notes?: string;
  isActive?: boolean;
}

// Detection filters
export interface DetectionFilters {
  poiId?: string;
  cameraId?: string;
  dateFrom?: string;
  dateTo?: string;
  minConfidence?: number;
  page?: number;
  pageSize?: number;
}

// Alert filters
export interface AlertFilters {
  status?: AlertStatus;
  poiId?: string;
  cameraId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

// Detection with related data
export interface DetectionWithDetails extends Detection {
  camera?: Camera;
  poi?: WatchlistPOI;
}

// Alert with related data
export interface SurveillanceAlertWithDetails extends SurveillanceAlert {
  detection?: Detection;
  camera?: Camera;
  poi?: WatchlistPOI;
}
