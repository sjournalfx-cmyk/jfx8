import React from 'react';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, leftIcon, rightIcon, children, disabled, 'aria-label': ariaLabel, 'aria-busy': ariaBusy, ...props }, ref) => {
    const variants = {
      primary: 'bg-[#FF4F01] text-white hover:bg-[#FF4F01]/90 shadow-[0_8px_24px_rgba(255,79,1,0.18),0_2px_8px_rgba(255,79,1,0.10)] active:scale-[0.98]',
      secondary: 'bg-zinc-850 text-zinc-100 hover:bg-black border border-zinc-700/50 shadow-[0_4px_16px_rgba(0,0,0,0.40),0_1px_4px_rgba(0,0,0,0.30)] active:scale-[0.98]',
      outline: 'bg-transparent border border-zinc-700 text-zinc-300 hover:bg-black hover:text-white active:scale-[0.98]',
      ghost: 'bg-transparent text-zinc-400 hover:bg-black hover:text-white active:scale-[0.98]',
      destructive: 'bg-rose-600 text-white hover:bg-rose-700 shadow-[0_8px_24px_rgba(239,68,68,0.20),0_2px_8px_rgba(239,68,68,0.10)] active:scale-[0.98]',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-xs min-h-[44px]',
      md: 'px-4 py-2.5 text-sm min-h-[44px]',
      lg: 'px-6 py-3.5 text-base font-bold min-h-[44px]',
      icon: 'p-2.5 min-h-[44px] min-w-[44px]',
    };

    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={isLoading || undefined}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-bold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4F01]/40 disabled:opacity-50 disabled:cursor-not-allowed gap-2 active:scale-[0.98] touch-manipulation select-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="animate-spin" size={18} aria-hidden="true" />
        ) : (
          <>
            {leftIcon && <span className="inline-flex" aria-hidden="true">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="inline-flex" aria-hidden="true">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
