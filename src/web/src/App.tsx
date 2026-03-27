import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmDialog';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const IncidentsPage = lazy(() => import('./pages/IncidentsPage').then(m => ({ default: m.IncidentsPage })));
const ServiceRequestsPage = lazy(() => import('./pages/ServiceRequestsPage').then(m => ({ default: m.ServiceRequestsPage })));
const AssetsPage = lazy(() => import('./pages/AssetsPage').then(m => ({ default: m.AssetsPage })));
const KnowledgePage = lazy(() => import('./pages/KnowledgePage').then(m => ({ default: m.KnowledgePage })));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const AdminTeamsPage = lazy(() => import('./pages/AdminTeamsPage').then(m => ({ default: m.AdminTeamsPage })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="not-found-page">
      <div className="not-found-code">404</div>
      <h2 className="not-found-title">Page not found</h2>
      <p className="not-found-text">The page you're looking for doesn't exist or has been moved.</p>
      <button className="btn btn-primary" onClick={() => navigate('/')}>Back to Dashboard</button>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Suspense fallback={<div className="loading-spinner">Loading...</div>}><DashboardPage /></Suspense>} />
        <Route path="incidents" element={<Suspense fallback={<div className="loading-spinner">Loading...</div>}><IncidentsPage /></Suspense>} />
        <Route path="service-requests" element={<Suspense fallback={<div className="loading-spinner">Loading...</div>}><ServiceRequestsPage /></Suspense>} />
        <Route path="assets" element={<Suspense fallback={<div className="loading-spinner">Loading...</div>}><AssetsPage /></Suspense>} />
        <Route path="knowledge" element={<Suspense fallback={<div className="loading-spinner">Loading...</div>}><KnowledgePage /></Suspense>} />
        <Route path="admin/users" element={<AdminRoute><Suspense fallback={<div className="loading-spinner">Loading...</div>}><AdminUsersPage /></Suspense></AdminRoute>} />
        <Route path="admin/teams" element={<AdminRoute><Suspense fallback={<div className="loading-spinner">Loading...</div>}><AdminTeamsPage /></Suspense></AdminRoute>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AppRoutes />
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
