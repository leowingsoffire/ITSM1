import { useAuth } from '../context/AuthContext';

export function ProfilePage() {
  const { user } = useAuth();

  if (!user) return null;

  const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || user.email[0].toUpperCase();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Profile</h1>
          <p className="page-subtitle">View your account information</p>
        </div>
      </div>

      <div className="card profile-card">
        <div className="card-body">
          <div className="profile-header">
            <div className="profile-avatar">{initials}</div>
            <div>
              <div className="profile-name">{user.firstName} {user.lastName}</div>
              <div className="profile-role">{user.role.replace('_', ' ')}</div>
            </div>
          </div>

          <div className="detail-grid">
            <div>
              <div className="detail-label">First Name</div>
              <div className="detail-value">{user.firstName}</div>
            </div>
            <div>
              <div className="detail-label">Last Name</div>
              <div className="detail-value">{user.lastName}</div>
            </div>
            <div>
              <div className="detail-label">Email Address</div>
              <div className="detail-value">{user.email}</div>
            </div>
            <div>
              <div className="detail-label">Role</div>
              <div className="detail-value">
                <span className={`badge badge-${user.role.toLowerCase()}`}>{user.role.replace('_', ' ')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
