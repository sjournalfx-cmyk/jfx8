import React from 'react';
import { FileText, TrendingUp, Target, BookOpen, Plus, Search } from 'lucide-react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = "" }) => {
  return (
    <div 
      className={`animate-pulse bg-zinc-200 dark:bg-black rounded ${className}`}
    />
  );
};

interface EmptyStateProps {
  isDarkMode: boolean;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  type?: 'trades' | 'notes' | 'goals' | 'analytics' | 'search' | 'custom';
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ isDarkMode, title, description, action, type = 'custom', icon }) => {
  const defaultIcons = {
    trades: <FileText size={48} strokeWidth={1} className="opacity-20" />,
    notes: <BookOpen size={48} strokeWidth={1} className="opacity-20" />,
    goals: <Target size={48} strokeWidth={1} className="opacity-20" />,
    analytics: <TrendingUp size={48} strokeWidth={1} className="opacity-20" />,
    search: <Search size={48} strokeWidth={1} className="opacity-20" />,
    custom: <FileText size={48} strokeWidth={1} className="opacity-20" />,
  };

  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-8 text-center">
      <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 ${isDarkMode ? 'bg-black/50' : 'bg-slate-100'}`}>
        {icon || defaultIcons[type]}
      </div>
      <h3 className={`text-lg font-bold mb-2 ${isDarkMode ? 'text-zinc-300' : 'text-slate-700'}`}>
        {title}
      </h3>
      <p className={`text-sm max-w-2xl leading-relaxed whitespace-normal break-normal mb-6 ${isDarkMode ? 'text-zinc-500' : 'text-slate-500'}`}>
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="flex items-center gap-2 px-6 py-3 bg-[#FF4F01] hover:bg-[#e64601] text-white rounded-xl text-sm font-bold shadow-lg shadow-[#FF4F01]/20 transition-all hover:scale-105 active:scale-95"
        >
          <Plus size={16} />
          {action.label}
        </button>
      )}
    </div>
  );
};

export const JournalSkeleton: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => (
  <div className="space-y-3 p-4">
    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
      <div key={i} className={`flex items-center gap-4 p-4 rounded-xl border ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100'}`}>
        <Skeleton className="w-5 h-5 rounded" />
        <div className="flex-1 space-y-2">
          <div className="flex gap-4">
            <Skeleton className="w-24 h-4" />
            <Skeleton className="w-16 h-4" />
          </div>
          <Skeleton className="w-full h-3" />
        </div>
        <Skeleton className="w-20 h-6 rounded-full" />
        <Skeleton className="w-24 h-4" />
      </div>
    ))}
  </div>
);

export const AnalyticsSkeleton: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => (
  <div className="space-y-6 p-6">
    <div className="grid grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100'}`}>
          <Skeleton className="w-8 h-8 rounded-lg mb-3" />
          <Skeleton className="w-20 h-6 mb-2" />
          <Skeleton className="w-16 h-4" />
        </div>
      ))}
    </div>
    <div className="grid grid-cols-3 gap-6">
      <div className={`col-span-2 p-6 rounded-xl border ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100'}`}>
        <Skeleton className="w-32 h-6 mb-6" />
        <Skeleton className="w-full h-48" />
      </div>
      <div className={`p-6 rounded-xl border ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100'}`}>
        <Skeleton className="w-24 h-6 mb-6" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-3 h-3 rounded-full" />
              <Skeleton className="flex-1 h-4" />
              <Skeleton className="w-12 h-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export const NotesSkeleton: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => (
  <div className="grid grid-cols-3 gap-4 p-6">
    {[1, 2, 3, 4, 5, 6].map((i) => (
      <div key={i} className={`p-5 rounded-xl border min-h-[150px] ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100'}`}>
        <Skeleton className="w-3/4 h-5 mb-3" />
        <Skeleton className="w-full h-3 mb-2" />
        <Skeleton className="w-full h-3 mb-2" />
        <Skeleton className="w-2/3 h-3" />
        <div className="flex gap-2 mt-4">
          <Skeleton className="w-12 h-4 rounded-full" />
          <Skeleton className="w-16 h-4 rounded-full" />
        </div>
      </div>
    ))}
  </div>
);

export const GoalsSkeleton: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => (
  <div className="space-y-4 p-6">
    {[1, 2, 3].map((i) => (
      <div key={i} className={`p-6 rounded-xl border ${isDarkMode ? 'bg-[#000000] border-[#27272a]' : 'bg-white border-slate-100'}`}>
        <div className="flex items-start justify-between mb-4">
          <div className="space-y-2">
            <Skeleton className="w-32 h-5" />
            <Skeleton className="w-48 h-4" />
          </div>
          <Skeleton className="w-20 h-8 rounded-full" />
        </div>
        <Skeleton className="w-full h-3" />
        <div className="flex justify-between mt-2">
          <Skeleton className="w-24 h-3" />
          <Skeleton className="w-16 h-3" />
        </div>
      </div>
    ))}
  </div>
);
