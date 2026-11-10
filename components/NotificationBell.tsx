import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Notification, NotificationType, SurveillanceAlert, AlertStatus } from '../types';
import { notificationService } from '../services/notificationService';
import {
  getUnreadCount as getSurveillanceUnreadCount,
  getRecentUnreadAlerts,
  markAlertAsRead,
  markAllAlertsAsRead
} from '../services/alertService';
import {
  Bell,
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  MessageSquare,
  UserPlus,
  RefreshCw,
  Check,
  Camera,
  AlertTriangle,
  Eye
} from 'lucide-react';

interface NotificationBellProps {
  userId: string;
  onNavigateToCase?: (caseId: string) => void;
  onNavigateToSurveillance?: () => void;
}

type TabType = 'cases' | 'surveillance';

export const NotificationBell: React.FC<NotificationBellProps> = ({
  userId,
  onNavigateToCase,
  onNavigateToSurveillance
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [surveillanceAlerts, setSurveillanceAlerts] = useState<SurveillanceAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [surveillanceUnreadCount, setSurveillanceUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('cases');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const totalUnread = unreadCount + surveillanceUnreadCount;

  // Load notifications and unread count
  const loadNotifications = useCallback(async () => {
    if (!userId) return;

    setLoading(true);
    setError(null);
    try {
      const [notifs, count, survAlerts, survCount] = await Promise.all([
        notificationService.getNotifications(userId),
        notificationService.getUnreadCount(userId),
        getRecentUnreadAlerts(20),
        getSurveillanceUnreadCount()
      ]);
      setNotifications(notifs);
      setUnreadCount(count);
      setSurveillanceAlerts(survAlerts);
      setSurveillanceUnreadCount(survCount);
    } catch (err: any) {
      setError(err.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Initial load
  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Periodic refresh (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Mark single notification as read
  const handleMarkAsRead = async (notificationId: string, caseId: string) => {
    try {
      await notificationService.markAsRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      if (onNavigateToCase) {
        onNavigateToCase(caseId);
        setIsOpen(false);
      }
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  // Mark surveillance alert as read
  const handleMarkAlertAsRead = async (alertId: string) => {
    try {
      await markAlertAsRead(alertId);
      setSurveillanceAlerts((prev) => prev.filter((a) => a.id !== alertId));
      setSurveillanceUnreadCount((prev) => Math.max(0, prev - 1));

      if (onNavigateToSurveillance) {
        onNavigateToSurveillance();
        setIsOpen(false);
      }
    } catch (err) {
      console.error('Failed to mark alert as read:', err);
    }
  };

  // Mark all as read
  const handleMarkAllAsRead = async () => {
    try {
      if (activeTab === 'cases') {
        await notificationService.markAllAsRead(userId);
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
      } else {
        await markAllAlertsAsRead();
        setSurveillanceAlerts([]);
        setSurveillanceUnreadCount(0);
      }
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  // Get icon for notification type
  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case NotificationType.CASE_ASSIGNED:
        return <UserPlus size={14} className="text-blue-400" />;
      case NotificationType.STATUS_CHANGED:
        return <AlertCircle size={14} className="text-yellow-400" />;
      case NotificationType.NOTE_ADDED:
        return <MessageSquare size={14} className="text-green-400" />;
      default:
        return <Bell size={14} className="text-slate-400" />;
    }
  };

  // Format timestamp
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-slate-400 hover:text-white relative p-1.5 hover:bg-eagle-800 rounded transition-colors"
      >
        <Bell size={18} />
        {totalUnread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-eagle-900">
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-eagle-800 border border-eagle-700 rounded-lg shadow-2xl overflow-hidden z-50">
          {/* Header */}
          <div className="p-3 border-b border-eagle-700 flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Notifications</h4>
            <div className="flex items-center space-x-2">
              <button
                onClick={loadNotifications}
                disabled={loading}
                className="text-slate-400 hover:text-white p-1 rounded transition-colors"
                title="Refresh"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              {((activeTab === 'cases' && unreadCount > 0) ||
                (activeTab === 'surveillance' && surveillanceUnreadCount > 0)) && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-eagle-700">
            <button
              onClick={() => setActiveTab('cases')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'cases'
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-eagle-700/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Cases
              {unreadCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('surveillance')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'surveillance'
                  ? 'text-red-400 border-b-2 border-red-400 bg-eagle-700/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Camera size={14} className="inline mr-1" />
              Alerts
              {surveillanceUnreadCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
                  {surveillanceUnreadCount}
                </span>
              )}
            </button>
          </div>

          {/* Content */}
          <div className="max-h-80 overflow-y-auto">
            {loading && notifications.length === 0 && surveillanceAlerts.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-blue-500" />
              </div>
            ) : error ? (
              <div className="p-4 text-center">
                <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            ) : activeTab === 'cases' ? (
              // Case Notifications
              notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell size={32} className="mx-auto text-slate-500 mb-2" />
                  <p className="text-sm text-slate-400">No case notifications</p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    icon={getNotificationIcon(notification.type)}
                    timeAgo={formatTime(notification.createdAt)}
                    onClick={() => handleMarkAsRead(notification.id, notification.caseId)}
                  />
                ))
              )
            ) : // Surveillance Alerts
            surveillanceAlerts.length === 0 ? (
              <div className="p-8 text-center">
                <Eye size={32} className="mx-auto text-slate-500 mb-2" />
                <p className="text-sm text-slate-400">No surveillance alerts</p>
              </div>
            ) : (
              surveillanceAlerts.map((alert) => (
                <SurveillanceAlertItem
                  key={alert.id}
                  alert={alert}
                  timeAgo={formatTime(alert.createdAt)}
                  onClick={() => handleMarkAlertAsRead(alert.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Notification Item Component
interface NotificationItemProps {
  notification: Notification;
  icon: React.ReactNode;
  timeAgo: string;
  onClick: () => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  icon,
  timeAgo,
  onClick
}) => {
  return (
    <button
      onClick={onClick}
      className={`w-full p-3 text-left border-b border-eagle-700 last:border-b-0 hover:bg-eagle-700/50 transition-colors ${
        !notification.isRead ? 'bg-blue-900/10' : ''
      }`}
    >
      <div className="flex items-start space-x-3">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${notification.isRead ? 'text-slate-400' : 'text-white'}`}>
            {notification.message}
          </p>
          <p className="text-xs text-slate-500 mt-1">{timeAgo}</p>
        </div>
        {!notification.isRead && (
          <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 shrink-0" />
        )}
      </div>
    </button>
  );
};

// Surveillance Alert Item Component
interface SurveillanceAlertItemProps {
  alert: SurveillanceAlert;
  timeAgo: string;
  onClick: () => void;
}

const SurveillanceAlertItem: React.FC<SurveillanceAlertItemProps> = ({
  alert,
  timeAgo,
  onClick
}) => {
  return (
    <button
      onClick={onClick}
      className="w-full p-3 text-left border-b border-eagle-700 last:border-b-0 hover:bg-eagle-700/50 transition-colors bg-red-900/10"
    >
      <div className="flex items-start space-x-3">
        <div className="mt-0.5">
          <AlertTriangle size={14} className="text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white">POI Detected</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Camera alert • {alert.status === AlertStatus.UNREAD ? 'Unread' : alert.status}
          </p>
          <p className="text-xs text-slate-500 mt-1">{timeAgo}</p>
        </div>
        <div className="w-2 h-2 bg-red-500 rounded-full mt-1.5 shrink-0" />
      </div>
    </button>
  );
};
