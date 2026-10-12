import React from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  isDarkMode?: boolean;
}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, leftIcon, rightIcon, isDarkMode, id, ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-0.5"
          >
            {label}
          </label>
        )}
        <div className="relative group">
          {leftIcon && (
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-[#FF4F01] transition-colors z-10 pointer-events-none">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className={cn(
              'w-full rounded-xl border-0 outline-none font-medium transition-all text-sm py-3 px-4 min-h-[44px] touch-manipulation',
              leftIcon && 'pl-11',
              rightIcon && 'pr-11',
              props.disabled && 'cursor-not-allowed opacity-60',
              isDarkMode
                ? 'bg-[#0a0a0a] border-0 text-zinc-100 placeholder-zinc-600 focus:bg-[#141414] focus:border-0 focus:ring-4 focus:ring-[var(--jfx-accent-soft)]'
                : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-[#FF4F01] focus:ring-4 focus:ring-[#FF4F01]/5',
              error && 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/5',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 z-10">
              {rightIcon}
            </div>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-[11px] font-bold text-rose-500 uppercase tracking-wider mt-0.5">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
