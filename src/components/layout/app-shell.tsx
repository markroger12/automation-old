'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { CalendarClock, ChevronDown, Globe, History, Image, LayoutDashboard, ListOrdered, LogOut, Menu, MessageSquareText, ScanSearch, ScrollText, Settings, Sparkles, Wand2, X } from 'lucide-react';
import { apiFetch } from '@/lib/client/api';
import { cn } from '@/lib/utils';
import { MODULES } from '@/modules/registry';
import { ToastProvider } from '@/components/ui/toast';
import { ModuleIcon } from './module-icon';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
}

const activeModules = MODULES.filter((m) => m.status === 'active');
const upcomingModules = MODULES.filter((m) => m.status === 'coming-soon');

const primaryNav: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  ...activeModules.map((m) => ({ href: m.href, label: m.name, icon: <ModuleIcon name={m.icon} /> })),
  { href: '/workflow', label: 'Workflow', icon: <CalendarClock className="h-4 w-4" /> },
  { href: '/queue', label: 'Article Queue', icon: <ListOrdered className="h-4 w-4" /> },
  { href: '/history', label: 'Article History', icon: <History className="h-4 w-4" /> },
  { href: '/websites', label: 'Websites', icon: <Globe className="h-4 w-4" /> },
  { href: '/image-templates', label: 'Image Template', icon: <Image className="h-4 w-4" /> },
  { href: '/humanizer', label: 'AI Humanizer', icon: <Wand2 className="h-4 w-4" /> },
  { href: '/plagiarism', label: 'Plagiarism Check', icon: <ScanSearch className="h-4 w-4" /> },
  { href: '/prompts', label: 'Prompt Manager', icon: <MessageSquareText className="h-4 w-4" /> },
  { href: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
  { href: '/logs', label: 'Logs', icon: <ScrollText className="h-4 w-4" /> },
];

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white',
      )}
    >
      <span className={active ? 'text-indigo-300' : ''}>{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function Sidebar({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const [showUpcoming, setShowUpcoming] = useState(false);
  return (
    <div className="flex h-full flex-col bg-slate-900">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">Blog Automation</p>
          <p className="text-[11px] text-slate-400">Browser-driven studio</p>
        </div>
      </div>
      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {primaryNav.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}

        <div className="pt-5">
          <button
            type="button"
            onClick={() => setShowUpcoming((s) => !s)}
            className="flex w-full items-center justify-between px-3 py-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase hover:text-slate-300"
          >
            More modules
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showUpcoming && 'rotate-180')} />
          </button>
          {showUpcoming && (
            <div className="mt-1 space-y-0.5">
              {upcomingModules.map((m) => (
                <Link
                  key={m.key}
                  href={m.href}
                  onClick={onNavigate}
                  className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-white/5 hover:text-slate-300"
                >
                  <ModuleIcon name={m.icon} />
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">Soon</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}

export function AppShell({ userEmail, children }: { userEmail: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  };

  return (
    <ToastProvider>
      <div className="min-h-full">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
          <Sidebar pathname={pathname} />
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-64">
              <Sidebar pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </div>
            <button type="button" className="absolute top-4 left-66 rounded-md bg-white p-1.5" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        <div className="lg:pl-64">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur sm:px-6">
            <button type="button" className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex-1" />
            <span className="hidden text-sm text-slate-500 sm:inline">{userEmail}</span>
            <button type="button" onClick={logout} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
