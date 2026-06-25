import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface TooltipProps {
  content: React.ReactNode;
  children?: React.ReactNode;
  isDarkMode: boolean;
  position?: 'top' | 'bottom' | 'left' | 'right';
  compact?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, isDarkMode, position = 'top', compact = false }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [showTimeout, setShowTimeout] = useState<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    const timeout = setTimeout(() => {
      setIsVisible(true);
    }, 300);
    setShowTimeout(timeout);
  };

  const handleMouseLeave = () => {
    if (showTimeout) clearTimeout(showTimeout);
    setIsVisible(false);
  };

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children || <HelpCircle size={14} className="opacity-40 cursor-help hover:opacity-100 transition-opacity" />}
      
      {isVisible && (
        <div className={`absolute z-[500] ${compact ? 'w-56 p-2 rounded-lg text-[9px] font-semibold leading-snug' : 'w-72 p-3 rounded-xl text-[10px] font-bold leading-relaxed'} shadow-2xl border backdrop-blur-md animate-in fade-in zoom-in-95 duration-200 ${positionClasses[position]} ${
          isDarkMode ? 'bg-[#000000]/95 border-zinc-800 text-zinc-300' : 'bg-white/95 border-slate-200 text-slate-600'
        }`}>
          {content}
          <div className={`absolute w-2 h-2 rotate-45 border-r border-b ${isDarkMode ? 'bg-[#000000] border-zinc-800' : 'bg-white border-slate-200'} ${
            position === 'top' ? 'top-full left-1/2 -translate-x-1/2 -translate-y-1/2 border-t-0 border-l-0' :
            position === 'bottom' ? 'bottom-full left-1/2 -translate-x-1/2 translate-y-1/2 border-t-0 border-l-0 rotate-[225deg]' :
            ''
          }`} />
        </div>
      )}
    </div>
  );
};
