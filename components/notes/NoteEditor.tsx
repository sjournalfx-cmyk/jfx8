import React, { useEffect, useRef, useState } from 'react';
import { Pin, Archive, Trash2, X, CheckSquare, Plus, Minus, Image as ImageIcon, MoreVertical, Palette, RotateCcw, RotateCw, Copy, Tag, Check, Table as TableIcon } from 'lucide-react';
import { Note, NoteColor, ColorStyles, ListItem, TableData } from './types';
import ListEditor from './shared/ListEditor';
import TableEditor from './shared/TableEditor';
import { genId, COLUMN_WIDTH_INC, CANVAS_MIN_WIDTH, CANVAS_MAX_WIDTH, AUTOSAVE_DELAY_MS } from './shared/constants';
import { createEmptyTable } from './shared/tableOps';
import { usePopoverDismiss } from './shared/usePopoverDismiss';
import { useAutosave } from './shared/useAutosave';

interface NoteEditorProps {
  note: Note;
  onClose: (info?: { saved?: boolean }) => void;
  onUpdate: (updatedNote: Note) => void;
  onDelete: (id: string) => void;
  onRestore?: (id: string) => void;
  onDuplicate?: (note: Note) => void;
  canvasWidth?: number;
  setCanvasWidth?: React.Dispatch<React.SetStateAction<number>>;
}

interface EditorSnapshot {
  title: string;
  content: string;
  isList: boolean;
  listItems: ListItem[];
  image: string | undefined;
  color: NoteColor;
  labels: string[];
  tableData: TableData | undefined;
}

const HISTORY_LIMIT = 50;

const migrateTableData = (tableData?: TableData): TableData | undefined =>
  tableData
    ? { rows: tableData.rows.map(row => row.map(cell => (typeof cell === 'string' ? { text: cell } : cell))) }
    : undefined;

const snapshotFromNote = (note: Note): EditorSnapshot => ({
  title: note.title,
  content: note.content,
  isList: note.isList || false,
  listItems: note.listItems || [],
  image: note.image,
  color: note.color,
  labels: note.labels || [],
  tableData: migrateTableData(note.tableData),
});

const snapshotsEqual = (a?: EditorSnapshot, b?: EditorSnapshot): boolean => {
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.content === b.content &&
    a.isList === b.isList &&
    a.image === b.image &&
    a.color === b.color &&
    JSON.stringify(a.labels) === JSON.stringify(b.labels) &&
    JSON.stringify(a.listItems) === JSON.stringify(b.listItems) &&
    JSON.stringify(a.tableData) === JSON.stringify(b.tableData)
  );
};

const formatRelativeTime = (timestamp: number): string => {
  if (!timestamp) return '';
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
};

const NoteEditor: React.FC<NoteEditorProps> = ({ note, onClose, onUpdate, onDelete, onRestore, onDuplicate, canvasWidth, setCanvasWidth }) => {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [labels, setLabels] = useState<string[]>(note.labels || []);
  const [labelInput, setLabelInput] = useState('');
  const [isList, setIsList] = useState(note.isList || false);
  const [listItems, setListItems] = useState<ListItem[]>(note.listItems || []);
  const [image, setImage] = useState<string | undefined>(note.image);
  const [tableData, setTableData] = useState<TableData | undefined>(() => migrateTableData(note.tableData));
  const [isPinned, setIsPinned] = useState(note.isPinned);
  const [color, setColor] = useState(note.color);

  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<{ entries: EditorSnapshot[]; index: number }>(() => ({
    entries: [snapshotFromNote(note)],
    index: 0,
  }));

  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showColorOptions, setShowColorOptions] = useState(false);
  const [showLabelEditor, setShowLabelEditor] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const historyRef = useRef(history);
  historyRef.current = history;
  const dirtyRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const stateRef = useRef({ note, title, content, isList, listItems, image, color, labels, tableData, isPinned });
  stateRef.current = { note, title, content, isList, listItems, image, color, labels, tableData, isPinned };

  usePopoverDismiss([colorPickerRef], () => setShowColorOptions(false), showColorOptions);
  usePopoverDismiss([moreMenuRef], () => setShowMoreMenu(false), showMoreMenu);

  const bumpVersion = () => {
    dirtyRef.current = true;
    setVersion(v => v + 1);
  };

  const buildFullNote = (): Note => {
    const s = stateRef.current;
    return {
      ...s.note,
      title: s.title,
      content: s.content,
      isList: s.isList,
      listItems: s.listItems,
      image: s.image,
      color: s.color,
      labels: s.labels,
      tableData: s.tableData,
      isPinned: s.isPinned,
      updatedAt: Date.now(),
    };
  };

  const autosave = useAutosave(
    buildFullNote,
    (full) => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      onUpdateRef.current(full);
    },
    [version],
    AUTOSAVE_DELAY_MS
  );

  const buildSnapshot = (patch?: Partial<EditorSnapshot>): EditorSnapshot => {
    const s = stateRef.current;
    return {
      title: s.title,
      content: s.content,
      isList: s.isList,
      listItems: s.listItems,
      image: s.image,
      color: s.color,
      labels: s.labels,
      tableData: s.tableData,
      ...patch,
    };
  };

  const pushSnapshot = (entry: EditorSnapshot) => {
    setHistory(h => {
      if (snapshotsEqual(h.entries[h.index], entry)) return h;
      const entries = [...h.entries.slice(0, h.index + 1), entry];
      const trimmed = entries.length > HISTORY_LIMIT ? entries.slice(entries.length - HISTORY_LIMIT) : entries;
      return { entries: trimmed, index: trimmed.length - 1 };
    });
  };

  const applySnapshot = (snap: EditorSnapshot) => {
    setTitle(snap.title);
    setContent(snap.content);
    setIsList(snap.isList);
    setListItems(snap.listItems);
    setImage(snap.image);
    setColor(snap.color);
    setLabels(snap.labels);
    setTableData(snap.tableData);
    bumpVersion();
  };

  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    setLabels(note.labels || []);
    setLabelInput('');
    setIsList(note.isList || false);
    setListItems(note.listItems || []);
    setImage(note.image);
    setTableData(migrateTableData(note.tableData));
    setIsPinned(note.isPinned);
    setColor(note.color);
    setShowLabelEditor(false);
    setShowColorOptions(false);
    setShowMoreMenu(false);
    dirtyRef.current = false;
    setHistory({ entries: [snapshotFromNote(note)], index: 0 });
    if (!note.isTrashed) titleInputRef.current?.focus();
    return () => {
      if (!dirtyRef.current) return;
      const s = stateRef.current;
      dirtyRef.current = false;
      onUpdateRef.current({
        ...s.note,
        title: s.title,
        content: s.content,
        isList: s.isList,
        listItems: s.listItems,
        image: s.image,
        color: s.color,
        labels: s.labels,
        tableData: s.tableData,
        isPinned: s.isPinned,
        updatedAt: Date.now(),
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  useEffect(() => {
    if (textareaRef.current && !isList && !tableData) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content, isList, tableData]);

  const closeAndReport = () => {
    const hadPending = dirtyRef.current || autosave.hasPending();
    autosave.flush();
    dirtyRef.current = false;
    onClose({ saved: hadPending });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showColorOptions || showMoreMenu || showLabelEditor) return;
      closeAndReport();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showColorOptions, showMoreMenu, showLabelEditor]);

  const persistNow = (overrides?: Partial<Note>) => {
    dirtyRef.current = true;
    autosave.cancel();
    onUpdateRef.current({ ...buildFullNote(), ...overrides });
    dirtyRef.current = false;
  };

  const handleUndo = () => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    applySnapshot(h.entries[h.index - 1]);
    setHistory({ ...h, index: h.index - 1 });
  };

  const handleRedo = () => {
    const h = historyRef.current;
    if (h.index >= h.entries.length - 1) return;
    applySnapshot(h.entries[h.index + 1]);
    setHistory({ ...h, index: h.index + 1 });
  };

  const commitLabels = (nextRaw: string[]) => {
    const normalized = Array.from(new Set(nextRaw.map(label => label.trim()).filter(Boolean)));
    pushSnapshot(buildSnapshot({ labels: normalized }));
    setLabels(normalized);
    persistNow({ labels: normalized });
  };

  const addLabel = (value: string) => {
    const label = value.trim();
    if (!label || labels.includes(label)) {
      setLabelInput('');
      return;
    }
    commitLabels([...labels, label]);
    setLabelInput('');
  };

  const removeLabel = (label: string) => commitLabels(labels.filter(item => item !== label));

  const handleImageClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      pushSnapshot(buildSnapshot({ image: result }));
      setImage(result);
      persistNow({ image: result });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    pushSnapshot(buildSnapshot({ image: undefined }));
    setImage(undefined);
    persistNow({ image: undefined });
  };

  const handleColorChange = (c: NoteColor) => {
    pushSnapshot(buildSnapshot({ color: c }));
    setColor(c);
    setShowColorOptions(false);
    persistNow({ color: c });
  };

  const handleTogglePin = () => {
    const next = !isPinned;
    setIsPinned(next);
    persistNow({ isPinned: next });
  };

  const handleToggleArchive = () => {
    persistNow({ isArchived: !note.isArchived });
    onClose();
  };

  const toggleListMode = () => {
    if (isList) {
      const text = listItems.map(i => i.text).join('\n');
      pushSnapshot(buildSnapshot({ isList: false, content: text, listItems: [], tableData: undefined }));
      setContent(text);
      setIsList(false);
      setListItems([]);
      setTableData(undefined);
    } else {
      const lines = content.split('\n');
      const items = lines.map(line => ({ id: genId(), text: line, checked: false, indentLevel: 0 }));
      const newList = items.length ? items : [{ id: genId(), text: '', checked: false, indentLevel: 0 }];
      pushSnapshot(buildSnapshot({ isList: true, listItems: newList, content: '', tableData: undefined }));
      setListItems(newList);
      setIsList(true);
      setContent('');
      setTableData(undefined);
    }
    bumpVersion();
  };

  const addTable = () => {
    const newTable = createEmptyTable();
    pushSnapshot(buildSnapshot({ isList: false, content: '', tableData: newTable }));
    setIsList(false);
    setContent('');
    setTableData(newTable);
    bumpVersion();
  };

  const handleListItemsChange = (items: ListItem[]) => {
    pushSnapshot(buildSnapshot({ listItems: items }));
    setListItems(items);
    bumpVersion();
  };

  const handleTableChange = (next: TableData | undefined) => {
    if (note.isTrashed) return;
    pushSnapshot(buildSnapshot({ tableData: next }));
    if (setCanvasWidth && tableData && next) {
      const prevCols = tableData.rows[0]?.length ?? 0;
      const nextCols = next.rows[0]?.length ?? 0;
      if (nextCols > prevCols) setCanvasWidth(prev => prev + COLUMN_WIDTH_INC);
      else if (nextCols < prevCols) setCanvasWidth(prev => Math.max(CANVAS_MIN_WIDTH, prev - COLUMN_WIDTH_INC));
    }
    setTableData(next);
    bumpVersion();
  };

  const adjustWidth = (inc: boolean) => {
    if (setCanvasWidth) {
      setCanvasWidth(prev => {
        const next = inc ? prev + COLUMN_WIDTH_INC : prev - COLUMN_WIDTH_INC;
        return Math.max(CANVAS_MIN_WIDTH, Math.min(CANVAS_MAX_WIDTH, next));
      });
    }
  };

  const handleDelete = () => {
    dirtyRef.current = false;
    onDelete(note.id);
    onClose();
  };

  return (
    <div className={`w-full rounded-xl transition-all duration-300 ${ColorStyles[color]} ${color === NoteColor.DEFAULT ? 'border border-[var(--notebook-divider)]' : 'border-transparent'} shadow-2xl relative overflow-visible`}>
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
      <div className="flex flex-col">
        {image && (
            <div className="relative group w-full">
                <img src={image} alt="Note attachment" className="w-full h-auto max-h-[600px] object-contain bg-black/20" />
                {!note.isTrashed && (
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute bottom-4 right-4 p-3 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                    aria-label="Remove image"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
            </div>
        )}
        <div className="flex justify-between items-center px-4 pt-4">
           <input
              id="edit-note-title"
              name="title"
              aria-label="Note title"
              ref={titleInputRef}
              type="text" value={title}
              readOnly={note.isTrashed}
              onChange={(e) => {
                  setTitle(e.target.value);
                  bumpVersion();
              }}
              onBlur={() => pushSnapshot(buildSnapshot())}
              placeholder="Title"
              className="bg-transparent text-[var(--notebook-text)] placeholder-[var(--notebook-placeholder)] font-medium text-2xl outline-none w-full mr-4"
            />
            <div className="flex items-center gap-1">
                {!note.isTrashed && (
                  <button
                    type="button"
                    onClick={handleTogglePin}
                    className={`p-2 rounded-full hover:bg-[var(--notebook-hover)] ${isPinned ? 'text-[var(--notebook-text)]' : 'text-[var(--notebook-muted)]'}`}
                    title={isPinned ? "Unpin note" : "Pin note"}
                    aria-label={isPinned ? "Unpin note" : "Pin note"}
                  >
                    <Pin className={`w-5 h-5 ${isPinned ? 'fill-current' : ''}`} />
                  </button>
                )}
                <button type="button" onClick={closeAndReport} className="p-2 text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] hover:bg-[var(--notebook-hover)] rounded-full" title="Close editor" aria-label="Close editor">
                    <X className="w-5 h-5" />
                </button>
            </div>
        </div>
        <div className="px-4 py-6 min-h-[300px]">
            {labels.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {labels.map(label => (
                  <span key={label} className="inline-flex items-center gap-2 rounded-full border border-[var(--notebook-divider)] bg-[var(--notebook-hover)] px-3 py-1 text-xs font-medium text-[var(--notebook-text)]">
                    {label}
                    {!note.isTrashed && (
                      <button
                        type="button"
                        onClick={() => removeLabel(label)}
                        className="text-[var(--notebook-muted)] hover:text-[var(--notebook-text)]"
                        aria-label={`Remove label ${label}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {showLabelEditor && !note.isTrashed && (
              <div className="mb-4 rounded-xl border border-[var(--notebook-divider)] bg-[var(--notebook-hover)] p-3">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-[var(--notebook-muted)]" />
                  <input
                    ref={labelInputRef}
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addLabel(labelInput);
                      }
                    }}
                    placeholder="Add a label and press Enter"
                    className="flex-1 bg-transparent outline-none text-sm text-[var(--notebook-text)] placeholder:text-[var(--notebook-placeholder)]"
                  />
                  <button
                    type="button"
                    onClick={() => addLabel(labelInput)}
                    className="rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-white"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
            {tableData ? (
               <TableEditor tableData={tableData} onChange={handleTableChange} readOnly={!!note.isTrashed} />
            ) : isList ? (
                <ListEditor items={listItems} onChange={handleListItemsChange} readOnly={!!note.isTrashed} />
            ) : (
                <textarea
                    id="edit-note-content"
                    name="content"
                    aria-label="Note content"
                    ref={textareaRef} value={content}
                    readOnly={note.isTrashed}
                    onChange={(e) => { setContent(e.target.value); bumpVersion(); }}
                    onBlur={() => pushSnapshot(buildSnapshot())}
                    placeholder="Note"
                    className="w-full bg-transparent text-[var(--notebook-text)] placeholder-[var(--notebook-placeholder)] text-base outline-none resize-none min-h-[300px]"
                />
            )}
        </div>
        <div className="p-4 flex flex-col gap-4 border-t border-white/5">
            <div className="flex justify-between items-center">
                 <div className="flex gap-0.5 items-center">
                    {note.isTrashed ? (
                      <>
                        <ToolbarButton
                          type="button"
                          onClick={() => onRestore?.(note.id)}
                          icon={<RotateCcw className="w-4 h-4" />}
                          title="Restore"
                        />
                        <div className="relative" ref={moreMenuRef}>
                            <ToolbarButton
                              type="button"
                              icon={<MoreVertical className="w-4 h-4" />}
                              title="More"
                              onClick={() => setShowMoreMenu(!showMoreMenu)}
                              ariaExpanded={showMoreMenu}
                            />
                            {showMoreMenu && (
                                <div role="menu" aria-label="More actions" className="absolute bottom-full left-0 mb-2 w-48 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded shadow-2xl z-40 py-1">
                                    <MenuOption icon={<Trash2 className="w-4 h-4" />} label="Delete forever" onClick={handleDelete} />
                                </div>
                            )}
                        </div>
                      </>
                    ) : (
                      <>
                        <ToolbarButton type="button" icon={<BellIcon />} title="Reminders are not configured yet" disabled />

                        <div className="relative" ref={colorPickerRef}>
                            <ToolbarButton
                                type="button"
                                onClick={() => setShowColorOptions(!showColorOptions)}
                                icon={<Palette className="w-4 h-4" />}
                                title="Background options"
                                ariaExpanded={showColorOptions}
                            />
                            {showColorOptions && (
                                <div role="menu" aria-label="Background options" className="absolute bottom-full left-0 mb-3 p-3 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded-xl shadow-2xl grid grid-cols-6 gap-3 z-50 animate-in fade-in zoom-in-95 duration-150 min-w-[240px]">
                                    {Object.values(NoteColor).map((c) => (
                                        <button
                                            type="button"
                                            key={c}
                                            title={c.charAt(0) + c.slice(1).toLowerCase()}
                                            aria-label={`${c.charAt(0) + c.slice(1).toLowerCase()} background`}
                                            className={`w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center
                                              ${ColorStyles[c].split(' ')[0]}
                                              ${color === c ? 'border-white ring-1 ring-white/50 scale-110' : 'border-transparent hover:border-white/30'}
                                            `}
                                            onClick={() => handleColorChange(c)}
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

                        <ToolbarButton type="button" onClick={handleImageClick} icon={<ImageIcon className="w-4 h-4" />} title="Add Image" />
                        <ToolbarButton
                            type="button"
                            onClick={handleToggleArchive}
                            icon={<Archive className="w-4 h-4" />}
                            title={note.isArchived ? "Unarchive" : "Archive"}
                        />
                        <div className="relative" ref={moreMenuRef}>
                            <ToolbarButton
                              type="button"
                              icon={<MoreVertical className="w-4 h-4" />}
                              title="More"
                              onClick={() => setShowMoreMenu(!showMoreMenu)}
                              ariaExpanded={showMoreMenu}
                            />
                            {showMoreMenu && (
                                <div role="menu" aria-label="More actions" className="absolute bottom-full left-0 mb-2 w-48 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded shadow-2xl z-40 py-1">
                                    <MenuOption icon={<Trash2 className="w-4 h-4" />} label="Delete note" onClick={handleDelete} />
                                    <MenuOption icon={<Tag className="w-4 h-4" />} label="Add label" onClick={() => { setShowLabelEditor(true); setShowMoreMenu(false); requestAnimationFrame(() => labelInputRef.current?.focus()); }} />
                                    <MenuOption icon={<Copy className="w-4 h-4" />} label="Make a copy" onClick={() => { onDuplicate?.(buildFullNote()); setShowMoreMenu(false); }} />
                                </div>
                            )}
                        </div>
                        <ToolbarButton type="button" icon={<CheckSquare className="w-4 h-4" />} title="Toggle checkboxes" onClick={toggleListMode} />
                        <ToolbarButton type="button" icon={<TableIcon className="w-4 h-4" />} title="Add table" onClick={addTable} />

                        <div className="h-4 w-[1px] bg-[var(--notebook-divider)] mx-1" />
                        <ToolbarButton type="button" icon={<Minus className="w-4 h-4" />} title="Decrease canvas width" onClick={() => adjustWidth(false)} />
                        <ToolbarButton type="button" icon={<Plus className="w-4 h-4" />} title="Increase canvas width" onClick={() => adjustWidth(true)} />
                        <div className="h-4 w-[1px] bg-[var(--notebook-divider)] mx-1" />

                        <ToolbarButton type="button" icon={<RotateCcw className="w-4 h-4" />} title="Undo" onClick={handleUndo} disabled={history.index <= 0} />
                        <ToolbarButton type="button" icon={<RotateCw className="w-4 h-4" />} title="Redo" onClick={handleRedo} disabled={history.index >= history.entries.length - 1} />
                      </>
                    )}
                 </div>
                 <button type="button" onClick={closeAndReport} className="px-6 py-2 text-[var(--notebook-text)] font-medium text-sm rounded hover:bg-[var(--notebook-hover)] transition-colors">Close</button>
            </div>
            <div className="text-[11px] text-[var(--notebook-muted)] text-right">
                {Boolean(note.createdAt || note.updatedAt) && (
                  <>
                    {note.createdAt ? `Created ${formatRelativeTime(note.createdAt)}` : ''}
                    {note.createdAt && note.updatedAt ? ' · ' : ''}
                    {note.updatedAt ? `Edited ${formatRelativeTime(note.updatedAt)}` : ''}
                  </>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

const ToolbarButton = ({ icon, title, onClick, disabled, type = 'button', ariaExpanded }: { icon: React.ReactNode, title?: string, onClick?: (e: React.MouseEvent) => void, disabled?: boolean, type?: 'button' | 'submit', ariaExpanded?: boolean }) => (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      aria-expanded={ariaExpanded}
      className={`w-8 h-8 flex items-center justify-center rounded-full text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] hover:bg-[var(--notebook-hover)] transition-colors ${disabled ? 'opacity-35 cursor-not-allowed hover:bg-transparent hover:text-[var(--notebook-muted)]' : ''}`}
      title={title}
    >
      {icon}
    </button>
);

const MenuOption = ({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) => (
    <button type="button" role="menuitem" onClick={onClick} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--notebook-text)] hover:bg-[var(--notebook-hover)] text-left">{icon}{label}</button>
);

const BellIcon = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;

export default NoteEditor;
