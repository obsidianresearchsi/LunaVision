import React, { useState, useEffect } from 'react';
import { AuditSourceImage } from '../components/AuditSourceImage';
import { supabaseDb } from '../services/supabaseDb';
import { AuditLog, User } from '../types';
import { Clock, Eye, X, User as UserIcon, Search, RefreshCw, Image, Hash, Link2, FileSearch, ArrowUpRight } from 'lucide-react';
import { OperationsHeader, OperationsMetrics } from '../components/OperationsUI';
import { LinkSearchToCaseModal } from '../components/LinkSearchToCaseModal';

interface HistoryProps { user: User; }

export const History: React.FC<HistoryProps> = ({ user }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'LOCAL' | 'DEEP_WEB'>('ALL');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkingLog, setLinkingLog] = useState<AuditLog | null>(null);

  useEffect(() => { loadHistory(); }, [user.id]);
  const loadHistory = async () => {
    setIsLoading(true); setError(null);
    try {
      const allLogs = await supabaseDb.getAuditLogs({ includeImages: false, officerId: user.id });
      setLogs(allLogs.filter(log => log.officerId === user.id));
    } catch (error: any) { setError(error.message || 'Failed to load search history'); }
    finally { setIsLoading(false); }
  };
  const filteredLogs = logs.filter(log =>
    (filterType === 'ALL' || log.searchType === filterType) &&
    `${log.logId} ${log.officerId} ${new Date(log.timestamp).toLocaleString()}`.toLowerCase().includes(query.toLowerCase())
  );
  const sourceImage = (log: AuditLog) => (log.searchImagePath || '').startsWith('data:') ? log.searchImagePath : `data:image/jpeg;base64,${log.searchImagePath}`;
  const linkLog = (log: AuditLog) => { setSelectedLog(null); setLinkingLog(log); };

  return <div className="ops-page space-y-5" data-accent="amber">
    <OperationsHeader code="INVESTIGATION HISTORY / SEARCH AUDIT" title="Search history"
      description="Your facial-search records, source media, and case evidence links."
      icon={<FileSearch/>} actions={<button onClick={loadHistory} title="Refresh search history" className="px-3 py-2 border border-eagle-700 bg-eagle-800 flex items-center gap-2"><RefreshCw size={14} className={isLoading ? 'animate-spin' : ''}/>Refresh records</button>}/>
    <OperationsMetrics items={[
      { label: 'Search sessions', value: isLoading ? '—' : logs.length, detail: 'Current officer only' },
      { label: 'Recorded matches', value: isLoading ? '—' : logs.reduce((sum, log) => sum + log.resultCount, 0), detail: 'Total returned across sessions', tone: 'amber' },
      { label: 'Local searches', value: isLoading ? '—' : logs.filter(log => log.searchType === 'LOCAL').length, tone: 'green' },
      { label: 'Deep web labelled', value: isLoading ? '—' : logs.filter(log => log.searchType === 'DEEP_WEB').length, detail: 'As recorded in the search log', tone: 'violet' }
    ]}/>
    <div className="ops-toolbar items-center justify-between">
      <div className="flex items-center gap-3 flex-1 min-w-0"><Search size={16} className="text-slate-400"/><input aria-label="Search history records" placeholder="Search session ID, officer, or date..." value={query} onChange={e => setQuery(e.target.value)} className="bg-transparent border-none outline-none flex-1 py-1 text-xs"/></div>
      <div className="flex gap-1">{(['ALL', 'LOCAL', 'DEEP_WEB'] as const).map(type => <button key={type} aria-pressed={filterType === type} onClick={() => setFilterType(type)} className={`px-3 py-2 text-xs border ${filterType === type ? 'bg-blue-900/30 border-blue-500 text-blue-200' : 'border-transparent text-slate-400'}`}>{type === 'ALL' ? 'All' : type === 'LOCAL' ? 'Local' : 'Deep Web'}</button>)}</div>
    </div>
    {error && <div role="alert" className="p-4 border border-red-800 bg-red-900/30 text-red-300 text-sm">{error}</div>}
    <div className="flex justify-between items-center"><p className="ops-eyebrow">SEARCH SESSION REGISTER</p><span className="ops-muted">{filteredLogs.length} visible / {user.username}</span></div>
    {isLoading ? <div className="ops-empty"><RefreshCw className="animate-spin text-blue-400"/></div> : filteredLogs.length === 0 ?
      <div className="ops-empty"><div className="text-center p-8"><FileSearch size={36} className="mx-auto mb-4 text-slate-500"/><h3 className="mb-2">No search records found</h3><p className="ops-muted">{query || filterType !== 'ALL' ? 'Adjust the search or source filter.' : 'Your saved facial recognition searches will appear here.'}</p></div></div> :
      <div className="history-grid">{filteredLogs.map(log => <article key={log.logId} className="history-record" onClick={() => setSelectedLog(log)}>
        <div className="history-record-image"><AuditSourceImage logId={log.logId} initialSource={log.searchImagePath} alt="Search source media"/><span>SOURCE MEDIA</span></div>
        <div className="history-record-body"><div className="flex items-center justify-between gap-3"><span className={`text-[9px] border px-2 py-1 font-mono ${log.searchType === 'DEEP_WEB' ? 'border-purple-700 text-purple-300' : 'border-blue-700 text-blue-300'}`}>{log.searchType}</span><button aria-label={`Open search ${log.logId}`} onClick={e => { e.stopPropagation(); setSelectedLog(log); }} className="text-slate-400 p-1"><Eye size={13}/></button></div>
          <h3>{log.logId}</h3><div className="history-record-meta"><span>{new Date(log.timestamp).toLocaleString()}</span><span>Officer / {log.officerId}</span></div>
          <div className="history-record-footer"><span>{log.resultCount} recorded match{log.resultCount === 1 ? '' : 'es'}</span><button className="flex items-center gap-1 text-[10px]" onClick={e => { e.stopPropagation(); linkLog(log); }}><Link2 size={12}/>Link to case</button></div>
        </div>
      </article>)}</div>}
    <div className="history-ledger-note">This register contains search-session metadata and source images. Match counts are saved search outcomes, not confirmed identities or convictions. Linking a historical session attaches its audit record; individual subjects must be linked from search results.</div>
    {selectedLog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setSelectedLog(null)}>
      <section role="dialog" aria-modal="true" aria-label="Search record details" className="history-detail ops-panel w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="ops-panel-heading"><div><FileSearch size={16}/><h2>Search Record Details</h2></div><button aria-label="Close search record" onClick={() => setSelectedLog(null)} className="p-1"><X size={18}/></button></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
          <div className="history-detail-image bg-black border border-eagle-700 relative"><AuditSourceImage logId={selectedLog.logId} initialSource={selectedLog.searchImagePath} alt="Evidence source image"/><span className="absolute bottom-2 left-2 text-[9px] font-mono bg-black/80 p-2 flex gap-2"><Image size={12}/>SAVED SOURCE MEDIA</span></div>
          <div className="space-y-5"><p className="ops-eyebrow">AUDIT RECORD / ORIGINAL SESSION</p>
            <div><span className="ops-eyebrow">SESSION ID</span><p className="text-sm font-mono break-all text-blue-200 mt-2">{selectedLog.logId}</p></div>
            <div><span className="ops-eyebrow">TIMESTAMP</span><p className="text-sm mt-2">{new Date(selectedLog.timestamp).toLocaleString()}</p></div>
            <div className="grid grid-cols-2 gap-4"><div><span className="ops-eyebrow">SEARCH TYPE</span><p className="text-sm mt-2">{selectedLog.searchType}</p></div><div><span className="ops-eyebrow">RETURNED MATCHES</span><p className="text-2xl text-amber-300 mt-2">{selectedLog.resultCount}</p></div></div>
            <div className="p-3 border border-eagle-700 text-xs text-slate-400 flex items-center gap-2"><UserIcon size={13}/>Recorded by {selectedLog.officerId}</div>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-3 p-4 border-t border-eagle-700"><button className="px-4 py-2 text-xs border border-eagle-700" onClick={() => setSelectedLog(null)}>Close Record</button><button className="px-4 py-2 text-xs bg-blue-600 flex items-center gap-2" onClick={() => linkLog(selectedLog)}><Link2 size={14}/>Link Search to Case<ArrowUpRight size={12}/></button></div>
      </section>
    </div>}
    {linkingLog && <LinkSearchToCaseModal auditLogId={linkingLog.logId} recordedResultCount={linkingLog.resultCount} searchResults={[]} probeImagePreview={linkingLog.searchImagePath ? sourceImage(linkingLog) : undefined} currentOfficerId={user.id} onClose={() => setLinkingLog(null)}/>}
  </div>;
};

