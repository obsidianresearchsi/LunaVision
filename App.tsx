
import React, { useState } from 'react';
import { canOpenInvestigationPage, Layout } from './components/Layout';
import { Login } from './pages/Login';
import { workspaceEnabled } from './services/supabase';
import { AlertTriage } from './pages/AlertTriage';
import { CommandCentre } from './pages/CommandCentre';
import { LunarConcept, LunarPreview } from './pages/LunarWorkspaces';
import { Dashboard } from './pages/Dashboard';
import { SearchPage } from './pages/Search';
import { ResultsPage } from './pages/Results';
import { Crawler } from './pages/Crawler';
import { Settings } from './pages/Settings';
import { Enrollment } from './pages/Enrollment';
import { GlobalMap } from './pages/GlobalMap';
import { History } from './pages/History';
import { CrawledFaces } from './pages/CrawledFaces';
import { CasesPage } from './pages/Cases';
import { CaseDetailPage } from './pages/CaseDetail';
import { SurveillanceDashboard } from './pages/SurveillanceDashboard';
import { WatchlistPage } from './pages/Watchlist';
import { DetectionHistoryPage } from './pages/DetectionHistory';
import { CameraManagementPage } from './pages/CameraManagement';
import { User, SearchResult, Biometrics, Suspect, UserRole } from './types';

const PREVIEW_USER: User = { id: 'lunar-preview', username: 'Ada Okafor', role: UserRole.CHIEF_COMMANDER, createdAt: '' };

export default function App() {
  const [previewPage, setPreviewPage] = useState<string | null>(null);
  const [requestedInvestigation, setRequestedInvestigation] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [currentPage, setCurrentPage] = useState('search');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [probeImage, setProbeImage] = useState<string>('');
  const [analysisData, setAnalysisData] = useState<string>('');
  const [biometrics, setBiometrics] = useState<Biometrics | null>(null);
  const [auditLogId, setAuditLogId] = useState('');
  
  // New: State for the Right Inspector Panel content
  const [rightPanelContent, setRightPanelContent] = useState<React.ReactNode>(null);
  
  // New: State for Editing Suspects via Map/Dashboard
  const [editingSuspect, setEditingSuspect] = useState<Suspect | null>(null);
  
  // State for case detail navigation
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const handleLogin = (loggedInUser: User) => {
    if (!workspaceEnabled) return;
    setUser(loggedInUser);
    const startPage = loggedInUser.role === UserRole.CHIEF_COMMANDER ? 'dashboard' : 'search';
    setCurrentPage(requestedInvestigation && canOpenInvestigationPage(requestedInvestigation, loggedInUser.role)
      ? requestedInvestigation : startPage);
    setRequestedInvestigation(null);
  };

  const openInvestigation = (page: string) => {
    setPreviewPage(null);
    if (!user) {
      setRequestedInvestigation(page);
      return;
    }
    setCurrentPage(canOpenInvestigationPage(page, user.role) ? page : 'search');
    setRightPanelContent(null);
    setEditingSuspect(null);
  };

  const handleLogout = () => {
    setUser(null);
    setSearchResults(null);
    setBiometrics(null);
    setAuditLogId('');
    setCurrentPage('login');
    setRightPanelContent(null);
    setEditingSuspect(null);
  };

  const handleSearchResults = (results: SearchResult[], image: string, analysis: string, telemetry: Biometrics | null, searchAuditLogId: string) => {
    setSearchResults(results);
    setProbeImage(image);
    setAnalysisData(analysis);
    setBiometrics(telemetry);
    setAuditLogId(searchAuditLogId);
    setCurrentPage('results');
  };
  
  // Navigation Handler to support Edit Workflow
  const handleEditSuspect = (suspect: Suspect) => {
      setEditingSuspect(suspect);
      setCurrentPage('enrollment');
  };

  const renderContent = () => {
    if (!user) return null;

    switch (currentPage) {
        case 'dashboard':
            return <CommandCentre navigate={setCurrentPage} editSuspect={handleEditSuspect} />;
        case 'analytics':
            return user.role === UserRole.CHIEF_COMMANDER ? <Dashboard key="analytics" /> : null;
        case 'users':
            return user.role === UserRole.CHIEF_COMMANDER ? <Dashboard key="officers" initialTab="officers" /> : null;
        case 'access':
        case 'integrations':
            if (user.role !== UserRole.CHIEF_COMMANDER) return null;
            return <LunarConcept page={currentPage} onPreview={() => setPreviewPage(currentPage)} />;
        case 'playback':
        case 'evidence':
        case 'vehicles':
        case 'rules':
            return <LunarConcept page={currentPage} onPreview={() => setPreviewPage(currentPage)} />;
        case 'search':
            return <SearchPage user={user} onResults={handleSearchResults} setRightPanel={setRightPanelContent} />;
        case 'results':
            if (!searchResults) return <SearchPage user={user} onResults={handleSearchResults} setRightPanel={setRightPanelContent} />;
            return <ResultsPage 
                results={searchResults} 
                probeImage={probeImage} 
                analysis={analysisData} 
                telemetry={biometrics}
                officerId={user.id}
                auditLogId={auditLogId}
                onReset={() => setCurrentPage('search')} 
                setRightPanel={setRightPanelContent}
            />;
        case 'global_map':
            return <GlobalMap onEditSuspect={handleEditSuspect} />;
        case 'crawler':
            return user.role === UserRole.CHIEF_COMMANDER ? <Crawler /> : null;
        case 'enrollment':
            return <Enrollment initialData={editingSuspect} />;
        case 'settings':
            return user.role === UserRole.CHIEF_COMMANDER ? <Settings /> : null;
        case 'history':
            return <History user={user} />;
        case 'crawled_faces':
            return user.role === UserRole.CHIEF_COMMANDER ? <CrawledFaces /> : null;
        case 'cases':
            return <CasesPage 
              user={user} 
              onNavigateToCase={(caseId) => {
                setSelectedCaseId(caseId);
                setCurrentPage('case_detail');
              }} 
            />;
        case 'case_detail':
            // Redirect back to cases list if no case selected
            if (!selectedCaseId) {
              setCurrentPage('cases');
              return null;
            }
            return <CaseDetailPage 
              caseId={selectedCaseId} 
              user={user} 
              onBack={() => {
                setSelectedCaseId(null);
                setCurrentPage('cases');
              }} 
            />;
        case 'surveillance':
            return <SurveillanceDashboard />;
        case 'watchlist':
            return <WatchlistPage currentOfficerId={user.id} onNavigateToCase={handleNavigateToCase} />;
        case 'detection_history':
            return <AlertTriage officerId={user.id} onCase={handleNavigateToCase} onHistory={() => setCurrentPage('detection_records')} />;
        case 'detection_records':
            return <DetectionHistoryPage />;
        case 'camera_management':
            // Admin only - redirect non-admins to search
            if (user.role !== UserRole.CHIEF_COMMANDER) {
              setCurrentPage('search');
              return null;
            }
            return <CameraManagementPage />;
        default:
            return <SearchPage user={user} onResults={handleSearchResults} setRightPanel={setRightPanelContent} />;
    }
  };

  if (previewPage) {
    return (
      <Layout key="preview" preview user={PREVIEW_USER} currentPage={previewPage}
        onNavigate={setPreviewPage} onOpenInvestigation={openInvestigation} onLogout={() => setPreviewPage(null)}>
        <LunarPreview page={previewPage} navigate={setPreviewPage} />
      </Layout>
    );
  }

  if (!user) {
    return <Login onLogin={handleLogin} previewOnly={!workspaceEnabled} investigationRequested={requestedInvestigation !== null}
      onPreview={() => { setRequestedInvestigation(null); setPreviewPage('dashboard'); }} />;
  }

  // Handle navigation to case from notification
  const handleNavigateToCase = (caseId: string) => {
    setSelectedCaseId(caseId);
    setCurrentPage('case_detail');
    setRightPanelContent(null);
  };

  return (
    <Layout
        key="workspace"
        user={user} 
        onLogout={handleLogout} 
        currentPage={currentPage}
        onNavigate={(page) => { 
            setCurrentPage(page); 
            setRightPanelContent(null); 
            // Clear editing state if navigating away from enrollment explicitly
            if (page !== 'enrollment') setEditingSuspect(null);
        }}
        onNavigateToCase={handleNavigateToCase}
        rightPanel={rightPanelContent}
    >
      {renderContent()}
    </Layout>
  );
}
