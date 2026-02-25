import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import DashboardPage from '@/pages/Dashboard';
import AdminsPage from '@/pages/Admins';
import SettingsPage from '@/pages/Settings';
import LoginPage from '@/pages/Login';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('adminToken');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}


function App() {
  return (
    <Router basename="/v2">
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
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
