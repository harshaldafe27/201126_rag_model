import {
  BookOpen,
  FileText,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  Plus,
  X,
} from 'lucide-react';
import { formatRelativeTime } from '../lib/validation';
import type { Conversation, NavigationSection } from '../types';

interface SidebarProps {
  activeSection: NavigationSection;
  onSelectSection: (section: NavigationSection) => void;
  documentCount: number;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeSection,
  onSelectSection,
  documentCount,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navItems: Array<{
    id: NavigationSection;
    label: string;
    icon: typeof LayoutDashboard;
    count?: number;
  }> = [
    { id: 'home', label: 'Dashboard Home', icon: LayoutDashboard },
    { id: 'documents', label: 'Documents', icon: FileText, count: documentCount },
    { id: 'tutor', label: 'AI Tutor', icon: MessageSquare, count: conversations.length },
  ];

  const handleNavClick = (id: NavigationSection) => {
    onSelectSection(id);
    onCloseMobile();
  };

  const handleConversationClick = (id: string) => {
    onSelectConversation(id);
    onSelectSection('tutor');
    onCloseMobile();
  };

  const handleCreateChat = () => {
    onNewConversation();
    onSelectSection('tutor');
    onCloseMobile();
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      {/* Brand header */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => handleNavClick('home')}
          className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-lg"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <GraduationCap className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="block font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 leading-none">
              .Aai
            </span>
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400 truncate">
              The teacher, understand you
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Primary navigation */}
      <nav aria-label="Main navigation" className="px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.count === 'number' && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    isActive
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Recent conversations rail */}
      <div className="flex-1 overflow-y-auto border-t border-slate-200 dark:border-slate-800 px-3 py-4">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Recent Conversations
          </span>
          <button
            type="button"
            onClick={handleCreateChat}
            title="Start new conversation"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>New</span>
          </button>
        </div>

        {conversations.length === 0 ? (
          <div className="px-2 py-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            No study sessions yet. Upload a document and start asking questions.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {conversations.slice(0, 8).map((conv) => {
              const isSelected = activeSection === 'tutor' && activeConversationId === conv.id;
              return (
                <li key={conv.id}>
                  <button
                    type="button"
                    onClick={() => handleConversationClick(conv.id)}
                    className={`group flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      isSelected
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'
                    }`}
                  >
                    <span className="truncate text-xs font-medium w-full">{conv.title}</span>
                    <span className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer note */}
      <div className="border-t border-slate-200 dark:border-slate-800 px-5 py-3.5">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          <span className="truncate">Saved locally on this device</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside className="hidden lg:block lg:w-[260px] lg:shrink-0 h-screen sticky top-0">
        {sidebarContent}
      </aside>

      {/* Mobile / Tablet drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-[280px] max-w-[85vw] h-full">{sidebarContent}</aside>
        </div>
      )}
    </>
  );
}
