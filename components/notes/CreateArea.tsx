import React, { useRef, useState } from 'react';
import {
  Archive,
  Check,
  CheckSquare,
  Image as ImageIcon,
  Minus,
  MoreVertical,
  Palette,
  Pin,
  Plus,
  RotateCcw,
  RotateCw,
  Table as TableIcon,
  Trash2,
} from 'lucide-react';
import { Note, NoteColor, ColorStyles, ListItem, TableData } from './types';
import { genId, COLUMN_WIDTH_INC, CANVAS_MIN_WIDTH, CANVAS_MAX_WIDTH } from './shared/constants';
import { createEmptyTable } from './shared/tableOps';
import ListEditor from './shared/ListEditor';
import TableEditor from './shared/TableEditor';
import { usePopoverDismiss } from './shared/usePopoverDismiss';

interface CreateAreaProps {
  onCreate: (note: Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'isArchived' | 'isTrashed' | 'labels'>) => Promise<any> | void;
  canvasWidth?: number;
  setCanvasWidth?: React.Dispatch<React.SetStateAction<number>>;
}

type SwitchTarget = 'list' | 'text' | 'table';

const COLOR_LABELS: Record<NoteColor, string> = {
  [NoteColor.DEFAULT]: 'Default',
  [NoteColor.RED]: 'Red',
  [NoteColor.ORANGE]: 'Orange',
  [NoteColor.YELLOW]: 'Yellow',
  [NoteColor.GREEN]: 'Green',
  [NoteColor.TEAL]: 'Teal',
  [NoteColor.BLUE]: 'Blue',
  [NoteColor.DARK_BLUE]: 'Dark blue',
  [NoteColor.PURPLE]: 'Purple',
  [NoteColor.PINK]: 'Pink',
  [NoteColor.BROWN]: 'Brown',
  [NoteColor.GRAY]: 'Gray',
};

const emptyListItem = (): ListItem => ({ id: genId(), text: '', checked: false, indentLevel: 0 });

const CreateArea: React.FC<CreateAreaProps> = ({ onCreate, canvasWidth, setCanvasWidth }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isList, setIsList] = useState(false);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [image, setImage] = useState<string | undefined>(undefined);
  const [tableData, setTableData] = useState<TableData | undefined>(undefined);

  const [isPinned, setIsPinned] = useState(false);
  const [color, setColor] = useState<NoteColor>(NoteColor.DEFAULT);
  const [showColorOptions, setShowColorOptions] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<SwitchTarget | null>(null);

  const colorPickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitLockRef = useRef(false);

  usePopoverDismiss([colorPickerRef], () => setShowColorOptions(false), showColorOptions);

  const listHasContent = listItems.some(item => item.text.trim().length > 0);
  const tableHasContent = !!tableData && tableData.rows.some(row => row.some(cell => cell.text.trim().length > 0));
  const hasContent = !!(title.trim() || (isList ? listHasContent : content.trim()) || image || tableHasContent);

  const switchBlockers = (target: SwitchTarget): string[] => {
    const blockers: string[] = [];
    if ((target === 'list' || target === 'table') && content.trim()) blockers.push('your note text');
    if ((target === 'text' || target === 'table') && listHasContent) blockers.push('your checklist');
    return blockers;
  };

  const commitSwitch = (target: SwitchTarget) => {
    setPendingSwitch(null);
    setIsExpanded(true);
    if (target === 'list') {
      setContent('');
      setTableData(undefined);
      setIsList(true);
      setListItems(prev => (prev.length ? prev : [emptyListItem()]));
    } else if (target === 'text') {
      setListItems([]);
      setTableData(undefined);
      setIsList(false);
    } else {
      setIsList(false);
      setContent('');
      setListItems([]);
      setTableData(createEmptyTable());
    }
  };

  const requestSwitch = (target: SwitchTarget) => {
    if (switchBlockers(target).length > 0) {
      setIsExpanded(true);
      setPendingSwitch(target);
    } else {
      commitSwitch(target);
    }
  };

  const discard = () => {
    setTitle('');
    setContent('');
    setIsList(false);
    setListItems([]);
    setImage(undefined);
    setTableData(undefined);
    setIsPinned(false);
    setColor(NoteColor.DEFAULT);
    setIsExpanded(false);
    setShowColorOptions(false);
    setPendingSwitch(null);
  };

  interface DraftSnapshot {
    title: string;
    content: string;
    isList: boolean;
    listItems: ListItem[];
    image: string | undefined;
    tableData: TableData | undefined;
    isPinned: boolean;
    color: NoteColor;
  }

  const restoreDraft = (draft: DraftSnapshot) => {
    setTitle(draft.title);
    setContent(draft.content);
    setIsList(draft.isList);
    setListItems(draft.listItems);
    setImage(draft.image);
    setTableData(draft.tableData);
    setIsPinned(draft.isPinned);
    setColor(draft.color);
    setShowColorOptions(false);
    setPendingSwitch(null);
    setIsExpanded(true);
  };

  const saveAndClose = () => {
    if (!isExpanded || submitLockRef.current) return;

    const validItems = listItems.filter(item => item.text.trim().length > 0);
    const draft: DraftSnapshot = {
      title,
      content,
      isList,
      listItems: validItems,
      image,
      tableData,
      isPinned,
      color,
    };

    if (!(title.trim() || (isList ? validItems.length > 0 : content.trim()) || image || tableHasContent)) {
      discard();
      return;
    }

    submitLockRef.current = true;
    discard();

    Promise.resolve(
      onCreate({
        title: draft.title,
        content: draft.isList ? '' : draft.content,
        isList: draft.isList,
        listItems: draft.isList ? draft.listItems : [],
        isPinned: draft.isPinned,
        color: draft.color,
        image: draft.image,
        tableData: tableHasContent ? draft.tableData : undefined,
      })
    )
      .catch(error => {
        console.error('Failed to save note:', error);
        restoreDraft(draft);
      })
      .finally(() => {
        submitLockRef.current = false;
      });
  };

  const handleExpand = () => {
    setIsExpanded(true);
  };

  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
    setContent(e.target.value);
  };

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(true);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleTableChange = (next: TableData | undefined) => {
    const prevCols = tableData?.rows[0]?.length ?? 0;
    const nextCols = next?.rows[0]?.length ?? 0;
    setTableData(next);
    if (!setCanvasWidth || !next) return;
    if (nextCols > prevCols) {
      setCanvasWidth(prev => Math.min(CANVAS_MAX_WIDTH, prev + COLUMN_WIDTH_INC));
    } else if (nextCols < prevCols) {
      setCanvasWidth(prev => Math.max(CANVAS_MIN_WIDTH, prev - COLUMN_WIDTH_INC));
    }
  };

  const adjustWidth = (inc: boolean) => {
    if (setCanvasWidth) {
      setCanvasWidth(prev => {
        const next = inc ? prev + COLUMN_WIDTH_INC : prev - COLUMN_WIDTH_INC;
        return Math.max(CANVAS_MIN_WIDTH, Math.min(CANVAS_MAX_WIDTH, next));
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !showColorOptions) {
      setIsExpanded(false);
    }
  };

  return (
    <div className="w-full relative z-10">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
      <div
        className={`relative w-full rounded-xl transition-all duration-300 bg-[var(--note-default-bg)] overflow-visible
            ${isExpanded ? 'shadow-[0_1px_2px_0_rgba(0,0,0,0.6),0_2px_6px_2px_rgba(0,0,0,0.3)]' : 'shadow-[0_1px_2px_0_rgba(0,0,0,0.6),0_1px_3px_1px_rgba(0,0,0,0.3)]'}
            ${ColorStyles[color]}
            ${color === NoteColor.DEFAULT ? 'border border-[var(--notebook-divider)]' : 'border-transparent'}
        `}
      >
        {!isExpanded ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="Take a note"
            onClick={handleExpand}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleExpand(); } }}
            className="flex items-center justify-between px-4 py-3 cursor-text h-[46px]"
          >
            <span className="text-[var(--notebook-text)] font-medium text-[1rem] tracking-wide placeholder-text opacity-70">Take a note...</span>
            <div className="flex gap-2 text-[var(--notebook-muted)] items-center">
              <button
                type="button"
                aria-label="New checklist"
                title="New list"
                onClick={(e) => { e.stopPropagation(); requestSwitch('list'); }}
                className="p-2 hover:bg-[var(--notebook-hover)] rounded-full transition-colors"
              >
                <CheckSquare className="w-5 h-5" />
              </button>
              <button
                type="button"
                aria-label="New table"
                title="New table"
                onClick={(e) => { e.stopPropagation(); requestSwitch('table'); }}
                className="p-2 hover:bg-[var(--notebook-hover)] rounded-full transition-colors"
              >
                <TableIcon className="w-5 h-5" />
              </button>
              <button
                type="button"
                aria-label="New note with image"
                title="New note with image"
                onClick={handleImageClick}
                className="p-2 hover:bg-[var(--notebook-hover)] rounded-full transition-colors"
              >
                <ImageIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col" onKeyDown={handleKeyDown}>
            {image && (
              <div className="relative w-full group">
                <img src={image} alt="Preview" className="w-full max-h-[400px] object-cover" />
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={(e) => { e.stopPropagation(); setImage(undefined); }}
                  className="absolute bottom-2 right-2 p-2 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove image"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="flex justify-between items-start px-4 pt-4 pb-0">
              <input
                id="create-note-title"
                name="title"
                aria-label="Note title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                autoFocus
                className="w-full bg-transparent text-[var(--notebook-text)] placeholder-[var(--notebook-placeholder)] font-medium text-[1.1rem] outline-none"
              />
              <button
                type="button"
                aria-label={isPinned ? 'Unpin note' : 'Pin note'}
                title={isPinned ? 'Unpin' : 'Pin'}
                onClick={() => setIsPinned(!isPinned)}
                className={`p-2 rounded-full hover:bg-neutral-600/30 transition-colors ${isPinned ? 'text-[var(--notebook-text)]' : 'text-[var(--notebook-muted)]'}`}
              >
                <Pin className={`w-5 h-5 ${isPinned ? 'fill-current' : ''}`} />
              </button>
            </div>

            <div className="py-3 px-0 min-h-[46px]">
              {pendingSwitch && (
                <div className="flex flex-wrap items-center gap-3 mx-4 mb-2 rounded-lg border border-[var(--notebook-divider)] bg-[var(--notebook-hover)] px-3 py-2">
                  <span className="text-xs text-[var(--notebook-text)]">Switching will clear {switchBlockers(pendingSwitch).join(' and ')}</span>
                  <div className="flex items-center gap-3 ml-auto">
                    <button
                      type="button"
                      onClick={() => commitSwitch(pendingSwitch)}
                      className="text-xs font-bold uppercase tracking-wider text-[#FF4F00] hover:text-[#E64600] transition-colors"
                    >
                      Continue
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingSwitch(null)}
                      className="text-xs font-bold uppercase tracking-wider text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {tableData ? (
                <div className="px-4 pb-2">
                  <TableEditor tableData={tableData} onChange={handleTableChange} readOnly={false} />
                </div>
              ) : isList ? (
                <div className="px-4 pb-2">
                  <ListEditor items={listItems} onChange={setListItems} readOnly={false} />
                </div>
              ) : (
                <textarea
                  id="create-note-content"
                  name="content"
                  aria-label="Note content"
                  value={content}
                  onChange={autoResize}
                  placeholder="Take a note..."
                  className="w-full bg-transparent text-[var(--notebook-text)] placeholder-[var(--notebook-placeholder)] text-[0.875rem] px-4 outline-none resize-none min-h-[46px]"
                  rows={1}
                />
              )}
            </div>

            <div className="flex justify-between items-center px-2 pb-2">
              <div className="flex gap-0 items-center">
                <ToolbarButton icon={<BellIcon />} title="Reminders are not configured yet" disabled />

                <div className="relative" ref={colorPickerRef}>
                  <ToolbarButton
                    onClick={() => setShowColorOptions(o => !o)}
                    icon={<Palette className="w-4 h-4" />}
                    title="Background options"
                    ariaLabel="Background color options"
                    hasPopup="menu"
                    expanded={showColorOptions}
                  />
                  {showColorOptions && (
                    <div role="menu" aria-label="Background options" className="absolute bottom-full left-0 mb-3 p-3 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded-xl shadow-2xl grid grid-cols-6 gap-3 z-40 animate-in fade-in zoom-in-95 duration-150 min-w-[240px]">
                      {Object.values(NoteColor).map((c) => (
                        <button
                          type="button"
                          key={c}
                          role="menuitemradio"
                          aria-checked={color === c}
                          aria-label={`${COLOR_LABELS[c]} background`}
                          title={COLOR_LABELS[c]}
                          className={`w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center
                            ${ColorStyles[c].split(' ')[0]}
                            ${color === c ? 'border-white ring-1 ring-white/50 scale-110' : 'border-transparent hover:border-white/30'}
                          `}
                          onClick={() => {
                            setColor(c);
                            setShowColorOptions(false);
                          }}
                        >
                          {color === c && <Check className="w-4 h-4 text-white drop-shadow-md" />}
                          {c === NoteColor.DEFAULT && color !== c && (
                            <div className="w-4 h-4 rounded-full border border-white/20 relative overflow-hidden">
                              <div className="absolute top-1/2 left-0 w-full h-[1px] bg-red-400 -rotate-45" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <ToolbarButton onClick={handleImageClick} icon={<ImageIcon className="w-4 h-4" />} title="Add Image" ariaLabel="Add image" />
                <ToolbarButton icon={<Archive className="w-4 h-4" />} title="Archive becomes available after saving" disabled />
                <ToolbarButton icon={<MoreVertical className="w-4 h-4" />} title="More actions become available after saving" disabled />
                <ToolbarButton icon={<CheckSquare className="w-4 h-4" />} title="Toggle checkboxes" ariaLabel="Toggle checklist" onClick={() => requestSwitch(isList ? 'text' : 'list')} />
                <ToolbarButton icon={<TableIcon className="w-4 h-4" />} title="Add table" ariaLabel="Add table" onClick={() => requestSwitch('table')} />

                <div className="h-4 w-[1px] bg-[var(--notebook-divider)] mx-1" />
                <ToolbarButton icon={<Minus className="w-4 h-4" />} title="Decrease canvas width" ariaLabel="Decrease canvas width" onClick={() => adjustWidth(false)} />
                <ToolbarButton icon={<Plus className="w-4 h-4" />} title="Increase canvas width" ariaLabel="Increase canvas width" onClick={() => adjustWidth(true)} />
                <div className="h-4 w-[1px] bg-[var(--notebook-divider)] mx-1" />

                <ToolbarButton icon={<RotateCcw className="w-4 h-4" />} title="Undo" disabled />
                <ToolbarButton icon={<RotateCw className="w-4 h-4" />} title="Redo" disabled />
              </div>
              <div className="flex gap-2 items-center">
                {hasContent && (
                  <button
                    type="button"
                    onClick={discard}
                    className="px-4 py-2 text-red-400 font-medium text-sm rounded-md hover:bg-red-400/10 transition-colors"
                  >
                    Discard
                  </button>
                )}
                <button
                  type="button"
                  onClick={saveAndClose}
                  className="px-6 py-2 text-[var(--notebook-text)] font-medium text-sm rounded-md hover:bg-[var(--notebook-hover)] transition-colors"
                >
                  {hasContent ? 'Save note' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface ToolbarButtonProps {
  icon: React.ReactNode;
  title?: string;
  ariaLabel?: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  expanded?: boolean;
  hasPopup?: 'menu';
}

const ToolbarButton = ({ icon, title, ariaLabel, onClick, disabled, expanded, hasPopup }: ToolbarButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel ?? title}
    aria-expanded={expanded}
    aria-haspopup={hasPopup}
    className={`w-8 h-8 flex items-center justify-center rounded-full text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-neutral-600/30 transition-colors mx-0.5 ${disabled ? 'opacity-35 cursor-not-allowed hover:bg-transparent hover:text-[#9aa0a6]' : ''}`}
    title={title}
  >
    {icon}
  </button>
);

const BellIcon = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;

export default CreateArea;

