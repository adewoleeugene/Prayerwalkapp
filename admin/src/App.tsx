import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Shell from '@/components/layout/Shell';

const DashboardPage = lazy(() => import('@/pages/Dashboard'));
const AdminsPage = lazy(() => import('@/pages/Admins'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
const LoginPage = lazy(() => import('@/pages/Login'));

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('adminToken');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}


function App() {
  const loading = <div className="p-8 text-sm font-bold text-slate-500">Loading…</div>;
  return (
    <Router basename="/v2">
      <Suspense fallback={loading}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Shell>
                  <DashboardPage />
                </Shell>
              </PrivateRoute>
            }
          />
          <Route
            path="/admins"
            element={
              <PrivateRoute>
                <Shell>
                  <AdminsPage />
                </Shell>
              </PrivateRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <PrivateRoute>
                <Shell>
                  <SettingsPage />
                </Shell>
              </PrivateRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
