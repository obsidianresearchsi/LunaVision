import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaseDetailPage } from './CaseDetail';
import { caseService } from '../services/caseService';
import { activityService } from '../services/activityService';
import { exportReportToPDF } from '../services/caseReportGenerator';
import { CasePriority, CaseStatus, ActivityType, UserRole, CaseWithDetails } from '../types';

vi.mock('../services/caseService', () => ({ caseService: { getCase: vi.fn(), getValidTransitions: vi.fn(), changeStatus: vi.fn(), assignOfficer: vi.fn() } }));
vi.mock('../services/activityService', () => ({ activityService: { getTimeline: vi.fn(), logActivity: vi.fn(), addNote: vi.fn() } }));
vi.mock('../services/caseReportGenerator', () => ({ caseReportGenerator: { generateReport: vi.fn(() => ({ generatedAt: '2026-10-31', content: 'Report' })) }, exportReportToPDF: vi.fn() }));
vi.mock('../services/supabase', () => ({ supabase: { from: () => ({ select: () => ({ in: async () => ({ data: [{ face_token: 'face-1', name: 'Subject profile A', image_url: '', crime: 'Recorded allegation', location: 'Abuja', status: 'WANTED' }], error: null }) }) }) } }));
vi.mock('../components/AssignOfficerModal', () => ({ AssignOfficerModal: () => <div>Assignment dialog</div> }));

const caseFile: CaseWithDetails = { id: 'case-1', caseNumber: 'CASE-001', title: 'Investigation', description: 'Review evidence', status: CaseStatus.IN_PROGRESS, priority: CasePriority.HIGH, ownerId: 'officer-1', createdAt: '2026-10-31', updatedAt: '2026-10-31', lastActivityAt: '2026-10-31',
  linkedSubjects: [{ id: 'link-1', caseId: 'case-1', suspectFaceToken: 'face-1', linkedByOfficerId: 'officer-1', matchConfidence: 92.4, matchType: 'EXACT', linkedAt: '2026-10-31' }],
  linkedSearches: [{ id: 'search-link', caseId: 'case-1', auditLogId: 'original-search-id', linkedByOfficerId: 'officer-1', linkedAt: '2026-10-31' }], activities: [], notes: [] };

describe('Case dossier workflow preservation', () => {
  let root: Root; let host: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(caseService.getCase).mockResolvedValue(caseFile);
    vi.mocked(caseService.getValidTransitions).mockReturnValue([CaseStatus.UNDER_REVIEW]);
    vi.mocked(activityService.getTimeline).mockResolvedValue([]);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  async function render(role = UserRole.CHIEF_COMMANDER) {
    await act(async () => root.render(<CaseDetailPage caseId="case-1" user={{ id: 'officer-1', username: 'Analyst', role, createdAt: '2026-01-01' }} onBack={() => {}}/>));
  }
  const button = (label: string) => [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === label)!;
  it('shows the saved evidence links and enriches linked subjects without inventing associations', async () => {
    await render();
    expect(host.querySelector('.case-connections')?.textContent).toContain('original-search-id');
    expect(host.querySelector('#case-linked-subjects')?.textContent).toContain('Subject profile A');
    expect(host.querySelector('#case-linked-searches')?.textContent).toContain('original-search-id');
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('IN PROGRESS');
  });
  it('keeps status updates and report export on their existing service paths', async () => {
    await render();
    await act(async () => button('Move to UNDER REVIEW').click());
    expect(caseService.changeStatus).toHaveBeenCalledWith('case-1', CaseStatus.UNDER_REVIEW, 'officer-1');
    await act(async () => button('Generate Report').click());
    expect(activityService.logActivity).toHaveBeenCalledWith('case-1', ActivityType.REPORT_GENERATED, 'officer-1', expect.anything());
    expect(exportReportToPDF).toHaveBeenCalled();
  });
  it('retains closed-file restrictions for officers', async () => {
    vi.mocked(caseService.getCase).mockResolvedValue({ ...caseFile, status: CaseStatus.CLOSED });
    vi.mocked(caseService.getValidTransitions).mockReturnValue([]);
    await render(UserRole.OFFICER);
    expect(host.querySelector('textarea')).toBeNull();
    expect(button('Assign Officer')).toBeUndefined();
    expect(button('Generate Report')).toBeTruthy();
  });
});
