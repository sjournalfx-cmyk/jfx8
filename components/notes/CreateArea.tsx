import React, { useState, useRef, useEffect } from 'react';
import { Image as ImageIcon, CheckSquare, Pin, RotateCcw, RotateCw, Sparkles, Loader2, X, Plus, Minus, Square, CheckSquare as CheckSquareIcon, GripVertical, Palette, Archive, MoreVertical, Trash2, Check, Table as TableIcon, PlusSquare, MinusSquare } from 'lucide-react';
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

interface CreateAreaProps {
  onCreate: (note: Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'isArchived' | 'isTrashed' | 'labels'>) => Promise<any> | void;
  canvasWidth?: number;
  setCanvasWidth?: React.Dispatch<React.SetStateAction<number>>;
}

const genId = () => Math.random().toString(36).slice(2, 9);
const COLUMN_WIDTH_INC = 96;

const SortableListItem = ({ item, onToggle, onChange, onRemove }: { 
    item: ListItem, 
    onToggle: () => void, 
    onChange: (val: string) => void,
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
    marginLeft: item.indentLevel ? `${item.indentLevel * 1.5}rem` : '0px'
  };

  return (
    <div ref={setNodeRef} style={style} className={`flex items-center group px-4 py-1 ${isDragging ? 'opacity-50' : ''}`}>
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-[var(--notebook-muted)] p-1 mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="w-4 h-4" />
        </div>
        <button onClick={onToggle} className="p-1 mr-2 text-[var(--notebook-muted)]">
            {item.checked ? <CheckSquareIcon className="w-4 h-4" /> : <Square className="w-4 h-4" />}
        </button>
        <input 
            id={`create-note-list-item-${item.id}`}
            name={`list-item-${item.id}`}
            aria-label="List item"
            type="text"
            value={item.text}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full bg-transparent outline-none text-[0.875rem] ${item.checked ? 'text-[var(--notebook-muted)] line-through' : 'text-[var(--notebook-text)]'}`}
            placeholder="List item"
        />
        <button onClick={onRemove} className="p-2 text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] opacity-0 group-hover:opacity-100 transition-opacity">
            <X className="w-3 h-3" />
        </button>
    </div>
  );
};

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
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<NotebookPromptPreset>('rewrite');
  const [showComposeMenu, setShowComposeMenu] = useState(false);
  const [showColorOptions, setShowColorOptions] = useState(false);
  const [focusedCell, setFocusedCell] = useState<{ rIdx: number, cIdx: number } | null>(null);
  const [showCellColorOptions, setShowCellColorOptions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const cellColorPickerRef = useRef<HTMLDivElement>(null);
  const composeMenuRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();

  const handleOutsideClick = (e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      // Keep open until Save Note is pressed as per user request
    }
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
  }, [title, content, listItems, isList, color, isPinned, isExpanded, image, tableData, focusedCell, showCellColorOptions]);

  const hasContent = title.trim() || (isList ? listItems.some(item => item.text.trim().length > 0) : content.trim()) || image || (tableData && tableData.rows.some(row => row.some(cell => cell.text.trim().length > 0)));

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
    setShowCellColorOptions(false);
    setFocusedCell(null);
  };

  const saveAndClose = async () => {
    if (!isExpanded || isSaving) return;

    const validItems = listItems.filter(item => item.text.trim().length > 0);
    const hasTableContent = tableData && tableData.rows.some(row => row.some(cell => cell.text.trim().length > 0));

    if (title.trim() || (isList ? validItems.length > 0 : content.trim()) || image || hasTableContent) {
      setIsSaving(true);
      try {
        await onCreate({
          title,
          content: isList ? '' : content,
          isList,
          listItems: isList ? validItems : [],
          isPinned,
          color,
          image,
          tableData: hasTableContent ? tableData : undefined,
        });
        discard();
      } catch (error) {
        console.error('Failed to save note:', error);
      } finally {
        setIsSaving(false);
      }
      return;
    }
    discard();
  };

  const handleExpand = (startAsList = false) => {
    setIsExpanded(true);
    if (startAsList) {
        setIsList(true);
        setListItems([{ id: genId(), text: '', checked: false, indentLevel: 0 }]);
    }
  };

  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
    setContent(e.target.value);
  };
  
  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isExpanded) setIsExpanded(true);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
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
        setListItems((prev) => (shouldReplace ? newItems : [...prev, ...newItems]));
      } else {
        if (shouldReplace) {
          setContent(generated);
        } else {
          const inserted = insertTextAtSelection(textareaRef.current, content, generated);
          setContent(inserted.nextValue);
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.style.height = 'auto';
              textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
              textareaRef.current.selectionStart = inserted.nextSelectionStart;
              textareaRef.current.selectionEnd = inserted.nextSelectionEnd;
            }
          }, 10);
        }
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
          }
        }, 10);
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
    if (!content.trim() && !title.trim() && listItems.length === 0 && !tableData) return;
    setIsGenerating(true);
    try {
        let prompt = '';
        if (isList) {
            const listText = listItems.map(i => i.text).join(', ');
            prompt = `Create a checklist based on: ${title}. Context: ${listText}`;
        } else if (tableData) {
            const colHeaders = tableData.rows[0].map(c => c.text).join(', ');
            prompt = `Provide data for this table about: ${title}. Columns: ${colHeaders}`;
        } else {
            prompt = title ? `Write a detailed note about: ${title}. ${content}` : `Elaborate on this note: ${content}`;
        }
        
        const generated = await generateNoteContent(prompt);
        
        if (isList) {
            const lines = generated.split('\n').filter(l => l.trim());
            const newItems = lines.map(line => ({
                id: genId(),
                text: line.replace(/^[-*•]\s*/, '').trim(), 
                checked: false,
                indentLevel: 0
            }));
            setListItems(prev => [...prev, ...newItems]);
        } else {
            setContent(prev => prev ? `${prev}\n\n${generated}` : generated);
            setTimeout(() => {
                if(textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                    textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
                }
            }, 10);
        }
    } catch (e) { console.error(e); } finally { setIsGenerating(false); }
  };

  const handleMagicCompose = () => {
    if (isGenerating) return;
    setShowComposeMenu((prev) => !prev);
  };

  const toggleListMode = () => {
      setTableData(undefined); // Reset table if switching to list
      if (isList) {
          const text = listItems.map(i => i.text).join('\n');
          setContent(text);
          setIsList(false);
      } else {
          const lines = content.split('\n');
          const items = lines.map(line => ({ id: genId(), text: line, checked: false, indentLevel: 0 }));
          setListItems(items.length ? items : [{ id: genId(), text: '', checked: false, indentLevel: 0 }]);
          setIsList(true);
      }
  };

  const addTable = () => {
    setIsList(false);
    setContent('');
    setTableData({
      rows: [[{ text: '' }, { text: '' }], [{ text: '' }, { text: '' }]]
    });
    if (!isExpanded) setIsExpanded(true);
  };

  const handleTableCellChange = (rowIndex: number, colIndex: number, value: string) => {
    if (!tableData) return;
    const newRows = [...tableData.rows];
    newRows[rowIndex][colIndex] = { ...newRows[rowIndex][colIndex], text: value };
    setTableData({ rows: newRows });
  };

  const handleCellColorChange = (rIdx: number, cIdx: number, cellColor: NoteColor) => {
    if (!tableData) return;
    const newRows = [...tableData.rows];
    newRows[rIdx][cIdx] = { ...newRows[rIdx][cIdx], color: cellColor };
    setTableData({ rows: newRows });
    setShowCellColorOptions(false);
  };

  const addRow = () => {
    if (!tableData) return;
    const colCount = tableData.rows[0].length;
    setTableData({ rows: [...tableData.rows, Array(colCount).fill(null).map(() => ({ text: '' }))] });
  };

  const addCol = () => {
    if (!tableData) return;
    setTableData({ rows: tableData.rows.map(row => [...row, { text: '' }]) });
    // Adjust canvas width automatically
    if (setCanvasWidth) {
        setCanvasWidth(prev => prev + COLUMN_WIDTH_INC);
    }
  };

  const removeRow = (idx: number) => {
    if (!tableData || tableData.rows.length <= 1) return;
    setTableData({ rows: tableData.rows.filter((_, i) => i !== idx) });
  };

  const removeCol = (idx: number) => {
    if (!tableData || tableData.rows[0].length <= 1) return;
    setTableData({ rows: tableData.rows.map(row => row.filter((_, i) => i !== idx)) });
    // Adjust canvas width automatically
    if (setCanvasWidth) {
        setCanvasWidth(prev => Math.max(480, prev - COLUMN_WIDTH_INC));    }
  };

  const adjustWidth = (inc: boolean) => {
      if (setCanvasWidth) {
          setCanvasWidth(prev => {
              const next = inc ? prev + COLUMN_WIDTH_INC : prev - COLUMN_WIDTH_INC;
              return Math.max(320, Math.min(2000, next));          });
      }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEndItems = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = listItems.findIndex(i => i.id === active.id);
      const newIndex = listItems.findIndex(i => i.id === over.id);
      setListItems(arrayMove(listItems, oldIndex, newIndex));
    }
  };

  return (
    <div className="w-full relative z-10">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
      <div 
        ref={containerRef}
        className={`relative w-full rounded-xl transition-all duration-300 bg-[var(--note-default-bg)] overflow-visible
            ${isExpanded ? 'shadow-[0_1px_2px_0_rgba(0,0,0,0.6),0_2px_6px_2px_rgba(0,0,0,0.3)]' : 'shadow-[0_1px_2px_0_rgba(0,0,0,0.6),0_1px_3px_1px_rgba(0,0,0,0.3)]'}
            ${ColorStyles[color]}
            ${color === NoteColor.DEFAULT ? 'border border-[var(--notebook-divider)]' : 'border-transparent'}
        `}
      >
        {!isExpanded ? (
          <div onClick={() => handleExpand(false)} className="flex items-center justify-between px-4 py-3 cursor-text h-[46px]">
            <span className="text-[var(--notebook-text)] font-medium text-[1rem] tracking-wide placeholder-text opacity-70">Take a note...</span>
            <div className="flex gap-2 text-[var(--notebook-muted)] items-center">
              <button onClick={(e) => { e.stopPropagation(); handleExpand(true); }} className="p-2 hover:bg-[var(--notebook-hover)] rounded-full transition-colors" title="New list">
                  <CheckSquare className="w-5 h-5" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); addTable(); }} className="p-2 hover:bg-[var(--notebook-hover)] rounded-full transition-colors" title="New table">
                  <TableIcon className="w-5 h-5" />
              </button>
              <button onClick={handleImageClick} className="p-2 hover:bg-[var(--notebook-hover)] rounded-full transition-colors" title="New note with image">
                  <ImageIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            {image && (
                <div className="relative w-full group">
                    <img src={image} alt="Preview" className="w-full max-h-[400px] object-cover" />
                    <button 
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
                className="w-full bg-transparent text-[var(--notebook-text)] placeholder-[var(--notebook-placeholder)] font-medium text-[1.1rem] outline-none"
              />
              <button onClick={() => setIsPinned(!isPinned)} className={`p-2 rounded-full hover:bg-neutral-600/30 transition-colors ${isPinned ? 'text-[var(--notebook-text)]' : 'text-[var(--notebook-muted)]'}`}>
                <Pin className={`w-5 h-5 ${isPinned ? 'fill-current' : ''}`} />
              </button>
            </div>
            
            <div className="py-3 px-0 min-h-[46px]">
                {tableData ? (
                  <div className="px-4 overflow-x-auto pb-4 custom-scrollbar">
                    <table className="w-full border-collapse border border-[var(--notebook-divider)] text-sm">
                      <tbody>
                        {tableData.rows.map((row, rIdx) => (
                          <tr key={rIdx}>
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className={`border border-[var(--notebook-divider)] p-0 relative group/cell align-top transition-colors duration-200 ${cell.color ? ColorStyles[cell.color] : ''}`}>
                                <textarea 
                                  id={`create-note-table-cell-${rIdx}-${cIdx}`}
                                  name={`table-cell-${rIdx}-${cIdx}`}
                                  aria-label={`Table cell row ${rIdx + 1} column ${cIdx + 1}`}
                                  value={cell.text}
                                  rows={1}
                                  onFocus={() => setFocusedCell({ rIdx, cIdx })}
                                  onChange={(e) => {
                                      handleTableCellChange(rIdx, cIdx, e.target.value);
                                      e.target.style.height = 'auto';
                                      e.target.style.height = e.target.scrollHeight + 'px';
                                  }}
                                  className="w-full bg-transparent p-2 outline-none text-[var(--notebook-text)] placeholder-[var(--notebook-placeholder)] resize-none overflow-hidden block"
                                  placeholder={rIdx === 0 && cIdx === 0 ? "Cell..." : ""}
                                />
                                <div className="absolute top-1 right-1 opacity-0 group-cell/hover:opacity-100 flex gap-1 z-10">
                                    <button 
                                      onClick={() => { setFocusedCell({ rIdx, cIdx }); setShowCellColorOptions(true); }}
                                      className="p-1 text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--note-default-bg)]/80 rounded-full shadow-sm"
                                      title="Cell color"
                                    >
                                      <Palette className="w-3 h-3" />
                                    </button>
                                </div>
                                {rIdx === 0 && tableData.rows[0].length > 1 && (
                                  <button onClick={() => removeCol(cIdx)} className="absolute -top-3 left-1/2 -translate-x-1/2 opacity-0 group-cell/hover:opacity-100 text-[var(--notebook-muted)] hover:text-red-400 z-10 bg-[var(--note-default-bg)] rounded-full transition-opacity">
                                    <MinusSquare className="w-3 h-3" />
                                  </button>
                                )}
                                {cIdx === 0 && tableData.rows.length > 1 && (
                                  <button onClick={() => removeRow(rIdx)} className="absolute top-1/2 -left-3 -translate-y-1/2 opacity-0 group-cell/hover:opacity-100 text-[var(--notebook-muted)] hover:text-red-400 z-10 bg-[var(--note-default-bg)] rounded-full transition-opacity">
                                    <MinusSquare className="w-3 h-3" />
                                  </button>
                                )}
                                
                                {showCellColorOptions && focusedCell?.rIdx === rIdx && focusedCell?.cIdx === cIdx && (
                                    <div ref={cellColorPickerRef} className="absolute top-full right-0 mt-1 p-2 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded-lg shadow-2xl grid grid-cols-6 gap-1 z-[60] min-w-[180px]">
                                        {Object.values(NoteColor).map((c) => (
                                            <button 
                                                key={c} 
                                                className={`w-5 h-5 rounded-full border transition-all ${ColorStyles[c].split(' ')[0]} ${cell.color === c ? 'ring-2 ring-white scale-110' : 'hover:scale-110'}`}
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
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                       <button onClick={addRow} className="flex items-center gap-1.5 text-[11px] text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-2 py-1 rounded transition-colors"><PlusSquare className="w-3.5 h-3.5" /> Add Row</button>
                       <button onClick={addCol} className="flex items-center gap-1.5 text-[11px] text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-2 py-1 rounded transition-colors"><PlusSquare className="w-3.5 h-3.5" /> Add Column</button>
                       <button onClick={() => { if(tableData && tableData.rows.length > 1) removeRow(tableData.rows.length - 1); }} className="flex items-center gap-1.5 text-[11px] text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-2 py-1 rounded transition-colors"><MinusSquare className="w-3.5 h-3.5" /> Remove Row</button>
                       <button onClick={() => { if(tableData && tableData.rows[0].length > 1) removeCol(tableData.rows[0].length - 1); }} className="flex items-center gap-1.5 text-[11px] text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-2 py-1 rounded transition-colors"><MinusSquare className="w-3.5 h-3.5" /> Remove Column</button>
                       <button onClick={() => setTableData(undefined)} className="flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-300 ml-auto px-2 py-1 rounded bg-red-400/5 transition-colors"><Trash2 className="w-3.5 h-3.5" /> Remove Table</button>
                    </div>                  </div>
                ) : isList ? (
                    <div className="flex flex-col">
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
                                        onToggle={() => setListItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i))}
                                        onChange={(val) => setListItems(prev => prev.map(i => i.id === item.id ? { ...i, text: val } : i))}
                                        onRemove={() => setListItems(prev => prev.filter(i => i.id !== item.id))}
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>
                         <div className="flex items-center px-4 py-1 text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] cursor-pointer" onClick={() => setListItems(prev => [...prev, { id: genId(), text: '', checked: false, indentLevel: 0 }])}>
                            <Plus className="w-4 h-4 mr-3 ml-7" />
                            <span className="text-[0.875rem]">List item</span>
                        </div>
                    </div>
                ) : (
                    <textarea
                        id="create-note-content"
                        name="content"
                        aria-label="Note content"
                        ref={textareaRef}
                        value={content}
                        onChange={autoResize}
                        placeholder="Take a note..."
                        className="w-full bg-transparent text-[var(--notebook-text)] placeholder-[var(--notebook-placeholder)] text-[0.875rem] px-4 outline-none resize-none min-h-[46px]"
                        rows={1} autoFocus
                    />
                )}
            </div>
            
            <div className="flex justify-between items-center px-2 pb-2">
              <div className="flex gap-0 items-center">
                 <ToolbarButton icon={<BellIcon />} title="Reminders are not configured yet" disabled />
                 
                 <div className="relative" ref={colorPickerRef}>
                    <ToolbarButton 
                      onClick={() => setShowColorOptions(!showColorOptions)} 
                      icon={<Palette className="w-4 h-4" />} 
                      title="Background options" 
                    />
                    {showColorOptions && (
                      <div className="absolute bottom-full left-0 mb-3 p-3 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded-xl shadow-2xl grid grid-cols-6 gap-3 z-40 animate-in fade-in zoom-in-95 duration-150 min-w-[240px]">
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
                 <ToolbarButton icon={<Archive className="w-4 h-4" />} title="Archive becomes available after saving" disabled />
                 <ToolbarButton icon={<MoreVertical className="w-4 h-4" />} title="More actions become available after saving" disabled />
                 <ToolbarButton icon={<CheckSquare className="w-4 h-4" />} title="Toggle checkboxes" onClick={toggleListMode} />
                 <ToolbarButton icon={<TableIcon className="w-4 h-4" />} title="Add table" onClick={addTable} />
                 
                 <div className="h-4 w-[1px] bg-[var(--notebook-divider)] mx-1" />
                 <ToolbarButton icon={<Minus className="w-4 h-4" />} title="Decrease canvas width" onClick={() => adjustWidth(false)} />
                 <ToolbarButton icon={<Plus className="w-4 h-4" />} title="Increase canvas width" onClick={() => adjustWidth(true)} />
                 <div className="h-4 w-[1px] bg-[var(--notebook-divider)] mx-1" />

                 <div className="relative inline-flex flex-col items-start" ref={composeMenuRef}>
                   <ToolbarButton onClick={handleMagicCompose} icon={isGenerating ? <Loader2 className="w-4 h-4 animate-spin text-blue-300" /> : <Sparkles className="w-4 h-4 text-blue-300" />} disabled={isGenerating} />
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
                 <ToolbarButton icon={<RotateCcw className="w-4 h-4" />} title="Undo" disabled />
                 <ToolbarButton icon={<RotateCw className="w-4 h-4" />} title="Redo" disabled />
              </div>
              <div className="flex gap-2 items-center sticky bottom-0">
                {hasContent && (
                  <button 
                    onClick={discard} 
                    className="px-4 py-2 text-red-400 font-medium text-sm rounded-md hover:bg-red-400/10 transition-colors"
                  >
                    Discard
                  </button>
                )}
                 <button 
                    onClick={saveAndClose} 
                    disabled={isSaving}
                    className="px-6 py-2 text-[var(--notebook-text)] font-medium text-sm rounded-md hover:bg-[var(--notebook-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                  {isSaving ? 'Saving...' : (hasContent ? 'Save note' : 'Close')}
                 </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ToolbarButton = ({ icon, title, onClick, disabled }: { icon: React.ReactNode, title?: string, onClick?: (e: React.MouseEvent) => void, disabled?: boolean }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-8 h-8 flex items-center justify-center rounded-full text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-neutral-600/30 transition-colors mx-0.5 ${disabled ? 'opacity-35 cursor-not-allowed hover:bg-transparent hover:text-[#9aa0a6]' : ''}`}
      title={title}
    >
      {icon}
    </button>
)

const BellIcon = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;

export default CreateArea;
