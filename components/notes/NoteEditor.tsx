
import React, { useEffect, useState, useRef } from 'react';
import { Pin, Archive, Trash2, Sparkles, Loader2, X, CheckSquare, Plus, Minus, Square, CheckSquare as CheckSquareIcon, GripVertical, Bell, Image as ImageIcon, MoreVertical, Palette, RotateCcw, RotateCw, Copy, Tag, Check, Table as TableIcon, PlusSquare, MinusSquare } from 'lucide-react';
import { Note, NoteColor, ColorStyles, ListItem, TableData } from './types';
import {
  NOTEBOOK_PROMPT_PRESETS,
  generateNotebookDraft,
  insertTextAtSelection,
  splitNotebookLines,
  NotebookPromptPreset,
  shouldReplaceNotebookContent,
} from '../../services/notesAiService';
import { useToast } from '../ui/Toast';

const generateNoteContent = (prompt: string, currentContent = '') => generateNotebookDraft({ content: prompt, currentContent });
import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface NoteEditorProps {
  note: Note;
  onClose: () => void;
  onUpdate: (updatedNote: Note) => void;
  onDelete: (id: string) => void;
  onRestore?: (id: string) => void;
  onDuplicate?: (note: Note) => void;
  canvasWidth?: number;
  setCanvasWidth?: React.Dispatch<React.SetStateAction<number>>;
}

const genId = () => Math.random().toString(36).slice(2, 9);
const COLUMN_WIDTH_INC = 96;

const SortableListItem = ({ item, isTrashed, onToggle, onChange, onBlur, onRemove }: { 
    item: ListItem, 
    isTrashed: boolean, 
    onToggle: () => void, 
    onChange: (val: string) => void,
    onBlur: () => void,
    onRemove: () => void
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative' as const,
    marginLeft: `${(item.indentLevel || 0) * 1.5}rem`
  };

  return (
    <div ref={setNodeRef} style={style} className={`flex items-center group py-1 ${isDragging ? 'opacity-50' : ''}`}>
        {!isTrashed && (
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1">
                <GripVertical className="w-4 h-4 text-[var(--notebook-placeholder)] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
        )}
        <button 
            disabled={isTrashed}
            onClick={onToggle} 
            className="text-[var(--notebook-muted)] mr-2"
        >
            {item.checked ? <CheckSquareIcon className="w-4 h-4" /> : <Square className="w-4 h-4" />}
        </button>
        <input 
            id={`edit-note-list-item-${item.id}`}
            name={`list-item-${item.id}`}
            aria-label="List item"
            type="text" value={item.text}
            readOnly={isTrashed}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={`bg-transparent outline-none flex-1 text-base ${item.checked ? 'text-[var(--notebook-muted)] line-through' : 'text-[var(--notebook-text)]'}`}
        />
        {!isTrashed && (
            <button onClick={onRemove} className="p-2 text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="w-3 h-3" />
            </button>
        )}
    </div>
  );
};

const NoteEditor: React.FC<NoteEditorProps> = ({ note, onClose, onUpdate, onDelete, onRestore, onDuplicate, canvasWidth, setCanvasWidth }) => {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [labels, setLabels] = useState<string[]>(note.labels || []);
  const [labelInput, setLabelInput] = useState('');
  const [isList, setIsList] = useState(note.isList || false);
  const [listItems, setListItems] = useState<ListItem[]>(note.listItems || []);
  const [image, setImage] = useState<string | undefined>(note.image);
  const [tableData, setTableData] = useState<TableData | undefined>(() => {
    if (!note.tableData) return undefined;
    // Migrate old data if necessary
    const rows = note.tableData.rows.map(row => 
      row.map(cell => typeof cell === 'string' ? { text: cell } : cell)
    );
    return { rows };
  });
  const [isPinned, setIsPinned] = useState(note.isPinned);
  const [color, setColor] = useState(note.color);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<NotebookPromptPreset>('rewrite');
  const [showComposeMenu, setShowComposeMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showColorOptions, setShowColorOptions] = useState(false);
  const [showLabelEditor, setShowLabelEditor] = useState(false);
  const [focusedCell, setFocusedCell] = useState<{ rIdx: number, cIdx: number } | null>(null);
  const [showCellColorOptions, setShowCellColorOptions] = useState(false);
  
  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isInternalUpdate = useRef(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const cellColorPickerRef = useRef<HTMLDivElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const composeMenuRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();

  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    setIsList(note.isList || false);
    setListItems(note.listItems || []);
    setImage(note.image);
    const initialTableData = note.tableData ? {
      rows: note.tableData.rows.map(row => 
        row.map(cell => typeof cell === 'string' ? { text: cell } : cell)
      )
    } : undefined;
    setTableData(initialTableData);
    setIsPinned(note.isPinned);
    setColor(note.color);
    
    const initialState = { 
      title: note.title, 
      content: note.content, 
      isList: note.isList || false,
      listItems: note.listItems || [], 
      image: note.image, 
      color: note.color, 
      tableData: initialTableData 
    };
    setHistory([initialState]);
    setHistoryIndex(0);
    setLabels(note.labels || []);
    setLabelInput('');
    setShowLabelEditor(false);
  }, [note.id]);

  useEffect(() => {
    if (textareaRef.current && !isList && !tableData) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [content, isList, tableData]);

  const addToHistory = (newState: any) => {
    if (isInternalUpdate.current) return;
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleUpdate = (updates: Partial<Note>) => {
      onUpdate({ ...note, ...updates, updatedAt: Date.now() });
  };

  const commitLabels = (nextLabels: string[]) => {
    const normalized = Array.from(new Set(nextLabels.map(label => label.trim()).filter(Boolean)));
    setLabels(normalized);
    handleUpdate({ labels: normalized });
    addToHistory({ title, content, isList, listItems, image, color, tableData, labels: normalized });
  };

  const addLabel = (value: string) => {
    const label = value.trim();
    if (!label) return;
    if (labels.includes(label)) {
      setLabelInput('');
      return;
    }
    commitLabels([...labels, label]);
    setLabelInput('');
  };

  const removeLabel = (label: string) => {
    commitLabels(labels.filter(item => item !== label));
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      isInternalUpdate.current = true;
      const prevState = history[historyIndex - 1];
      setTitle(prevState.title);
      setContent(prevState.content);
      setIsList(prevState.isList);
      setListItems(prevState.listItems);
      setImage(prevState.image);
      setTableData(prevState.tableData);
      setColor(prevState.color || NoteColor.DEFAULT);
      handleUpdate(prevState);
      setHistoryIndex(historyIndex - 1);
      setTimeout(() => isInternalUpdate.current = false, 0);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      isInternalUpdate.current = true;
      const nextState = history[historyIndex + 1];
      setTitle(nextState.title);
      setContent(nextState.content);
      setIsList(nextState.isList);
      setListItems(nextState.listItems);
      setImage(nextState.image);
      setTableData(nextState.tableData);
      setColor(nextState.color || NoteColor.DEFAULT);
      handleUpdate(nextState);
      setHistoryIndex(historyIndex + 1);
      setTimeout(() => isInternalUpdate.current = false, 0);
    }
  };

  const handleImageClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setImage(result);
        handleUpdate({ image: result });
        addToHistory({ title, content, listItems, image: result, color, tableData });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleNotebookCompose = async (preset: NotebookPromptPreset = selectedPreset) => {
    if (isGenerating) return;
    if (!content.trim() && !title.trim() && listItems.length === 0 && !tableData) {
      addToast({
        type: 'warning',
        title: 'Nothing to write from',
        message: 'Add some note content first, then use Help me write.',
      });
      return;
    }

    if (!import.meta.env.VITE_NVIDIA_API_KEY) {
      addToast({
        type: 'error',
        title: 'AI not configured',
        message: 'Add the NVIDIA API key to use Help me write.',
      });
      return;
    }

    setIsGenerating(true);
    setShowComposeMenu(false);
    try {
      const shouldReplace = shouldReplaceNotebookContent(preset);
      const generated = await generateNotebookDraft({
        preset,
        title,
        currentContent: [title, content].filter(Boolean).join('\n\n'),
        isList,
        listItems,
        tableData,
      });

      if (isList) {
        const lines = splitNotebookLines(generated);
        const newItems = lines.map((line) => ({
          id: genId(),
          text: line,
          checked: false,
          indentLevel: 0,
        }));
        const nextItems = shouldReplace ? newItems : [...listItems, ...newItems];
        setListItems(nextItems);
        handleUpdate({ listItems: nextItems, isList: true });
        addToHistory({ title, content, listItems: nextItems, image, color, tableData });
      } else {
        if (shouldReplace) {
          setContent(generated);
          handleUpdate({ content: generated });
          addToHistory({ title, content: generated, listItems, image, color, tableData });
        } else {
          const inserted = insertTextAtSelection(textareaRef.current, content, generated);
          setContent(inserted.nextValue);
          handleUpdate({ content: inserted.nextValue });
          addToHistory({ title, content: inserted.nextValue, listItems, image, color, tableData });
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.style.height = 'auto';
              textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
              textareaRef.current.selectionStart = inserted.nextSelectionStart;
              textareaRef.current.selectionEnd = inserted.nextSelectionEnd;
            }
          }, 10);
        }
      }
    } catch (e: any) {
      console.error(e);
      addToast({
        type: 'error',
        title: 'Help me write failed',
        message: e?.message?.includes('configured')
          ? 'Add the NVIDIA API key to continue.'
          : e?.message || 'Could not generate notebook content.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleMagicComposeLegacy = async () => {
    setIsGenerating(true);
    try {
        let prompt = '';
        if (isList) {
             const listText = listItems.map(i => i.text).join(', ');
             prompt = `Rewrite and improve this checklist: ${title}. Items: ${listText}`;
        } else if (tableData) {
             const colHeaders = tableData.rows[0].map(c => c.text).join(', ');
             prompt = `Suggest data for this table about ${title}. Columns are: ${colHeaders}`;
        } else {
             prompt = title ? `Rewrite and improve this note: ${title}. ${content}` : `Improve this note: ${content}`;
        }
        const generated = await generateNoteContent(prompt);
        if (isList) {
            const lines = generated.split('\n').filter(l => l.trim());
            const newItems = lines.map(line => ({
                id: genId(), text: line.replace(/^[-*•]\s*/, '').trim(), checked: false, indentLevel: 0
            }));
            setListItems(newItems);
            handleUpdate({ listItems: newItems, isList: true });
            addToHistory({ title, content, listItems: newItems, image, color, tableData });
        } else {
            setContent(generated);
            handleUpdate({ content: generated });
            addToHistory({ title, content: generated, listItems, image, color, tableData });
      }
    } catch (e) { console.error(e); } finally { setIsGenerating(false); }
  };

  const handleMagicCompose = () => {
    if (isGenerating) return;
    setShowComposeMenu((prev) => !prev);
  };
  
  const toggleListMode = () => {
      let newState;
      setTableData(undefined);
      if (isList) {
          const text = listItems.map(i => i.text).join('\n');
          setContent(text);
          setIsList(false);
          newState = { isList: false, content: text, listItems: [], tableData: undefined };
      } else {
          const lines = content.split('\n');
          const items = lines.map(line => ({ id: genId(), text: line, checked: false, indentLevel: 0 }));
          const newList = items.length ? items : [{ id: genId(), text: '', checked: false, indentLevel: 0 }];
          setListItems(newList);
          setIsList(true);
          newState = { isList: true, listItems: newList, content: '', tableData: undefined };
      }
      handleUpdate(newState);
      addToHistory({ title, ...newState, image, color });
  };

  const addTable = () => {
    setIsList(false);
    setContent('');
    const newTable = { 
      rows: [
        [{ text: '' }, { text: '' }], 
        [{ text: '' }, { text: '' }]
      ] 
    };
    setTableData(newTable);
    handleUpdate({ tableData: newTable, isList: false, content: '' });
    addToHistory({ title, content: '', listItems: [], image, color, tableData: newTable });
  };

  const handleTableCellChange = (rIdx: number, cIdx: number, val: string) => {
    if (!tableData) return;
    const newRows = [...tableData.rows];
    newRows[rIdx][cIdx] = { ...newRows[rIdx][cIdx], text: val };
    const nextTable = { rows: newRows };
    setTableData(nextTable);
    handleUpdate({ tableData: nextTable });
  };

  const handleCellColorChange = (rIdx: number, cIdx: number, cellColor: NoteColor) => {
    if (!tableData) return;
    const newRows = [...tableData.rows];
    newRows[rIdx][cIdx] = { ...newRows[rIdx][cIdx], color: cellColor };
    const nextTable = { rows: newRows };
    setTableData(nextTable);
    handleUpdate({ tableData: nextTable });
    setShowCellColorOptions(false);
    addToHistory({ title, content, isList, listItems, image, color, tableData: nextTable });
  };

  const addRow = () => {
    if (!tableData) return;
    const nextTable = { rows: [...tableData.rows, Array(tableData.rows[0].length).fill(null).map(() => ({ text: '' }))] };
    setTableData(nextTable);
    handleUpdate({ tableData: nextTable });
  };

  const addCol = () => {
    if (!tableData) return;
    const nextTable = { rows: tableData.rows.map(row => [...row, { text: '' }]) };
    setTableData(nextTable);
    handleUpdate({ tableData: nextTable });
    // Adjust canvas width automatically
    if (setCanvasWidth) {
        setCanvasWidth(prev => prev + COLUMN_WIDTH_INC);
    }
  };

  const removeRow = (idx: number) => {
    if (!tableData || tableData.rows.length <= 1) return;
    const nextTable = { rows: tableData.rows.filter((_, i) => i !== idx) };
    setTableData(nextTable);
    handleUpdate({ tableData: nextTable });
  };

  const removeCol = (idx: number) => {
    if (!tableData || tableData.rows[0].length <= 1) return;
    const nextTable = { rows: tableData.rows.map(row => row.filter((_, i) => i !== idx)) };
    setTableData(nextTable);
    handleUpdate({ tableData: nextTable });
    // Adjust canvas width automatically
    if (setCanvasWidth) {
        setCanvasWidth(prev => Math.max(560, prev - COLUMN_WIDTH_INC));    }
  };

  const adjustWidth = (inc: boolean) => {
      if (setCanvasWidth) {
          setCanvasWidth(prev => {
              const next = inc ? prev + COLUMN_WIDTH_INC : prev - COLUMN_WIDTH_INC;
              return Math.max(320, Math.min(2000, next));          });
      }
  };

  const handleOutsideClick = (e: MouseEvent) => {
    if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
      setShowColorOptions(false);
    }
    if (cellColorPickerRef.current && !cellColorPickerRef.current.contains(e.target as Node)) {
      setShowCellColorOptions(false);
    }
    if (composeMenuRef.current && !composeMenuRef.current.contains(e.target as Node)) {
      setShowComposeMenu(false);
    }
  };

  useEffect(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEndItems = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = listItems.findIndex(i => i.id === active.id);
      const newIndex = listItems.findIndex(i => i.id === over.id);
      const newItems = arrayMove(listItems, oldIndex, newIndex);
      setListItems(newItems);
      handleUpdate({ listItems: newItems });
      addToHistory({ title, content, isList, listItems: newItems, image, color, tableData });
    }
  };

  return (
    <div className={`w-full rounded-xl transition-all duration-300 ${ColorStyles[color]} ${color === NoteColor.DEFAULT ? 'border border-[var(--notebook-divider)]' : 'border-transparent'} shadow-2xl relative overflow-visible`}>
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
      <div className="flex flex-col">
        {image && (
            <div className="relative group w-full">
                <img src={image} alt="Note attachment" className="w-full h-auto max-h-[600px] object-contain bg-black/20" />
                <button 
                    onClick={(e) => { e.stopPropagation(); setImage(undefined); handleUpdate({ image: undefined }); addToHistory({ title, content, listItems, image: undefined, color, tableData }); }}
                    className="absolute bottom-4 right-4 p-3 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                >
                    <Trash2 className="w-5 h-5" />
                </button>
            </div>
        )}
        <div className="flex justify-between items-center px-4 pt-4">
           <input
              id="edit-note-title"
              name="title"
              aria-label="Note title"
              type="text" value={title}
              readOnly={note.isTrashed}
              onChange={(e) => {
                  setTitle(e.target.value);
                  handleUpdate({ title: e.target.value });
              }}
              onBlur={() => addToHistory({ title, content, isList, listItems, image, color, tableData })}
              placeholder="Title"
              className="bg-transparent text-[var(--notebook-text)] placeholder-[var(--notebook-placeholder)] font-medium text-2xl outline-none w-full mr-4"
            />
            <div className="flex items-center gap-1">
                {!note.isTrashed && (
                  <button 
                    onClick={() => { const next = !isPinned; setIsPinned(next); handleUpdate({ isPinned: next }); }}
                    className={`p-2 rounded-full hover:bg-[var(--notebook-hover)] ${isPinned ? 'text-[var(--notebook-text)]' : 'text-[var(--notebook-muted)]'}`}
                    title={isPinned ? "Unpin note" : "Pin note"}
                  >
                    <Pin className={`w-5 h-5 ${isPinned ? 'fill-current' : ''}`} />
                  </button>
                )}
                <button onClick={onClose} className="p-2 text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] hover:bg-[var(--notebook-hover)] rounded-full" title="Close editor">
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
               <div className="overflow-x-auto custom-scrollbar pb-4">
                  <table className="w-full border-collapse border border-[var(--notebook-divider)] text-base">
                    <tbody>
                      {tableData.rows.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className={`border border-[var(--notebook-divider)] p-0 relative group/cell align-top transition-colors duration-200 ${cell.color ? ColorStyles[cell.color] : ''}`}>
                                <textarea 
                                  id={`edit-note-table-cell-${rIdx}-${cIdx}`}
                                  name={`table-cell-${rIdx}-${cIdx}`}
                                  aria-label={`Table cell row ${rIdx + 1} column ${cIdx + 1}`}
                                  value={cell.text}
                                  rows={1}
                                  readOnly={note.isTrashed}
                                  onFocus={() => setFocusedCell({ rIdx, cIdx })}
                                  onChange={(e) => {
                                      handleTableCellChange(rIdx, cIdx, e.target.value);
                                      e.target.style.height = 'auto';
                                      e.target.style.height = e.target.scrollHeight + 'px';
                                  }}
                                  ref={(el) => {
                                    if (el) {
                                      el.style.height = 'auto';
                                      el.style.height = el.scrollHeight + 'px';
                                    }
                                  }}
                                  className="w-full bg-transparent p-3 outline-none text-[var(--notebook-text)] placeholder-[var(--notebook-placeholder)] resize-none overflow-hidden block"
                                  placeholder={rIdx === 0 && cIdx === 0 ? "Cell..." : ""}
                                />
                                <div className="absolute top-1 right-1 opacity-0 group-cell/hover:opacity-100 flex gap-1 z-10">
                                    <button 
                                      onClick={() => { setFocusedCell({ rIdx, cIdx }); setShowCellColorOptions(true); }}
                                      className="p-1 text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--note-default-bg)]/80 rounded-full shadow-sm"
                                      title="Cell color"
                                    >
                                      <Palette className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                {rIdx === 0 && tableData.rows[0].length > 1 && !note.isTrashed && (
                                  <button onClick={() => removeCol(cIdx)} className="absolute -top-3 left-1/2 -translate-x-1/2 opacity-0 group-cell/hover:opacity-100 text-[var(--notebook-muted)] hover:text-red-400 z-10 bg-[var(--note-default-bg)] rounded-full transition-opacity">
                                    <MinusSquare className="w-4 h-4" />
                                  </button>
                                )}
                                {cIdx === 0 && tableData.rows.length > 1 && !note.isTrashed && (
                                  <button onClick={() => removeRow(rIdx)} className="absolute top-1/2 -left-4 -translate-y-1/2 opacity-0 group-cell/hover:opacity-100 text-[var(--notebook-muted)] hover:text-red-400 z-10 bg-[var(--note-default-bg)] rounded-full transition-opacity">
                                    <MinusSquare className="w-4 h-4" />
                                  </button>
                                )}
                                
                                {showCellColorOptions && focusedCell?.rIdx === rIdx && focusedCell?.cIdx === cIdx && (
                                    <div ref={cellColorPickerRef} className="absolute top-full right-0 mt-1 p-2 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded-lg shadow-2xl grid grid-cols-6 gap-1 z-[60] min-w-[180px]">
                                        {Object.values(NoteColor).map((c) => (
                                            <button 
                                                key={c} 
                                                className={`w-6 h-6 rounded-full border transition-all ${ColorStyles[c].split(' ')[0]} ${cell.color === c ? 'ring-2 ring-white scale-110' : 'hover:scale-110'}`}
                                                onClick={() => handleCellColorChange(rIdx, cIdx, c)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!note.isTrashed && (
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                       <button onClick={addRow} className="flex items-center gap-1.5 text-xs text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-3 py-1.5 rounded transition-colors"><PlusSquare className="w-4 h-4" /> Add Row</button>
                       <button onClick={addCol} className="flex items-center gap-1.5 text-xs text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-3 py-1.5 rounded transition-colors"><PlusSquare className="w-4 h-4" /> Add Column</button>
                       <button onClick={() => { if(tableData && tableData.rows.length > 1) removeRow(tableData.rows.length - 1); }} className="flex items-center gap-1.5 text-xs text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-3 py-1.5 rounded transition-colors"><MinusSquare className="w-4 h-4" /> Remove Row</button>
                       <button onClick={() => { if(tableData && tableData.rows[0].length > 1) removeCol(tableData.rows[0].length - 1); }} className="flex items-center gap-1.5 text-xs text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-3 py-1.5 rounded transition-colors"><MinusSquare className="w-4 h-4" /> Remove Column</button>
                       <button onClick={() => { setTableData(undefined); handleUpdate({ tableData: undefined }); }} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 ml-auto px-3 py-1.5 rounded bg-red-400/5 transition-colors"><Trash2 className="w-4 h-4" /> Remove Table</button>
                    </div>
                  )}
               </div>
            ) : isList ? (
                <div className="flex flex-col gap-1">
                    <DndContext 
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEndItems}
                    >
                        <SortableContext items={listItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                            {listItems.map((item) => (
                                <SortableListItem 
                                    key={item.id}
                                    item={item}
                                    isTrashed={!!note.isTrashed}
                                    onToggle={() => {
                                        const newItems = listItems.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i);
                                        setListItems(newItems);
                                        handleUpdate({ listItems: newItems });
                                        addToHistory({ title, content, isList, listItems: newItems, image, color, tableData });
                                    }}
                                    onChange={(val) => {
                                        const newItems = listItems.map(i => i.id === item.id ? { ...i, text: val } : i);
                                        setListItems(newItems);
                                        handleUpdate({ listItems: newItems });
                                    }}
                                    onBlur={() => addToHistory({ title, content, isList, listItems, image, color, tableData })}
                                    onRemove={() => {
                                        const newItems = listItems.filter(i => i.id !== item.id);
                                        setListItems(newItems);
                                        handleUpdate({ listItems: newItems });
                                        addToHistory({ title, content, isList, listItems: newItems, image, color, tableData });
                                    }}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                    {!note.isTrashed && (
                      <button className="flex items-center gap-3 px-8 py-2 text-[var(--notebook-muted)] hover:text-[var(--notebook-text)]" onClick={() => {
                          const newItem = { id: genId(), text: '', checked: false, indentLevel: 0 };
                          const newItems = [...listItems, newItem];
                          setListItems(newItems);
                          handleUpdate({ listItems: newItems });
                          addToHistory({ title, content, isList, listItems: newItems, image, color, tableData });
                      }}>
                         <Plus className="w-4 h-4" /> <span>List item</span>
                      </button>
                    )}
                </div>
            ) : (
                <textarea
                    id="edit-note-content"
                    name="content"
                    aria-label="Note content"
                    ref={textareaRef} value={content}
                    readOnly={note.isTrashed}
                    onChange={(e) => { setContent(e.target.value); handleUpdate({ content: e.target.value }); }}
                    onBlur={() => addToHistory({ title, content, isList, listItems, image, color, tableData })}
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
                          onClick={() => onRestore?.(note.id)} 
                          icon={<RotateCcw className="w-4 h-4" />} 
                          title="Restore" 
                        />
                        <div className="relative">
                            <ToolbarButton icon={<MoreVertical className="w-4 h-4" />} title="More" onClick={() => setShowMoreMenu(!showMoreMenu)} />
                            {showMoreMenu && (
                                <div className="absolute bottom-full left-0 mb-2 w-48 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded shadow-2xl z-40 py-1">
                                    <MenuOption icon={<Trash2 className="w-4 h-4" />} label="Delete forever" onClick={() => { onDelete(note.id); onClose(); }} />
                                </div>
                            )}
                        </div>
                      </>
                    ) : (
                      <>
                        <ToolbarButton icon={<BellIcon />} title="Reminders are not configured yet" disabled />
                        
                        <div className="relative" ref={colorPickerRef}>
                            <ToolbarButton 
                                onClick={() => setShowColorOptions(!showColorOptions)} 
                                icon={<Palette className="w-4 h-4" />} 
                                title="Background options" 
                            />
                            {showColorOptions && (
                                <div className="absolute bottom-full left-0 mb-3 p-3 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded-xl shadow-2xl grid grid-cols-6 gap-3 z-50 animate-in fade-in zoom-in-95 duration-150 min-w-[240px]">
                                    {Object.values(NoteColor).map((c) => (
                                        <button 
                                            key={c} 
                                            title={c.charAt(0) + c.slice(1).toLowerCase()}
                                            className={`w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center
                                              ${ColorStyles[c].split(' ')[0]} 
                                              ${color === c ? 'border-white ring-1 ring-white/50 scale-110' : 'border-transparent hover:border-white/30'}
                                            `}
                                            onClick={() => { 
                                                setColor(c); 
                                                handleUpdate({ color: c }); 
                                                addToHistory({ title, content, listItems, color: c, image, tableData, labels }); 
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

                        <ToolbarButton onClick={handleImageClick} icon={<ImageIcon className="w-4 h-4" />} title="Add Image" />
                        <ToolbarButton 
                            onClick={() => { const next = !note.isArchived; handleUpdate({ isArchived: next }); onClose(); }} 
                            icon={<Archive className="w-4 h-4" />} 
                            title={note.isArchived ? "Unarchive" : "Archive"} 
                        />
                        <div className="relative">
                            <ToolbarButton icon={<MoreVertical className="w-4 h-4" />} title="More" onClick={() => setShowMoreMenu(!showMoreMenu)} />
                            {showMoreMenu && (
                                <div className="absolute bottom-full left-0 mb-2 w-48 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded shadow-2xl z-40 py-1">
                                    <MenuOption icon={<Trash2 className="w-4 h-4" />} label="Delete note" onClick={() => { onDelete(note.id); onClose(); }} />
                                    <MenuOption icon={<Tag className="w-4 h-4" />} label="Add label" onClick={() => { setShowLabelEditor(true); setShowMoreMenu(false); requestAnimationFrame(() => labelInputRef.current?.focus()); }} />
                                    <MenuOption icon={<Copy className="w-4 h-4" />} label="Make a copy" onClick={() => { onDuplicate?.(note); setShowMoreMenu(false); }} />
                                </div>
                            )}
                        </div>
                        <ToolbarButton icon={<CheckSquare className="w-4 h-4" />} title="Toggle checkboxes" onClick={toggleListMode} />
                        <ToolbarButton icon={<TableIcon className="w-4 h-4" />} title="Add table" onClick={addTable} />
                        
                        <div className="h-4 w-[1px] bg-[var(--notebook-divider)] mx-1" />
                        <ToolbarButton icon={<Minus className="w-4 h-4" />} title="Decrease canvas width" onClick={() => adjustWidth(false)} />
                        <ToolbarButton icon={<Plus className="w-4 h-4" />} title="Increase canvas width" onClick={() => adjustWidth(true)} />
                        <div className="h-4 w-[1px] bg-[var(--notebook-divider)] mx-1" />

                        <div className="relative inline-flex flex-col items-start" ref={composeMenuRef}>
                          <ToolbarButton 
                              onClick={handleMagicCompose}
                              icon={isGenerating ? <Loader2 className="w-4 h-4 animate-spin text-blue-300" /> : <Sparkles className="w-4 h-4 text-blue-300" />}
                              disabled={isGenerating}
                          />
                          {showComposeMenu && (
                            <div className="absolute left-0 top-full z-50 mt-3 w-64 overflow-hidden rounded-xl border border-[var(--notebook-divider)] bg-[var(--note-default-bg)] py-1 shadow-2xl">
                              {NOTEBOOK_PROMPT_PRESETS.map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedPreset(preset.id);
                                    setShowComposeMenu(false);
                                    void handleNotebookCompose(preset.id);
                                  }}
                                  className={`w-full px-4 py-2.5 text-left transition-colors hover:bg-[var(--notebook-hover)] ${selectedPreset === preset.id ? 'text-[var(--notebook-text)]' : 'text-[var(--notebook-muted)]'}`}
                                >
                                  <div className="text-sm font-semibold">{preset.label}</div>
                                  <div className="mt-0.5 text-[11px] leading-snug opacity-70">{preset.description}</div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <ToolbarButton icon={<RotateCcw className={`w-4 h-4 ${historyIndex <= 0 ? 'opacity-30' : ''}`} />} title="Undo" onClick={handleUndo} />
                        <ToolbarButton icon={<RotateCw className={`w-4 h-4 ${historyIndex >= history.length - 1 ? 'opacity-30' : ''}`} />} title="Redo" onClick={handleRedo} />
                      </>
                    )}
                 </div>
                 <button onClick={onClose} className="px-6 py-2 text-[var(--notebook-text)] font-medium text-sm rounded hover:bg-[var(--notebook-hover)] transition-colors">Close</button>
            </div>
            <div className="text-[11px] text-[var(--notebook-muted)] text-right">
                {note.updatedAt ? `Edited ${new Date(note.updatedAt).toLocaleDateString()} ${new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </div>
        </div>
      </div>
    </div>
  );
};

const ToolbarButton = ({ icon, title, onClick, disabled }: { icon: React.ReactNode, title?: string, onClick?: (e: React.MouseEvent) => void, disabled?: boolean }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-8 h-8 flex items-center justify-center rounded-full text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] hover:bg-[var(--notebook-hover)] transition-colors ${disabled ? 'opacity-35 cursor-not-allowed hover:bg-transparent hover:text-[var(--notebook-muted)]' : ''}`}
      title={title}
    >
      {icon}
    </button>
);

const MenuOption = ({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) => (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--notebook-text)] hover:bg-[var(--notebook-hover)] text-left">{icon}{label}</button>
);

const BellIcon = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;

export default NoteEditor;
