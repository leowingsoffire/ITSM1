import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  function fetchNotifications() {
    api.get('/notifications').then(({ data }) => {
      setNotifications(data.data || []);
      setUnreadCount(data.unreadCount ?? 0);
    }).catch(() => {});
  }

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function markRead(id: string) {
    await api.patch(`/notifications/${id}/read`).catch(() => {});
    fetchNotifications();
  }

  async function markAllRead() {
    await api.post('/notifications/read-all').catch(() => {});
    fetchNotifications();
  }

  return (
    <div className="notification-bell" ref={ref}>
      <button className="notification-bell-btn" onClick={() => { setOpen(!open); if (!open) fetchNotifications(); }} aria-label="Notifications">
        🔔
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <span style={{ fontWeight: 600 }}>Notifications</span>
            {unreadCount > 0 && <button className="btn btn-sm btn-link" onClick={markAllRead}>Mark all read</button>}
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">No notifications</div>
            ) : (
              notifications.slice(0, 20).map(n => (
                <div
                  key={n.id}
                  className={`notification-item${n.isRead ? '' : ' unread'}`}
                  onClick={() => { if (!n.isRead) markRead(n.id); if (n.link) window.location.hash = n.link; setOpen(false); }}
                >
                  <div className="notification-item-title">{n.title}</div>
                  <div className="notification-item-message">{n.message}</div>
                  <div className="notification-item-time">{new Date(n.createdAt).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
