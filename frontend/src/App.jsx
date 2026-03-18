import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Copilot from './pages/Copilot';
import Entities from './pages/Entities';
import EntityDetail from './pages/EntityDetail';
import Cases from './pages/Cases';
import CaseDetail from './pages/CaseDetail';
import MapView from './pages/MapView';
import Analytics from './pages/Analytics';
import AuditLog from './pages/AuditLog';
import AdvancedAnalytics from './pages/AdvancedAnalytics';
import OpIntelligence from './pages/OpIntelligence';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="copilot" element={<Copilot />} />
              <Route path="entities" element={<Entities />} />
              <Route path="entities/:id" element={<EntityDetail />} />
              <Route path="cases" element={<Cases />} />
              <Route path="cases/:id" element={<CaseDetail />} />
              <Route path="map" element={<MapView />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="investigation" element={<AdvancedAnalytics />} />
              <Route path="op-intel" element={<OpIntelligence />} />
              <Route
                path="audit-log"
                element={
                  <ProtectedRoute roles={['admin', 'auditor']}>
                    <AuditLog />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
