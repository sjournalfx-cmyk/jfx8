import React from 'react';
import { Input } from '../../ui/Input';
import { cn } from '../../../lib/utils';

interface LinkTradesSetupInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isDarkMode: boolean;
  maxLength?: number;
}

export const LinkTradesSetupInput: React.FC<LinkTradesSetupInputProps> = ({
  value,
  onChange,
  placeholder = 'EURUSD 3-Trade Setup',
  isDarkMode,
  maxLength = 80,
}) => {
  const inputId = 'link-trades-setup-name';
  return (
    <div className="w-full min-w-0">
      <Input
        id={inputId}
        label="Setup name"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        isDarkMode={isDarkMode}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'focus:border-zinc-500 focus:ring-zinc-500/10',
          isDarkMode ? 'focus:bg-zinc-900' : undefined
        )}
      />
      <div
        className={cn(
          'mt-1.5 flex items-center justify-between text-[11px]',
          isDarkMode ? 'text-zinc-600' : 'text-slate-400'
        )}
      >
        <span>Used in Journal search.</span>
        <span aria-hidden>
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  );
};
