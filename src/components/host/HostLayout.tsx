import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  ChevronDown,
  ClipboardList,
  Database,
  FileSearch,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PieChart,
  Radio,
  ScrollText,
  Server,
  Settings,
  User,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AmbientCanvas } from '../common/AmbientCanvas.tsx';
import { BrandMark } from '../common/BrandMark.tsx';
import { ThemeToggle } from '../common/ThemeToggle.tsx';
import { HostOverview } from './HostOverview.tsx';
import { AssessmentManager } from './AssessmentManager.tsx';
import { AssessmentBuilder } from './AssessmentBuilder.tsx';
import { ReviewPanel } from './ReviewPanel.tsx';
import { QuizAnalyticsView } from './QuizAnalyticsView.tsx';
import { PollAnalyticsView } from './PollAnalyticsView.tsx';
import { SessionsView } from './SessionsView.tsx';
import { StudentDatabaseView } from './StudentDatabaseView.tsx';
import { DataRetrievalView } from './DataRetrievalView.tsx';
import { ServerManagementView } from './ServerManagementView.tsx';
import { HostManagementView } from './HostManagementView.tsx';
import { AuditLogsView, SettingsView } from './AuditAndSettingsViews.tsx';
import { LaunchSessionModal } from './LaunchSessionModal.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { useRealtime } from '../../hooks/useRealtime.ts';
import type { AssessmentDTO, AssessmentType, SessionDTO } from '../../../shared/types.ts';

type NavTab =
  | 'overview'
  | 'quizzes'
  | 'polls'
  | 'live'
  | 'students'
  | 'retrieval'
  | 'quiz-analytics'
  | 'poll-analytics'
  | 'history'
  | 'hosts'
  | 'servers'
  | 'audit'
  | 'settings';

interface NavGroup {
  label: string;
  items: Array<{
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}

export function HostLayout() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  // Sub-views
  const [builderState, setBuilderState] = useState<{
    type: AssessmentType;
    id: string | null;
  } | null>(null);
  const [reviewAssessment, setReviewAssessment] = useState<AssessmentDTO | null>(null);
  const [analyticsTargetId, setAnalyticsTargetId] = useState<string | null>(null);
  const [retrievalEmail, setRetrievalEmail] = useState<string | null>(null);
  const [launchModalSession, setLaunchModalSession] = useState<SessionDTO | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Close account dropdown on outside click
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    if (accountMenuOpen) {
      document.addEventListener('mousedown', onPointerDown);
    }
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [accountMenuOpen]);

  // Live SSE updates refresh active Host Command Centre views seamlessly
  useRealtime(
    true,
    () => {
      setRefreshTick((n) => n + 1);
    },
    () => {
      setRefreshTick((n) => n + 1);
    }
  );

  const canManageServers = user?.role === 'platform_admin' || Boolean(user?.serverAdmin);

  const navGroups: NavGroup[] = [
    {
      label: 'Workspace',
      items: [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'quizzes', label: 'Quiz Generator', icon: ClipboardList },
        { id: 'polls', label: 'Poll Generator', icon: PieChart },
        { id: 'live', label: 'Live Sessions', icon: Radio },
      ],
    },
    {
      label: 'Classroom & Insights',
      items: [
        { id: 'students', label: 'Student Database', icon: Users },
        { id: 'retrieval', label: 'Data Retrieval', icon: FileSearch },
        { id: 'quiz-analytics', label: 'Quiz Analytics', icon: BarChart3 },
        { id: 'poll-analytics', label: 'Poll Analytics', icon: Database },
        { id: 'history', label: 'Session History', icon: History },
      ],
    },
    {
      label: 'Administration',
      items: [
        { id: 'hosts', label: 'Host Access', icon: UserPlus },
        ...(canManageServers ? [{ id: 'servers' as NavTab, label: 'Server Management', icon: Server }] : []),
        { id: 'audit', label: 'Audit Logs', icon: ScrollText },
        { id: 'settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  const allNavItems = navGroups.flatMap((g) => g.items);

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    setBuilderState(null);
    setReviewAssessment(null);
    setMobileMenuOpen(false);
    setAccountMenuOpen(false);
  };

  const handleQuickQuiz = () => {
    setReviewAssessment(null);
    setActiveTab('quizzes');
    setBuilderState({ type: 'quiz', id: null });
  };

  const initials = (user?.displayName || user?.email || 'H')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full relative overflow-hidden rounded-[inherit]">
      {/* Subtle luminous orchid top-left & bottom-right glass highlights inside purple sidebar */}
      <div
        className="pointer-events-none absolute -top-14 -left-14 w-48 h-48 rounded-full opacity-45 blur-2xl"
        style={{
          background: 'radial-gradient(circle, rgba(216, 180, 254, 0.55) 0%, transparent 72%)',
        }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-12 -right-12 w-56 h-56 rounded-full opacity-40 blur-2xl"
        style={{
          background: 'radial-gradient(circle, rgba(192, 132, 252, 0.50) 0%, transparent 72%)',
        }}
        aria-hidden="true"
      />

      {/* Brand Header */}
      <div className="px-5 pt-6 pb-4 flex items-center justify-between relative z-10">
        <BrandMark size="sm" inverted />
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 rounded-full text-purple-100 hover:bg-white/15 cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-3.5 py-2 space-y-5 relative z-10" aria-label="Host navigation">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 pb-1 text-xs font-medium text-purple-200/80">
              {group.label}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isCurrent = activeTab === item.id && !builderState && !reviewAssessment;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTab(item.id)}
                  className={`relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-full text-[13.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    isCurrent
                      ? 'text-[#5B21B6] dark:text-white font-semibold'
                      : 'text-white/90 hover:bg-white/15 hover:text-white'
                  }`}
                >
                  {isCurrent && (
                    <motion.span
                      layoutId="hostNavActive"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      className="absolute inset-0 rounded-full tp-nav-pill-active"
                    />
                  )}
                  <Icon
                    className={`w-[17px] h-[17px] shrink-0 relative z-10 ${
                      isCurrent ? 'text-[#7C3AED] dark:text-[#E9D5FF]' : 'text-purple-200'
                    }`}
                  />
                  <span className="truncate relative z-10">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom Floating Account Dock + Pill Sign Out */}
      <div className="p-3.5 space-y-2.5 relative z-10">
        <button
          type="button"
          onClick={() => handleSelectTab('settings')}
          className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-[20px] bg-white/12 border border-white/22 hover:bg-white/18 backdrop-blur-md transition-colors cursor-pointer"
        >
          <div
            className="w-9 h-9 rounded-full bg-white/95 dark:bg-[#23194D] text-[#6D28D9] dark:text-[#E9D5FF] border border-transparent dark:border-white/15 font-display font-bold text-xs flex items-center justify-center shrink-0 shadow-xs"
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white truncate">{user?.displayName}</p>
            <p className="text-[11px] text-purple-100/80 truncate">{user?.email}</p>
            <p className="text-[11px] font-semibold text-[#E9D5FF]">
              {user?.role === 'platform_admin' ? 'Primary Host' : 'Host'}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => void logout()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-white/16 hover:bg-white/26 border border-white/30 text-xs font-semibold text-white backdrop-blur-md transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5 text-purple-100" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  const currentTabLabel = allNavItems.find((i) => i.id === activeTab)?.label || 'Overview';
  const currentBreadcrumb = builderState
    ? builderState.type === 'quiz'
      ? 'Quiz Builder'
      : 'Poll Builder'
    : reviewAssessment
    ? 'Submission Review'
    : currentTabLabel;

  const viewKey = builderState
    ? `builder-${builderState.type}-${builderState.id || 'new'}`
    : reviewAssessment
    ? `review-${reviewAssessment.id}`
    : activeTab;

  const isOverviewHome = activeTab === 'overview' && !builderState && !reviewAssessment;

  return (
    <div className="min-h-screen tp-purple-glass-bg flex relative">
      <AmbientCanvas variant="purple" />

      {/* Desktop Floating Detached Liquid Glass Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[252px] lg:fixed lg:top-4 lg:bottom-4 lg:left-4 tp-glass-rail rounded-[30px] z-30">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Frosted Navigation Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex p-3">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-[#1E1042]/45 dark:bg-black/70 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: '-105%' }}
              animate={{ x: 0 }}
              exit={{ x: '-105%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-72 max-w-[85vw] tp-glass-rail rounded-[30px] h-full z-10"
            >
              {renderSidebarContent()}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Column */}
      <div className="flex-1 lg:pl-[284px] flex flex-col min-w-0 relative z-10 px-4 sm:px-5 lg:pr-5 pt-4 pb-8">
        {/* Floating Detached Liquid Glass Pill Header */}
        <header className="sticky top-4 z-20 h-14 tp-glass-bar rounded-full px-4 sm:px-6 flex items-center justify-between gap-4 w-full">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden tp-glass-btn p-2 rounded-full text-[#0F1035] dark:text-[#F4F2FF] cursor-pointer"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-[#3E3963] dark:text-[#C5BFE4] font-medium hidden sm:inline truncate">
                {user?.institutionName || 'ThinkPulse'}
              </span>
              <span className="text-[#8B87A8] dark:text-[#8E88B0] hidden sm:inline" aria-hidden="true">/</span>
              <span className="font-display font-bold text-[#7C3AED] dark:text-[#C4B5FD] truncate">
                {currentBreadcrumb}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!builderState && !isOverviewHome && (
              <button
                type="button"
                onClick={handleQuickQuiz}
                className="tp-gradient-btn text-white inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Quick Quiz</span>
              </button>
            )}

            <ThemeToggle compact />

            <button
              type="button"
              onClick={() => handleSelectTab('audit')}
              title="Institutional audit activity"
              aria-label="View institutional audit logs"
              className="w-9 h-9 rounded-full tp-glass-btn flex items-center justify-center text-[#1E1B4B] dark:text-[#E9D5FF] cursor-pointer"
            >
              <Bell className="w-4 h-4" />
            </button>

            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                aria-expanded={accountMenuOpen}
                aria-label="Account menu"
                className="h-9 pl-1.5 pr-2.5 rounded-full tp-glass-btn inline-flex items-center gap-1.5 text-[#1E1B4B] dark:text-[#F4F2FF] cursor-pointer"
              >
                <span className="w-7 h-7 rounded-full bg-[#7C3AED]/14 dark:bg-[#8B5CF6]/28 text-[#6D28D9] dark:text-[#E9D5FF] flex items-center justify-center">
                  <User className="w-3.5 h-3.5" />
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-[#55587D] dark:text-[#A49EC6]" />
              </button>

              <AnimatePresence>
                {accountMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={{ duration: 0.14 }}
                    className="absolute right-0 mt-2 w-60 tp-modal-glass rounded-[22px] p-2 z-40"
                  >
                    <div className="px-3 py-2 border-b border-[#17143A]/8 dark:border-white/10">
                      <p className="text-xs font-bold text-[#0F1035] dark:text-[#F4F2FF] truncate">{user?.displayName}</p>
                      <p className="text-[11px] text-[#55587D] dark:text-[#A49EC6] truncate">{user?.email}</p>
                    </div>
                    <div className="pt-1.5 space-y-1">
                      <button
                        type="button"
                        onClick={() => handleSelectTab('hosts')}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-[#1E1B4B] dark:text-[#E5E0FF] hover:bg-white/75 dark:hover:bg-white/10 cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#C4B5FD]" />
                        <span>Add / Manage Hosts</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectTab('settings')}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-[#1E1B4B] dark:text-[#E5E0FF] hover:bg-white/75 dark:hover:bg-white/10 cursor-pointer"
                      >
                        <Settings className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#C4B5FD]" />
                        <span>Workspace Settings</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void logout()}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-50/80 dark:hover:bg-rose-950/60 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="flex-1 pt-4 w-full">
          <motion.div
            key={viewKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {builderState ? (
              <AssessmentBuilder
                type={builderState.type}
                assessmentId={builderState.id}
                onBack={() => setBuilderState(null)}
                onSaved={() => setRefreshTick((n) => n + 1)}
                onLaunched={(sess) => {
                  setBuilderState(null);
                  setLaunchModalSession(sess);
                  setRefreshTick((n) => n + 1);
                }}
              />
            ) : reviewAssessment ? (
              <ReviewPanel
                assessment={reviewAssessment}
                refreshTick={refreshTick}
                onBack={() => setReviewAssessment(null)}
              />
            ) : activeTab === 'overview' ? (
              <HostOverview
                refreshTick={refreshTick}
                onNavigate={(t) => handleSelectTab(t as NavTab)}
                onOpenSessionModal={setLaunchModalSession}
                onQuickCreate={(type) => {
                  setActiveTab(type === 'quiz' ? 'quizzes' : 'polls');
                  setBuilderState({ type, id: null });
                }}
              />
            ) : activeTab === 'quizzes' ? (
              <AssessmentManager
                type="quiz"
                refreshTick={refreshTick}
                onCreate={() => setBuilderState({ type: 'quiz', id: null })}
                onEdit={(id) => setBuilderState({ type: 'quiz', id })}
                onReview={(a) => setReviewAssessment(a)}
                onAnalytics={(a) => {
                  setAnalyticsTargetId(a.id);
                  setActiveTab('quiz-analytics');
                }}
                onOpenSessionModal={setLaunchModalSession}
              />
            ) : activeTab === 'polls' ? (
              <AssessmentManager
                type="poll"
                refreshTick={refreshTick}
                onCreate={() => setBuilderState({ type: 'poll', id: null })}
                onEdit={(id) => setBuilderState({ type: 'poll', id })}
                onReview={() => {}}
                onAnalytics={(a) => {
                  setAnalyticsTargetId(a.id);
                  setActiveTab('poll-analytics');
                }}
                onOpenSessionModal={setLaunchModalSession}
              />
            ) : activeTab === 'live' ? (
              <SessionsView
                mode="active"
                refreshTick={refreshTick}
                onOpenSessionModal={setLaunchModalSession}
              />
            ) : activeTab === 'history' ? (
              <SessionsView
                mode="past"
                refreshTick={refreshTick}
                onOpenSessionModal={setLaunchModalSession}
              />
            ) : activeTab === 'students' ? (
              <StudentDatabaseView
                refreshTick={refreshTick}
                onInspectStudentEmail={(email) => {
                  setRetrievalEmail(email);
                  setActiveTab('retrieval');
                }}
              />
            ) : activeTab === 'retrieval' ? (
              <DataRetrievalView initialEmail={retrievalEmail} />
            ) : activeTab === 'quiz-analytics' ? (
              <QuizAnalyticsView initialAssessmentId={analyticsTargetId} refreshTick={refreshTick} />
            ) : activeTab === 'poll-analytics' ? (
              <PollAnalyticsView initialAssessmentId={analyticsTargetId} refreshTick={refreshTick} />
            ) : activeTab === 'hosts' ? (
              <HostManagementView refreshTick={refreshTick} />
            ) : activeTab === 'servers' ? (
              <ServerManagementView />
            ) : activeTab === 'audit' ? (
              <AuditLogsView refreshTick={refreshTick} />
            ) : (
              <SettingsView />
            )}
          </motion.div>
        </main>
      </div>

      <LaunchSessionModal
        session={launchModalSession}
        onClose={() => setLaunchModalSession(null)}
        onSessionUpdated={(updated) => {
          setLaunchModalSession(updated.effectiveStatus === 'active' ? updated : null);
          setRefreshTick((n) => n + 1);
        }}
      />
    </div>
  );
}
