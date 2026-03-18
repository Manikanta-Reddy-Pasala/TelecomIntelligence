import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, roles }) {
  const { isAuthenticated, loading, hasRole } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500">Authenticating...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !hasRole(roles)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
