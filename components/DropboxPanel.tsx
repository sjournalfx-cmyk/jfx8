import React, { useState, useCallback } from 'react';
import { Copy, Check, FileText, FileImage, FileSpreadsheet, FileArchive, File as FileIcon, ExternalLink, Clock } from 'lucide-react';
import { useToast } from './ui/Toast';

export type DropboxFile = {
  id: string;
  name: string;
  path: string;
  // Dropbox display path e.g. "/Journal/trades_2026.csv"
  dropboxPath: string;
  size?: string;
  modifiedAt: string; // ISO or display
  mimeType?: string;
  thumbnailUrl?: string;
  url?: string; // share link
};

type DropboxPanelProps = {
  isDarkMode?: boolean;
  files?: DropboxFile[];
  onOpenFile?: (file: DropboxFile) => void;
  onDuplicateFile?: (file: DropboxFile) => Promise<void> | void;
  maxVisible?: number;
  title?: string;
};

// Default mock recent files — replace with real Dropbox API data
const DEFAULT_RECENT_FILES: DropboxFile[] = [
  { id: '1', name: 'trades_2026.csv', path: '/Journal/trades_2026.csv', dropboxPath: '/Journal/trades_2026.csv', size: '3.5 KB', modifiedAt: new Date(Date.now() - 1000 * 60 * 23).toISOString(), mimeType: 'text/csv' },
  { id: '2', name: 'EURUSD_backtest.json', path: '/Backtests/EURUSD_backtest.json', dropboxPath: '/Backtests/EURUSD_backtest.json', size: '12.1 KB', modifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), mimeType: 'application/json' },
  { id: '3', name: 'screenshot_2026-05-11.png', path: '/Screenshots/screenshot_2026-05-11.png', dropboxPath: '/Screenshots/screenshot_2026-05-11.png', size: '1.2 MB', modifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), mimeType: 'image/png' },
  { id: '4', name: 'Journal_notes.md', path: '/Notes/Journal_notes.md', dropboxPath: '/Notes/Journal_notes.md', size: '8.4 KB', modifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), mimeType: 'text/markdown' },
];

function getFileIcon(name: string, mime?: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png','jpg','jpeg','gif','webp','svg'].includes(ext) || mime?.startsWith('image/')) return FileImage;
  if (['csv','xls','xlsx'].includes(ext) || mime?.includes('spreadsheet') || mime?.includes('csv')) return FileSpreadsheet;
  if (['zip','rar','7z','tar','gz'].includes(ext)) return FileArchive;
  if (['md','txt','pdf','doc','docx'].includes(ext)) return FileText;
  return FileIcon;
}

function formatRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export const DropboxPanel: React.FC<DropboxPanelProps> = ({
  isDarkMode = false,
  files = DEFAULT_RECENT_FILES,
  onOpenFile,
  onDuplicateFile,
  maxVisible = 6,
  title = 'Recent Files',
}) => {
  const { addToast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const visibleFiles = files.slice(0, maxVisible);

  const handleCopy = useCallback(async (file: DropboxFile) => {
    // Copy file path / Dropbox path to clipboard.
    // If you need to copy file *contents*, replace this with a fetch + clipboard write.
    const textToCopy = file.dropboxPath || file.path || file.name;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedId(file.id);
      addToast({
        type: 'success',
        title: 'Copied to clipboard',
        message: `${file.name} — path copied`,
        duration: 2000,
      });
      window.setTimeout(() => setCopiedId(current => (current === file.id ? null : current)), 1800);
    } catch {
      addToast({ type: 'error', title: 'Copy failed', message: 'Clipboard permission denied. Try manually.' });
    }
  }, [addToast]);

  const handleDuplicate = useCallback(async (file: DropboxFile) => {
    if (onDuplicateFile) {
      try {
        setDuplicatingId(file.id);
        await onDuplicateFile(file);
        addToast({ type: 'success', title: 'File duplicated', message: `${file.name} copied` });
      } catch (e: any) {
        addToast({ type: 'error', title: 'Duplicate failed', message: e?.message || 'Could not copy file' });
      } finally {
        setDuplicatingId(null);
      }
    } else {
      // Default: copy path as duplicate action fallback
      await handleCopy(file);
    }
  }, [onDuplicateFile, addToast, handleCopy]);

  const cardClass = isDarkMode ? 'border-white/[0.08] bg-white/[0.04]' : 'border-slate-200 bg-white';
  const rowHover = isDarkMode ? 'hover:bg-white/[0.06]' : 'hover:bg-slate-50';
  const subtleText = isDarkMode ? 'text-white/60' : 'text-slate-500';
  const titleText = isDarkMode ? 'text-white' : 'text-slate-900';

  return (
    <section className={`rounded-2xl border p-4 ${cardClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0061FF] text-white">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 1.5L1 5.25l5 3.75 5-3.75L6 1.5zm6 0l5 3.75 5-3.75-5-3.75-5 3.75zM1 10.5l5 3.75 5-3.75-5-3.75L1 10.5zm11 0l5 3.75 5-3.75-5-3.75-5 3.75zM6 14.25l-5 3.75 5 3.75 5-3.75-5-3.75zm6 0l-5 3.75 5 3.75 5-3.75-5-3.75z" />
            </svg>
          </div>
          <div>
            <h3 className={`text-[13px] font-black leading-none ${titleText}`}>{title}</h3>
            <p className={`text-[10px] ${subtleText}`}>Dropbox • {visibleFiles.length} files</p>
          </div>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${isDarkMode ? 'bg-white/10 text-white/70' : 'bg-slate-100 text-slate-600'}`}>
          <span className="inline-flex items-center gap-1"><Clock size={11} /> Dropbox</span>
        </span>
      </div>

      <div className="mt-3 divide-y divide-dashed overflow-hidden rounded-xl border border-dashed">
        {visibleFiles.length === 0 ? (
          <p className={`p-6 text-center text-xs ${subtleText}`}>No recent files yet. Connect Dropbox to see them here.</p>
        ) : (
          visibleFiles.map((file) => {
            const Icon = getFileIcon(file.name, file.mimeType);
            const isCopied = copiedId === file.id;
            const isDuplicating = duplicatingId === file.id;
            return (
              <div
                key={file.id}
                className={`group flex items-center gap-3 px-3 py-2.5 transition-colors ${rowHover}`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isDarkMode ? 'bg-white/[0.06] text-white/80' : 'bg-slate-100 text-slate-600'}`}>
                  <Icon size={15} />
                </div>

                <div className="min-w-0 flex-1">
                  <p className={`truncate text-xs font-semibold leading-tight ${titleText}`} title={file.name}>
                    {file.name}
                  </p>
                  <p className={`truncate text-[10px] leading-tight ${subtleText}`} title={file.dropboxPath}>
                    {file.dropboxPath} {file.size ? `• ${file.size}` : ''} • {formatRelativeTime(file.modifiedAt)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {/* Small copy icon — copies path to clipboard */}
                  <button
                    onClick={() => void handleCopy(file)}
                    title={isCopied ? 'Copied!' : `Copy path: ${file.dropboxPath}`}
                    aria-label={isCopied ? 'Copied' : `Copy ${file.name}`}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0061FF]/30
                      ${isCopied
                        ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : isDarkMode
                          ? 'border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                  >
                    {isCopied ? <Check size={13} /> : <Copy size={13} />}
                  </button>

                  {/* Optional duplicate/copy-file action — shows if onDuplicateFile provided, otherwise copy doubles as duplicate */}
                  {onDuplicateFile ? (
                    <button
                      onClick={() => void handleDuplicate(file)}
                      disabled={isDuplicating}
                      title="Make a copy in Dropbox"
                      aria-label={`Make a copy of ${file.name}`}
                      className={`hidden sm:inline-flex h-7 px-2 items-center justify-center rounded-lg border text-[10px] font-bold transition-colors disabled:opacity-50
                        ${isDarkMode ? 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'}`}
                    >
                      {isDuplicating ? 'Copying…' : 'Duplicate'}
                    </button>
                  ) : null}

                  {onOpenFile || file.url ? (
                    <button
                      onClick={() => (onOpenFile ? onOpenFile(file) : file.url && window.open(file.url, '_blank'))}
                      title="Open file"
                      aria-label={`Open ${file.name}`}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors
                        ${isDarkMode ? 'border-white/10 bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                    >
                      <ExternalLink size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className={`mt-2 text-[10px] leading-relaxed ${subtleText}`}>
        Tip: click <span className={`inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}><Copy size={10} /> copy</span> to copy the Dropbox path to clipboard. {onDuplicateFile ? 'Use Duplicate to create a copy in your Dropbox.' : 'Wire `onDuplicateFile` to enable true file duplication via the Dropbox API.'}
      </p>
    </section>
  );
};

export default DropboxPanel;
