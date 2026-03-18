import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Radio, Eye, EyeOff, AlertCircle, Shield, Fingerprint } from 'lucide-react';

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.response?.data?.detail || 'Authentication failed. Check credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 relative overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0">
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(59, 130, 246, 0.5) 1px, transparent 0)`,
            backgroundSize: '40px 40px',
          }}
        />
        {/* Gradient orbs */}
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-indigo-600/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[150px]" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Card */}
        <div className="glass-card rounded-2xl p-8 shadow-2xl shadow-black/30">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-5">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-blue-500/30 animate-pulse-glow">
                <Radio className="w-8 h-8 text-white" />
              </div>
            </div>
            <h1 className="text-3xl font-bold gradient-text tracking-tight">TIAC</h1>
            <p className="text-sm text-slate-400 mt-2">Telecom Intelligence Analyst Copilot</p>
          </div>

          {/* Security badge */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
              <Shield size={12} className="text-green-400" />
              <span className="text-[11px] text-green-400 font-medium">End-to-End Encrypted</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3.5 mb-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-fade-in">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Username</label>
              <div className="relative">
                <Fingerprint size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-slate-800/60 border border-slate-600/40 text-slate-100 rounded-xl pl-11 pr-4 py-3 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition-all duration-200"
                  placeholder="Enter username"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <div className="relative">
                <Shield size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-800/60 border border-slate-600/40 text-slate-100 rounded-xl pl-11 pr-12 py-3 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition-all duration-200"
                  placeholder="Enter password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold
                         hover:from-blue-500 hover:to-indigo-500 transition-all duration-300
                         shadow-xl shadow-blue-500/25 hover:shadow-blue-500/40
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
                         active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Authenticating...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-8 text-center">
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Authorized personnel only. All sessions are monitored and audited.
              <br />
              Unauthorized access attempts will be logged and investigated.
            </p>
          </div>
        </div>

        {/* Bottom links */}
        <div className="flex items-center justify-center gap-4 mt-6 text-[11px] text-slate-600">
          <span>v1.0.0</span>
          <span className="w-1 h-1 rounded-full bg-slate-700" />
          <span>PostgreSQL</span>
          <span className="w-1 h-1 rounded-full bg-slate-700" />
          <span>AI-Powered</span>
        </div>
      </div>
    </div>
  );
}
