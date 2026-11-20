import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { NotificationItem } from '../types';

interface ErrorNotificationsProps {
  notifications: NotificationItem[];
  onDismiss: (id: string) => void;
}

const STYLES: Record<
  NotificationItem['type'],
  {
    container: string;
    icon: typeof AlertCircle;
    iconClass: string;
    label: string;
  }
> = {
  error: {
    container:
      'bg-white dark:bg-slate-900 border-red-200 dark:border-red-900/70 text-slate-900 dark:text-slate-100',
    icon: AlertCircle,
    iconClass: 'text-red-600 dark:text-red-400',
    label: 'Error',
  },
  warning: {
    container:
      'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-900/70 text-slate-900 dark:text-slate-100',
    icon: AlertTriangle,
    iconClass: 'text-amber-600 dark:text-amber-400',
    label: 'Warning',
  },
  success: {
    container:
      'bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-900/70 text-slate-900 dark:text-slate-100',
    icon: CheckCircle2,
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    label: 'Success',
  },
  info: {
    container:
      'bg-white dark:bg-slate-900 border-blue-200 dark:border-blue-900/70 text-slate-900 dark:text-slate-100',
    icon: Info,
    iconClass: 'text-blue-600 dark:text-blue-400',
    label: 'Notice',
  },
};

export function ErrorNotifications({ notifications, onDismiss }: ErrorNotificationsProps) {
  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex w-full max-w-md flex-col gap-2.5 px-4 sm:px-0 pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {notifications.map((item) => {
          const style = STYLES[item.type];
          const Icon = style.icon;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              role={item.type === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-lg shadow-slate-950/5 dark:shadow-black/30 ${style.container}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100">
                  {item.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {item.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(item.id)}
                aria-label={`Dismiss ${style.label.toLowerCase()} notification`}
                className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
