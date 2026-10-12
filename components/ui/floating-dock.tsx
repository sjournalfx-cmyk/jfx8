import { cn } from "../../lib/utils";
import { IconLayoutNavbarCollapse, IconTrash } from "@tabler/icons-react";
import {
  AnimatePresence,
  motion,
} from "motion/react";
import { useRef, useState } from "react";

export interface FloatingDockItem {
  title: string;
  icon: React.ReactNode;
  onClick?: () => void;
  isActive?: boolean;
  isLocked?: boolean;
  /**
   * Non-plan lock: the item exists but the current context cannot use it (e.g.
   * broker/bridge connections are unavailable on Manual portfolios). Renders
   * like `isLocked` but states `disabledReason` instead of "Upgrade to unlock",
   * which would be a lie here.
   */
  isDisabled?: boolean;
  disabledReason?: string;
  description?: string;
  badge?: number | boolean;
  secondaryAction?: {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
  };
  type?: 'item' | 'divider';
}

export const FloatingDock = ({
  items,
  desktopClassName,
  showLabels = false,
}: {
  items: FloatingDockItem[];
  desktopClassName?: string;
  showLabels?: boolean;
}) => {
  return (
    <FloatingDockDesktop items={items} className={desktopClassName} showLabels={showLabels} />
  );
};

const FloatingDockDesktop = ({
  items,
  className,
  showLabels,
}: {
  items: FloatingDockItem[];
  className?: string;
  showLabels?: boolean;
}) => {
  return (
    <motion.div
      layout
      className={cn(
        "mx-auto flex flex-col h-fit items-start gap-2 rounded-2xl w-full",
        className,
      )}
    >
      {items.map((item, idx) => (
        item.type === 'divider' ? (
          <div key={`divider-${idx}`} className="w-full px-2 my-1">
            <div className="h-px w-full border-t border-dashed border-zinc-200 dark:border-zinc-800/50" />
          </div>
        ) : (
          <IconContainer key={item.title} showLabels={showLabels} {...item} />
        )
      ))}
    </motion.div>
  );
};

function IconContainer({
  title,
  icon,
  onClick,
  isActive,
  isLocked,
  isDisabled = false,
  disabledReason,
  description,
  showLabels,
  badge,
  secondaryAction
}: FloatingDockItem & { showLabels?: boolean }) {
  let ref = useRef<HTMLDivElement>(null);

  // Base sizes (fixed)
  let width = 36;
  let height = 36;
  let widthIcon = 18;
  let heightIcon = 18;

  const [hovered, setHovered] = useState(false);

  return (
    <div className="flex items-center w-full group/btn relative">
      <motion.div 
        className="flex items-center w-full outline-none justify-start"
        animate={{ 
            gap: showLabels ? "0.75rem" : "0rem"
        }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        <motion.div
          ref={ref}
          layout="position"
          style={{ width, height }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={isLocked || isDisabled ? undefined : onClick}
          aria-disabled={isLocked || isDisabled ? true : undefined}
          title={isDisabled ? disabledReason : undefined}
          className={cn(
            "relative flex aspect-square items-center justify-center rounded-full shrink-0 cursor-pointer transition-all duration-300",
            isActive 
              ? "bg-[#FF4F01] text-white shadow-lg shadow-[#FF4F01]/30 scale-110" 
              : "bg-transparent hover:bg-slate-100 dark:hover:bg-black/50 border border-transparent hover:border-slate-200 dark:hover:border-zinc-800 text-slate-500 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-zinc-100",
            (isLocked || isDisabled) && "opacity-40 cursor-not-allowed"
          )}
        >
          <AnimatePresence>
            {hovered && !showLabels && (
              <motion.div
                initial={{ opacity: 0, x: 10, y: "-50%", scale: 0.8 }}
                animate={{ opacity: 1, x: 50, y: "-50%", scale: 1 }}
                exit={{ opacity: 0, x: 10, y: "-50%", scale: 0.8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="absolute left-0 top-1/2 w-fit rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium whitespace-pre text-slate-700 dark:border-zinc-800 dark:bg-black dark:text-white z-[100] shadow-xl flex flex-col gap-1.5 min-w-[140px]"
              >
                <span className="font-bold">{title}</span>
                {description && (
                  <span className="text-[10px] opacity-60 font-normal">{description}</span>
                )}
                {isLocked && (
                  <div className="flex items-center gap-1.5 text-[9px] text-amber-500 font-black uppercase tracking-widest border-t border-zinc-500/10 pt-1.5 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Upgrade to unlock
                  </div>
                )}
                {isDisabled && !isLocked && (
                  <div className="text-[9px] text-zinc-500 font-black uppercase tracking-widest border-t border-zinc-500/10 pt-1.5 mt-0.5">
                    {disabledReason || 'Unavailable'}
                  </div>
                )}
                {secondaryAction && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            secondaryAction.onClick();
                        }}
                        className="flex items-center gap-1.5 text-[9px] text-rose-500 hover:text-rose-600 border-t border-zinc-500/10 pt-1.5 mt-0.5 font-black uppercase tracking-widest pointer-events-auto"
                    >
                        {secondaryAction.icon || <IconTrash size={10} />}
                        {secondaryAction.label}
                    </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <motion.div
            style={{ width: widthIcon, height: heightIcon }}
            className="flex items-center justify-center"
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {icon}
          </motion.div>
          {badge && (
              <div className={cn(
                  "absolute -top-1 -right-1 bg-indigo-500 rounded-full flex items-center justify-center border-2 border-white dark:border-zinc-950",
                  typeof badge === 'number' ? "w-4 h-4 text-white text-[8px] font-bold" : "w-2.5 h-2.5 animate-pulse"
              )}>
                  {typeof badge === 'number' ? badge : null}
              </div>
          )}
        </motion.div>
        <AnimatePresence mode="popLayout">
          {showLabels && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="flex-1 flex items-center justify-between min-w-0 pr-2 overflow-hidden"
            >
              <span className={cn(
                "text-xs font-bold truncate transition-colors whitespace-nowrap",
                isActive ? "text-[#FF4F01]" : "text-zinc-500 group-hover/btn:text-zinc-800 dark:group-hover/btn:text-zinc-200"
              )}>
                {title}
              </span>
              {secondaryAction && hovered && (
                  <motion.button
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      onClick={(e) => {
                          e.stopPropagation();
                          secondaryAction.onClick();
                      }}
                      className="p-1 rounded bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-colors shrink-0"
                      title={secondaryAction.label}
                  >
                      <IconTrash size={12} />
                  </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
