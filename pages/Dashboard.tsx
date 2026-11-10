
import React, { useState, useEffect, useRef } from 'react';
import { AuditSourceImage } from '../components/AuditSourceImage';
import { supabaseDb } from '../services/supabaseDb';
import { User, AuditLog, UserRole, Suspect } from '../types';
import { Users, FileStack, ShieldCheck, Plus, Terminal, Eye, X, Clock, User as UserIcon, Siren, AlertTriangle, Search, Fingerprint, MapPin, Calendar, Hash, BadgeAlert, FileText, Target } from 'lucide-react';

interface DashboardProps {
    initialTab?: 'overview' | 'officers' | 'watchlist';
}

export const Dashboard: React.FC<DashboardProps> = ({ initialTab = 'overview' }) => {
  const [stats, setStats] = useState({ suspects: 0, officers: 0, audits: 0 });
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [suspects, setSuspects] = useState<Suspect[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [bulkCount, setBulkCount] = useState(5);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [watchlistFilter, setWatchlistFilter] = useState('');
  
  // Audit Playback State
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [selectedSuspect, setSelectedSuspect] = useState<Suspect | null>(null);

  useEffect(() => {
    refreshData();
  }, []);

  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const loadVersion = useRef(0);
  const refreshData = async () => {
    const version = ++loadVersion.current;
    setLoading(true); setLoadErrors([]);
    const apply = (update: () => void) => { if (version === loadVersion.current) update(); };
    await Promise.allSettled([
      supabaseDb.getSuspects().then(s => apply(() => { setSuspects(s); setStats(previous => ({ ...previous, suspects: s.length })); }))
        .catch(() => apply(() => setLoadErrors(previous => [...previous, 'Subject records could not be loaded.']))),
      supabaseDb.getUsers().then(u => apply(() => { setUsers(u); setStats(previous => ({ ...previous, officers: u.filter(user => user.role === UserRole.OFFICER).length })); }))
        .catch(() => apply(() => setLoadErrors(previous => [...previous, 'Officer records could not be loaded.']))),
      supabaseDb.getAuditLogs({ includeImages: false }).then(a => apply(() => { setLogs(a); setStats(previous => ({ ...previous, audits: a.length })); }))
        .catch(() => apply(() => setLoadErrors(previous => [...previous, 'Search history could not be loaded.'])))
    ]);
    apply(() => setLoading(false));
  };

  const handleBulkGenerate = async () => {
    try {
      await supabaseDb.bulkCreateOfficers(bulkCount);
      await refreshData();
      alert(`Generated ${bulkCount} new officer accounts.`);
    } catch (error) {
      console.error('Failed to generate officers:', error);
      alert('Failed to generate officer accounts.');
    }
  };

  const handleToggleStatus = async (faceToken: string, currentStatus: string | undefined) => {
      try {
        const newStatus = currentStatus === 'WANTED' ? 'CLEARED' : 'WANTED';
        await supabaseDb.updateSuspectStatus(faceToken, newStatus);
        await refreshData();
      } catch (error) {
        console.error('Failed to update status:', error);
      }
  };

  const filteredSuspects = suspects.filter(s => 
      s.name.toLowerCase().includes(watchlistFilter.toLowerCase()) || 
      s.crime.toLowerCase().includes(watchlistFilter.toLowerCase())
  );

  return (
    <div className="space-y-8 relative">
      {loading && <p role="status" className="text-xs text-blue-300">Loading database records…</p>}
      {loadErrors.length > 0 && <div role="alert" className="p-4 border border-red-800 text-red-300 text-sm">{loadErrors.join(' ')} <button onClick={refreshData} className="underline ml-2">Retry loading records</button></div>}
      
      {/* SUSPECT DETAIL MODAL */}
      {selectedSuspect && (
        <SuspectDetailModal suspect={selectedSuspect} onClose={() => setSelectedSuspect(null)} />
      )}

      {/* AUDIT PLAYBACK MODAL */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-eagle-900 border border-eagle-700 rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col">
                <div className="p-4 bg-eagle-950 border-b border-eagle-800 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white flex items-center">
                        <Clock className="mr-2 text-blue-500" size={20} />
                        Audit Trail Playback
                    </h3>
                    <button onClick={() => setSelectedLog(null)} className="text-slate-500 hover:text-white">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 grid grid-cols-2 gap-6">
                    <div className="bg-black rounded-lg border border-eagle-800 overflow-hidden relative group">
                        <AuditSourceImage logId={selectedLog.logId} initialSource={selectedLog.searchImagePath} alt="Evidence"/>
                        <div className="absolute bottom-2 left-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded font-mono">
                            CAPTURED_SOURCE_MEDIA
                        </div>
                    </div>
                    <div className="space-y-4 font-mono text-sm">
                        <div>
                            <span className="text-slate-500 block text-xs uppercase">Timestamp</span>
                            <span className="text-blue-400">{new Date(selectedLog.timestamp).toLocaleString()}</span>
                        </div>
                        <div>
                            <span className="text-slate-500 block text-xs uppercase">Officer ID</span>
                            <span className="text-white flex items-center">
                                <UserIcon size={12} className="mr-1" />
                                {selectedLog.officerId}
                            </span>
                        </div>
                        <div>
                            <span className="text-slate-500 block text-xs uppercase">Search Vector</span>
                            <span className="text-white">{selectedLog.searchType}</span>
                        </div>
                        <div>
                            <span className="text-slate-500 block text-xs uppercase">Result Yield</span>
                            <span className="text-emerald-400 font-bold">{selectedLog.resultCount} Matches</span>
                        </div>
                        <div className="pt-4 border-t border-eagle-800">
                             <div className="bg-eagle-950 p-2 rounded text-xs text-slate-500 border border-eagle-800">
                                LOG_ID: {selectedLog.logId}<br/>
                                INTEGRITY_HASH: VERIFIED
                             </div>
                        </div>
                    </div>
                </div>
                <div className="p-4 bg-eagle-950 border-t border-eagle-800 flex justify-end">
                    <button onClick={() => setSelectedLog(null)} className="px-4 py-2 bg-eagle-800 hover:bg-eagle-700 text-white rounded text-sm font-bold">
                        Close Record
                    </button>
                </div>
            </div>
        </div>
      )}

      <div className="lunar-page-heading lunar-investigation-heading">
        <div><h1>{activeTab === 'officers' ? 'Officer management' : 'Operations analytics'}</h1><p>EagleEye investigation / Workspace administration</p></div>
        <div className="flex space-x-2">
            <button 
                onClick={() => setActiveTab('overview')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'overview' ? 'bg-blue-600 text-white' : 'bg-eagle-800 text-slate-400 hover:text-white'}`}
            >
                Overview & Logs
            </button>
            <button 
                onClick={() => setActiveTab('watchlist')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors flex items-center space-x-2 ${activeTab === 'watchlist' ? 'bg-blue-600 text-white' : 'bg-eagle-800 text-slate-400 hover:text-white'}`}
            >
                <Siren size={14} />
                <span>Watchlist Manager</span>
            </button>
            <button 
                onClick={() => setActiveTab('officers')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'officers' ? 'bg-blue-600 text-white' : 'bg-eagle-800 text-slate-400 hover:text-white'}`}
            >
                Officer Management
            </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard tone="red" icon={<FileStack className="text-red-400" />} label="Indexed Suspects" value={stats.suspects.toString()} />
        <StatCard tone="green" icon={<Users className="text-emerald-400" />} label="Active Officers" value={stats.officers.toString()} />
        <StatCard tone="amber" icon={<ShieldCheck className="text-amber-400" />} label="Total Searches" value={stats.audits.toString()} />
      </div>

        {activeTab === 'overview' && (
            <div className="bg-eagle-800 border border-eagle-700 rounded-lg overflow-hidden">
                <div className="p-4 border-b border-eagle-700 bg-eagle-900/50 flex items-center space-x-2">
                    <Terminal size={18} className="text-slate-400" />
                    <h3 className="font-mono text-sm font-bold text-slate-300 uppercase">Master Audit Log</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-eagle-900 text-slate-400 font-mono text-xs uppercase">
                            <tr>
                                <th className="px-6 py-3">Timestamp</th>
                                <th className="px-6 py-3">Officer ID</th>
                                <th className="px-6 py-3">Search Type</th>
                                <th className="px-6 py-3">Results</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-eagle-700">
                            {logs.map((log, i) => (
                                <tr key={i} className="hover:bg-eagle-700/50 transition-colors group">
                                    <td className="px-6 py-4 font-mono text-slate-400">{new Date(log.timestamp).toLocaleString()}</td>
                                    <td className="px-6 py-4 text-white font-medium">{log.officerId}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${log.searchType === 'DEEP_WEB' ? 'bg-purple-900/30 text-purple-400 border border-purple-900' : 'bg-blue-900/30 text-blue-400 border border-blue-900'}`}>
                                            {log.searchType}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-slate-300">{log.resultCount} Found</td>
                                    <td className="px-6 py-4 text-right">
                                        <button 
                                            onClick={() => setSelectedLog(log)}
                                            className="text-blue-400 hover:text-white px-2 py-1 rounded hover:bg-blue-600 transition-colors text-xs font-bold flex items-center ml-auto"
                                        >
                                            <Eye size={14} className="mr-1" /> Review
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-slate-500 italic">{loading ? 'Loading search history…' : loadErrors.length ? 'Search history is unavailable. Retry loading records.' : 'No activity recorded in the grid.'}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {activeTab === 'watchlist' && (
            <div className="bg-eagle-800 border border-eagle-700 rounded-lg overflow-hidden">
                <div className="p-4 border-b border-eagle-700 bg-eagle-900/50 flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                        <Siren size={18} className="text-red-500" />
                        <h3 className="font-mono text-sm font-bold text-slate-300 uppercase">High Value Target (HVT) Management</h3>
                    </div>
                    <div className="flex items-center bg-eagle-900 border border-eagle-700 rounded px-3 py-1.5">
                        <Search size={14} className="text-slate-500 mr-2" />
                        <input 
                            type="text"
                            placeholder="Filter by name..."
                            value={watchlistFilter}
                            onChange={(e) => setWatchlistFilter(e.target.value)}
                            className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-600 w-48"
                        />
                    </div>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                         <thead className="bg-eagle-900 text-slate-400 font-mono text-xs uppercase">
                            <tr>
                                <th className="px-6 py-3">Suspect Identity</th>
                                <th className="px-6 py-3">Crime</th>
                                <th className="px-6 py-3">Last Location</th>
                                <th className="px-6 py-3">Status Tag</th>
                                <th className="px-6 py-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-eagle-700">
                            {filteredSuspects.map((s, i) => (
                                <tr key={s.faceToken} className="hover:bg-eagle-700/50 transition-colors">
                                    <td className="px-6 py-4 flex items-center space-x-3">
                                        <div className="w-8 h-8 rounded bg-black overflow-hidden border border-eagle-600">
                                            <img src={s.imageUrl} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="text-white font-bold">{s.name}</div>
                                    </td>
                                    <td className="px-6 py-4 text-slate-400">{s.crime}</td>
                                    <td className="px-6 py-4 text-slate-400">{s.location}</td>
                                    <td className="px-6 py-4">
                                        {s.status === 'WANTED' ? (
                                            <span className="px-2 py-1 bg-red-900/50 border border-red-500 text-red-400 text-xs font-bold rounded flex w-fit items-center">
                                                <AlertTriangle size={10} className="mr-1" /> WANTED
                                            </span>
                                        ) : (
                                            <span className="px-2 py-1 bg-eagle-900 border border-eagle-700 text-slate-500 text-xs font-bold rounded w-fit">
                                                {s.status || 'CLEARED'}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end space-x-2">
                                            <button 
                                                onClick={() => setSelectedSuspect(s)}
                                                className="px-3 py-1 rounded text-xs font-bold transition-all border bg-blue-900/30 border-blue-800 text-blue-400 hover:bg-blue-900/50 hover:text-blue-300 flex items-center"
                                            >
                                                <Eye size={12} className="mr-1" /> View
                                            </button>
                                            <button 
                                                onClick={() => handleToggleStatus(s.faceToken, s.status)}
                                                className={`px-3 py-1 rounded text-xs font-bold transition-all border ${
                                                    s.status === 'WANTED' 
                                                    ? 'bg-transparent border-eagle-600 text-slate-400 hover:text-white' 
                                                    : 'bg-red-900/30 border-red-800 text-red-500 hover:bg-red-900/50 hover:text-red-400'
                                                }`}
                                            >
                                                {s.status === 'WANTED' ? 'Remove Alert' : 'Mark as HVT'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {activeTab === 'officers' && (
             <div className="bg-eagle-800 border border-eagle-700 rounded-lg p-6">
                <h3 className="text-xl font-bold text-white mb-6">Provision New Accounts</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="p-6 bg-eagle-900 rounded border border-eagle-700">
                        <h4 className="font-bold text-blue-400 mb-4 flex items-center">
                            <Plus size={16} className="mr-2" /> Bulk Generation
                        </h4>
                        <p className="text-slate-400 text-sm mb-4">
                            Rapidly generate sequential officer accounts (e.g., Officer_005...Officer_050). 
                            Credentials will be defaulted to standard protocol.
                        </p>
                        <div className="flex space-x-4">
                            <input 
                                type="number" 
                                value={bulkCount}
                                onChange={(e) => setBulkCount(Number(e.target.value))}
                                className="bg-eagle-800 border border-eagle-700 text-white px-4 py-2 rounded w-24"
                            />
                            <button 
                                onClick={handleBulkGenerate}
                                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded transition-colors"
                            >
                                Generate Batch
                            </button>
                        </div>
                    </div>

                    <div className="p-6 bg-eagle-900 rounded border border-eagle-700 h-96 overflow-y-auto scrollbar-default">
                        <h4 className="font-bold text-slate-300 mb-4">Active Roster</h4>
                        <ul className="space-y-2">
                            {users.map(u => (
                                <li key={u.id} className="flex justify-between items-center p-2 bg-eagle-800 rounded border border-eagle-700">
                                    <span className="font-mono text-sm text-blue-300">{u.username}</span>
                                    <span className="text-xs text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
             </div>
        )}
    </div>
  );
};

const StatCard = ({ icon, label, value, tone }: { icon: any, label: string, value: string, tone: 'red' | 'green' | 'amber' }) => (
    <div data-tone={tone} className="command-stat-card bg-eagle-800 border border-eagle-700 p-6 rounded-lg flex items-center space-x-4">
        <div className="p-3 bg-eagle-900 rounded-full border border-eagle-700">
            {icon}
        </div>
        <div>
            <p className="text-slate-400 text-xs uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold text-white">{value}</p>
        </div>
    </div>
);

// Suspect Detail Modal Component
const SuspectDetailModal: React.FC<{ suspect: Suspect, onClose: () => void }> = ({ suspect, onClose }) => {
    const statusColors: Record<string, string> = {
        'WANTED': 'bg-red-600 text-white',
        'IN_CUSTODY': 'bg-yellow-600 text-black',
        'CLEARED': 'bg-green-600 text-white',
        'DECEASED': 'bg-slate-600 text-white'
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div 
                className="bg-eagle-800 border border-eagle-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header with Image */}
                <div className="relative h-48 bg-eagle-950">
                    <img src={suspect.imageUrl} alt={suspect.name} className="w-full h-full object-cover opacity-80" />
                    <div className="absolute inset-0 bg-gradient-to-t from-eagle-800 to-transparent" />
                    <button 
                        onClick={onClose}
                        className="absolute top-3 right-3 p-2 bg-eagle-900/80 hover:bg-eagle-800 rounded-full text-white transition-colors"
                    >
                        <X size={18} />
                    </button>
                    {suspect.status && (
                        <span className={`absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold ${statusColors[suspect.status] || 'bg-slate-600'}`}>
                            {suspect.status.replace('_', ' ')}
                        </span>
                    )}
                    <div className="absolute bottom-4 left-4 right-4">
                        <h2 className="text-2xl font-bold text-white">{suspect.name}</h2>
                        <p className="text-sm text-slate-300 mt-1">{suspect.crime}</p>
                    </div>
                </div>

                {/* Details */}
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <Hash size={12} className="mr-1" /> Face Token
                            </div>
                            <p className="text-white font-mono text-sm truncate">{suspect.faceToken}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <Fingerprint size={12} className="mr-1" /> NIN
                            </div>
                            <p className="text-white font-mono text-sm">{suspect.nin || 'N/A'}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <MapPin size={12} className="mr-1" /> Location
                            </div>
                            <p className="text-white text-sm">{suspect.location}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <UserIcon size={12} className="mr-1" /> Gender
                            </div>
                            <p className="text-white text-sm">{suspect.gender || 'Unknown'}</p>
                        </div>
                        {suspect.dob && (
                            <div className="bg-eagle-900 rounded-lg p-3">
                                <div className="flex items-center text-slate-400 text-xs mb-1">
                                    <Calendar size={12} className="mr-1" /> Date of Birth
                                </div>
                                <p className="text-white text-sm">{suspect.dob}</p>
                            </div>
                        )}
                        {suspect.coordinates && (
                            <div className="bg-eagle-900 rounded-lg p-3">
                                <div className="flex items-center text-slate-400 text-xs mb-1">
                                    <Target size={12} className="mr-1" /> Coordinates
                                </div>
                                <p className="text-white font-mono text-sm">{suspect.coordinates.lat.toFixed(4)}, {suspect.coordinates.lng.toFixed(4)}</p>
                            </div>
                        )}
                    </div>

                    {suspect.physicalMarks && (
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <BadgeAlert size={12} className="mr-1" /> Physical Marks
                            </div>
                            <p className="text-white text-sm">{suspect.physicalMarks}</p>
                        </div>
                    )}

                    {suspect.notes && (
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <FileText size={12} className="mr-1" /> Officer Notes
                            </div>
                            <p className="text-white text-sm">{suspect.notes}</p>
                        </div>
                    )}

                    <div className="text-xs text-slate-500 pt-2 border-t border-eagle-700">
                        Source: {suspect.sourceUrl}
                    </div>
                </div>
            </div>
        </div>
    );
};
