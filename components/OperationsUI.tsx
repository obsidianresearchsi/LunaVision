import React from 'react';
import { ArrowUpRight, Network, FileSearch, Users, Briefcase } from 'lucide-react';
import { CaseWithDetails } from '../types';
import { formatSimilarity, similarityTier } from '../utils/similarityPresentation';

export function OperationsHeader({ code, title, description, icon, actions }: {
  code: string; title: string; description: string; icon: React.ReactNode; actions?: React.ReactNode;
}) {
  return <header className="ops-heading">
    <div className="ops-heading-copy"><span className="ops-heading-icon">{icon}</span><div>
      <p className="ops-eyebrow">LUNAR VISION / {code}</p>
      <h1>{title}</h1><p className="ops-description">{description}</p>
    </div></div>
    {actions && <div className="ops-heading-actions">{actions}</div>}
  </header>;
}

export function OperationsMetrics({ items }: { items: Array<{
  label: string; value: React.ReactNode; detail?: string; tone?: 'cyan' | 'red' | 'amber' | 'green' | 'violet';
}> }) {
  return <div className="ops-metrics">{items.map(item => <div className="ops-metric" data-tone={item.tone || 'cyan'} key={item.label}>
    <span className="ops-metric-label">{item.label}</span><strong>{item.value}</strong>
    {item.detail && <span className="ops-metric-detail">{item.detail}</span>}
  </div>)}</div>;
}

export function CaseConnections({ caseData }: { caseData: CaseWithDetails }) {
  return <section className="ops-panel case-connections" aria-label="Case evidence connections">
    <div className="ops-panel-heading"><div><Network size={15}/><h2>Evidence connections</h2></div><span>RECORDED LINKS</span></div>
    <div className="case-network">
      <div className="case-network-column">
        <span className="ops-eyebrow">SUBJECTS / {caseData.linkedSubjects.length}</span>
        {caseData.linkedSubjects.length ? caseData.linkedSubjects.slice(0, 3).map(subject =>
          <a href="#case-linked-subjects" className="case-network-node" key={subject.id} title={subject.suspectFaceToken}>
            <Users size={15}/><div><strong>{subject.suspectFaceToken.slice(0, 14)}</strong><small>{similarityTier(subject.matchType)} · {formatSimilarity(subject.matchConfidence)}</small></div><ArrowUpRight size={12}/>
          </a>) : <p className="ops-muted">No subjects linked</p>}
        {caseData.linkedSubjects.length > 3 && <a className="ops-text-link" href="#case-linked-subjects">View all {caseData.linkedSubjects.length} subjects</a>}
      </div>
      <div className="case-network-hub"><Briefcase size={23}/><strong>{caseData.caseNumber}</strong><span>INVESTIGATION FILE</span></div>
      <div className="case-network-column">
        <span className="ops-eyebrow">SEARCH SESSIONS / {caseData.linkedSearches.length}</span>
        {caseData.linkedSearches.length ? caseData.linkedSearches.slice(0, 3).map(search =>
          <a href="#case-linked-searches" className="case-network-node" key={search.id} title={search.auditLogId}>
            <FileSearch size={15}/><div><strong>{search.auditLogId.slice(0, 18)}</strong><small>Linked {new Date(search.linkedAt).toLocaleDateString()}</small></div><ArrowUpRight size={12}/>
          </a>) : <p className="ops-muted">No searches linked</p>}
        {caseData.linkedSearches.length > 3 && <a className="ops-text-link" href="#case-linked-searches">View all {caseData.linkedSearches.length} sessions</a>}
      </div>
    </div>
    <p className="case-network-caption">Connections reflect saved case associations. Similarity scores do not confirm identity.</p>
  </section>;
}

export function LinkCasePreview({ title, source, destination, includes }: {title: string; source: string; destination?: string; includes: string}) {
  return <div className="case-link-preview" aria-label="Link preview">
    <p className="ops-eyebrow">{title}</p>
    <div className="case-link-path"><span><FileSearch size={15}/>{source}</span><span aria-hidden="true">→</span><span><Briefcase size={15}/>{destination || 'Select a destination case'}</span></div>
    <p>{includes}</p>
  </div>;
}
