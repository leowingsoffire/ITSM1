import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@itsm1.local', password: 'admin123', role: 'ADMIN' },
  { label: 'Agent', email: 'agent@itsm1.local', password: 'agent123', role: 'AGENT' },
  { label: 'User', email: 'user@itsm1.local', password: 'user123', role: 'END_USER' },
];

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoLoginStatus, setAutoLoginStatus] = useState('Signing in automatically\u2026');
  const autoLoginAttempted = useRef(false);

  // Auto-login with admin credentials on mount
  useEffect(() => {
    if (autoLoginAttempted.current) return;
    autoLoginAttempted.current = true;

    const defaultAccount = DEMO_ACCOUNTS[0];
    setEmail(defaultAccount.email);
    setPassword(defaultAccount.password);

    (async () => {
      try {
        await login(defaultAccount.email, defaultAccount.password);
        navigate('/');
      } catch {
        setAutoLoginStatus('');
      }
    })();
  }, [login, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickLogin(account: typeof DEMO_ACCOUNTS[number]) {
    setEmail(account.email);
    setPassword(account.password);
    setError('');
    setLoading(true);
    try {
      await login(account.email, account.password);
      navigate('/');
    } catch {
      setError(`Failed to login as ${account.label}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-logo">IT</div>
          <h1>ITSM1</h1>
          <p>Enterprise IT Service Management</p>
        </div>
        {autoLoginStatus && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#6b7280' }}>
            <div className="spinner" style={{ margin: '0 auto 12px', width: 24, height: 24, border: '3px solid #e5e7eb', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            {autoLoginStatus}
          </div>
        )}
        {!autoLoginStatus && (
          <>
            {error && <div className="login-error">{'\u2715'} {error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  className="form-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                  required
                  minLength={6}
                />
              </div>
              <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
                {loading ? 'Signing in\u2026' : 'Sign In'}
              </button>
            </form>
            <div className="login-demo" style={{ marginTop: 16 }}>
              <strong>Quick login:</strong>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'center' }}>
                {DEMO_ACCOUNTS.map((acct) => (
                  <button
                    key={acct.email}
                    type="button"
                    disabled={loading}
                    className="btn btn-secondary"
                    style={{ fontSize: 13 }}
                    onClick={() => handleQuickLogin(acct)}
                  >
                    {acct.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
