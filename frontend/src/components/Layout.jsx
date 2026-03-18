import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  FolderOpen,
  Map,
  BarChart3,
  ScrollText,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Radio,
  Shield,
  Zap,
  Fingerprint,
  Crosshair,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/copilot', icon: MessageSquare, label: 'Copilot', accent: true },
  { to: '/entities', icon: Users, label: 'Entities' },
  { to: '/cases', icon: FolderOpen, label: 'Cases' },
  { to: '/map', icon: Map, label: 'Map' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/investigation', icon: Fingerprint, label: 'Investigation' },
  { to: '/op-intel', icon: Crosshair, label: 'Op. Intel', accent: true },
];

const adminItems = [
  { to: '/audit-log', icon: ScrollText, label: 'Audit Log', roles: ['admin', 'auditor'] },
];

export default function Layout() {
  const { user, logout, hasRole } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {/* Sidebar */}
      <aside
        className={`flex flex-col bg-slate-900/80 border-r border-slate-800/50 transition-all duration-300 ease-in-out backdrop-blur-xl ${
          collapsed ? 'w-[68px]' : 'w-60'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-800/50 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20">
            <Radio className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="flex flex-col animate-fade-in">
              <span className="text-sm font-bold gradient-text tracking-wide">TIAC</span>
              <span className="text-[10px] text-slate-500 leading-none">Telecom Intelligence</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2.5 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
                  isActive
                    ? 'bg-blue-500/15 text-blue-400 shadow-lg shadow-blue-500/5 border border-blue-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`
              }
            >
              <item.icon className="shrink-0 transition-transform duration-200 group-hover:scale-110" size={18} />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && item.accent && (
                <Zap size={10} className="ml-auto text-amber-400" />
              )}
            </NavLink>
          ))}

          {/* Divider before admin */}
          {adminItems.some((item) => hasRole(item.roles)) && (
            <div className="my-3 mx-3 border-t border-slate-800/50" />
          )}

          {adminItems
            .filter((item) => hasRole(item.roles))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
                    isActive
                      ? 'bg-blue-500/15 text-blue-400 shadow-lg shadow-blue-500/5 border border-blue-500/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                  }`
                }
              >
                <item.icon className="shrink-0 transition-transform duration-200 group-hover:scale-110" size={18} />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center py-3.5 border-t border-slate-800/50 text-slate-500 hover:text-slate-300 transition-all duration-200 hover:bg-slate-800/40"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 h-14 glass border-b border-slate-800/40 shrink-0 z-10">
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[11px] text-green-400 font-medium">Secure</span>
            </div>
            <span className="text-slate-600">|</span>
            <span className="text-slate-500 font-mono text-xs">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/30 to-indigo-500/30 border border-blue-500/20 flex items-center justify-center">
                <span className="text-xs font-semibold text-blue-300">
                  {user?.fullName?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
              <div>
                <span className="text-sm text-slate-200 font-medium">{user?.fullName || 'User'}</span>
                <span className="ml-2 badge-info text-[10px] uppercase">{user?.role || 'analyst'}</span>
              </div>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline text-xs">Logout</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-gradient-to-b from-slate-950 to-slate-900/50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
