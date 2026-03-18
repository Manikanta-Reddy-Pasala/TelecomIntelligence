import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('tiac_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const validateToken = async () => {
      const storedToken = localStorage.getItem('tiac_token');
      if (!storedToken) {
        setLoading(false);
        return;
      }

      try {
        const currentUser = await authService.getCurrentUser();
        const userData = {
          id: currentUser.id,
          username: currentUser.username,
          fullName: currentUser.full_name,
          role: currentUser.role,
          email: currentUser.email,
        };
        setUser(userData);
        setToken(storedToken);
      } catch {
        localStorage.removeItem('tiac_token');
        localStorage.removeItem('tiac_user');
        setUser(null);
        setToken(null);
      } finally {
        setLoading(false);
      }
    };

    validateToken();
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await authService.login(username, password);
    localStorage.setItem('tiac_token', data.access_token);
    // Map user data
    const userData = data.user ? {
      id: data.user.id,
      username: data.user.username,
      fullName: data.user.full_name,
      role: data.user.role,
      email: data.user.email,
    } : { username, fullName: username };
    localStorage.setItem('tiac_user', JSON.stringify(userData));
    setToken(data.access_token);
    setUser(userData);
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('tiac_token');
    localStorage.removeItem('tiac_user');
    setUser(null);
    setToken(null);
    window.location.href = '/login';
  }, []);

  const hasRole = useCallback(
    (roles) => {
      if (!user || !user.role) return false;
      if (typeof roles === 'string') return user.role === roles;
      if (Array.isArray(roles)) return roles.includes(user.role);
      return false;
    },
    [user]
  );

  const isAuthenticated = Boolean(user && token);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, isAuthenticated, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
