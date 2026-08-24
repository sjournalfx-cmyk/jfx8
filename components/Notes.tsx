import React, { useState, useRef, useEffect } from 'react';
import CreateArea from './notes/CreateArea';
import NoteCard from './notes/NoteCard';
import NoteEditor from './notes/NoteEditor';
import { Note as KeepNote, NoteColor, SidebarSection } from './notes/types';
import { Note as AppNote, UserProfile } from '../types';
import { Search, Settings, Trash2, Archive, Lightbulb, RotateCcw, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
import { useToast, type ToastType } from './ui/Toast';

const PAGE = 60;

type CreateNotePayload = Omit<KeepNote, 'id' | 'createdAt' | 'updatedAt' | 'isArchived' | 'isTrashed' | 'labels'> & {
  labels?: string[];
  createdAt?: number;
  updatedAt?: number;
  isArchived?: boolean;
  isTrashed?: boolean;
};

interface NotesProps {
  isDarkMode: boolean;
  notes: AppNote[];
  onAddNote: (note: any) => Promise<any>;
  onUpdateNote: (note: any) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
  onRestoreNote: (id: string) => Promise<void>;
  userProfile?: UserProfile | null;
  onViewChange: (view: string) => void;
  isDemoMode?: boolean;
}

const Notes: React.FC<NotesProps> = ({
  isDarkMode,
  notes: appNotes,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  userProfile,
  onViewChange,
  isDemoMode = false,
}) => {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentSection, setCurrentSection] = useState<SidebarSection>('NOTES');
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  // Canvas Size State
  const [canvasWidth, setCanvasWidth] = useState(560);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);
  const pendingResizeRef = useRef<{ width: number; height: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const appliedSizeRef = useRef({ width: canvasWidth, height: canvasHeight });
  const canvasPaneRef = useRef<HTMLDivElement | null>(null);

  const [visibleCount, setVisibleCount] = useState(PAGE);

  const { addToast } = useToast();

  const pushToast = React.useCallback((
    variant: Extract<ToastType, 'success' | 'error'>,
    title: string,
    message?: string,
    action?: { label: string; onClick: () => void }
  ) => {
    addToast({ type: variant, title, message, action, duration: action ? 6500 : undefined });
  }, [addToast]);

  const blockDemoAction = (title: string) => {
    pushToast('error', title, 'Notes are read-only in demo mode.');
  };

  // Map AppNote to KeepNote
  const notes: KeepNote[] = React.useMemo(() => appNotes.map(n => ({
    id: n.id,
    title: n.title,
    content: n.content,
    isPinned: !!n.isPinned,
    isArchived: (n as any).isArchived || false,
    isTrashed: (n as any).isTrashed || false,
    color: (n.color?.toUpperCase() as NoteColor) || NoteColor.DEFAULT,
    labels: n.tags || [],
    createdAt: new Date((n as any).created_at || n.date).getTime(),
    updatedAt: new Date((n as any).updated_at || (n as any).created_at || n.date).getTime(),
    isList: (n as any).isList || false,
    listItems: (n as any).listItems || [],
    image: (n as any).image,
    tableData: (n as any).tableData,
    position: n.position,
  })), [appNotes]);

  const selectedNote = notes.find(n => n.id === selectedNoteId) || null;
  const availableLabels = React.useMemo(() => {
    return Array.from(new Set(notes.flatMap(note => note.labels || []))).sort((a, b) => a.localeCompare(b));
  }, [notes]);

  const getNextVisiblePosition = () => {
    const visiblePositions = appNotes
      .filter(n => !(n as any).isArchived && !(n as any).isTrashed)
      .map(n => n.position ?? 0);
    return visiblePositions.length > 0 ? Math.min(...visiblePositions) - 1 : 0;
  };

  const handleCreateNote = async (newNoteData: CreateNotePayload) => {
    if (isDemoMode) {
      blockDemoAction('Cannot create note');
      throw new Error('Demo mode');
    }
    const nextPosition = newNoteData.position ?? getNextVisiblePosition();

    const newNote: Partial<AppNote> = {
      title: newNoteData.title,
      content: newNoteData.content,
      isPinned: newNoteData.isPinned,
      color: newNoteData.color.toLowerCase() as any,
      tags: newNoteData.labels || [],
      date: new Date(newNoteData.createdAt ?? Date.now()).toISOString(),
      position: nextPosition
    };

    // Add extra fields for the new notebook
    (newNote as any).isList = newNoteData.isList;
    (newNote as any).listItems = newNoteData.listItems;
    (newNote as any).image = newNoteData.image;
    (newNote as any).tableData = newNoteData.tableData;

    try {
      const added = await onAddNote(newNote);
      if (!added) {
        throw new Error('Note was not persisted');
      }
      pushToast('success', 'Note saved', 'Your note has been saved.');
      return added;
    } catch (error) {
      console.error("Failed to create note", error);
      if ((error as Error)?.message !== 'Demo mode') {
        pushToast('error', 'Save failed', 'Your note could not be saved.');
      }
      throw error;
    }
  };

  const handleUpdateKeepNote = async (updatedNote: KeepNote) => {
    const update: Partial<AppNote> & { id: string } = {
      id: updatedNote.id,
      title: updatedNote.title,
      content: updatedNote.content,
      isPinned: updatedNote.isPinned,
      color: updatedNote.color.toLowerCase() as any,
      tags: updatedNote.labels,
      position: updatedNote.position,
    };

    // Add extra fields
    (update as any).isArchived = updatedNote.isArchived;
    (update as any).isTrashed = updatedNote.isTrashed;
    (update as any).isList = updatedNote.isList;
    (update as any).listItems = updatedNote.listItems;
    (update as any).image = updatedNote.image;
    (update as any).tableData = updatedNote.tableData;

    try {
      await onUpdateNote(update);
    } catch (error) {
      console.error('Failed to update note', error);
      pushToast('error', 'Update failed', 'Your changes could not be saved.');
    }
  };

  const handlePinNote = (e: React.MouseEvent, note: KeepNote) => {
    e.stopPropagation();
    void handleUpdateKeepNote({ ...note, isPinned: !note.isPinned });
  };

  const handleArchiveNote = (e: React.MouseEvent, note: KeepNote) => {
    e.stopPropagation();
    void handleUpdateKeepNote({ ...note, isArchived: !note.isArchived });
  };

  const trashNote = async (note: KeepNote) => {
    if (isDemoMode) {
      blockDemoAction('Cannot delete note');
      return;
    }
    try {
      await onUpdateNote({ ...note, isTrashed: true } as any);
      if (selectedNoteId === note.id) setSelectedNoteId(null);
      pushToast('success', 'Note deleted', `"${note.title || 'Untitled'}" moved to trash.`, {
        label: 'Undo',
        onClick: () => void restoreNote(note),
      });
    } catch (error) {
      console.error('Failed to delete note', error);
      pushToast('error', 'Delete failed', 'An error occurred while deleting the note.');
    }
  };

  const restoreNote = async (note: KeepNote) => {
    if (isDemoMode) {
      blockDemoAction('Cannot restore note');
      return;
    }
    try {
      await onUpdateNote({ ...note, isTrashed: false } as any);
      pushToast('success', 'Note restored', `"${note.title || 'Untitled'}" is back in your library.`);
    } catch (error) {
      console.error('Failed to restore note', error);
      pushToast('error', 'Restore failed', 'The note could not be restored.');
    }
  };

  const handleRestoreNote = (e: React.MouseEvent, note: KeepNote) => {
    e.stopPropagation();
    void restoreNote(note);
  };

  const handleRestoreById = (id: string) => {
    const target = notes.find(n => n.id === id);
    if (target) void restoreNote(target);
  };

  const handleDeleteNote = async (idOrNote: string | KeepNote) => {
    const note = typeof idOrNote === 'string' ? notes.find(n => n.id === idOrNote) : idOrNote;
    if (!note) return;
    // Notes already in trash go through the permanent-delete confirmation.
    if (note.isTrashed) {
      try {
        await onDeleteNote(note.id);
      } catch (error) {
        console.error('Failed to delete note', error);
        pushToast('error', 'Delete failed', 'An error occurred while deleting the note.');
      }
      return;
    }
    await trashNote(note);
  };

  const handleDuplicateNote = async (note: KeepNote) => {
    const {
      id: _duplicateId,
      createdAt: _duplicateCreatedAt,
      updatedAt: _duplicateUpdatedAt,
      isArchived: _duplicateIsArchived,
      isTrashed: _duplicateIsTrashed,
      ...duplicateFields
    } = note;

    try {
      await handleCreateNote({
        ...duplicateFields,
        title: `${note.title} (Copy)`,
        isPinned: false,
        isArchived: false,
        isTrashed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        position: getNextVisiblePosition(),
      });
      pushToast('success', 'Note duplicated', 'A copy of the note was created.');
    } catch (error) {
      console.error('Failed to duplicate note', error);
      pushToast('error', 'Duplicate failed', 'The note could not be duplicated.');
    }
  };

  // Resize Handlers
  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: canvasWidth,
      startHeight: canvasPaneRef.current?.offsetHeight ?? canvasHeight ?? 0,
    };
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const deltaX = e.clientX - resizeRef.current.startX;
      const deltaY = e.clientY - resizeRef.current.startY;
      pendingResizeRef.current = {
        width: Math.max(400, Math.min(2000, resizeRef.current.startWidth + deltaX)),
        height: Math.max(0, resizeRef.current.startHeight + deltaY),
      };
      if (resizeFrameRef.current == null) {
        resizeFrameRef.current = window.requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          const pending = pendingResizeRef.current;
          if (!pending) return;
          if (pending.width !== appliedSizeRef.current.width) {
            setCanvasWidth(pending.width);
            appliedSizeRef.current.width = pending.width;
          }
          if (pending.height !== appliedSizeRef.current.height) {
            setCanvasHeight(pending.height);
            appliedSizeRef.current.height = pending.height;
          }
        });
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      pendingResizeRef.current = null;
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, [isResizing]);

  const {
    pinnedNotes: allPinnedNotes,
    otherNotes: allOtherNotes,
    visiblePinned,
    visibleOther,
    shownCount,
    totalCount,
  } = React.useMemo(() => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = (note: KeepNote) =>
      note.title.toLowerCase().includes(q) ||
      note.content.toLowerCase().includes(q) ||
      note.listItems?.some(item => item.text.toLowerCase().includes(q)) ||
      (note.labels || []).some(label => label.toLowerCase().includes(q));

    const filtered = notes.filter(note => {
      if (!matchesSearch(note)) return false;
      if (currentSection === 'EDIT_LABELS') {
        return !note.isArchived && !note.isTrashed && (!activeLabel || (note.labels || []).includes(activeLabel));
      }
      if (currentSection === 'ARCHIVE') return note.isArchived && !note.isTrashed;
      if (currentSection === 'TRASH') return note.isTrashed;
      return !note.isArchived && !note.isTrashed;
    });

    const byPosition = (a: KeepNote, b: KeepNote) => (a.position ?? 0) - (b.position ?? 0);
    const pinned = filtered.filter(n => n.isPinned).sort(byPosition);
    const others = filtered.filter(n => !n.isPinned).sort(byPosition);
    const nextPinned = pinned.slice(0, visibleCount);
    const nextOther = others.slice(0, Math.max(0, visibleCount - nextPinned.length));
    return {
      pinnedNotes: pinned,
      otherNotes: others,
      visiblePinned: nextPinned,
      visibleOther: nextOther,
      shownCount: nextPinned.length + nextOther.length,
      totalCount: pinned.length + others.length,
    };
  }, [notes, searchQuery, currentSection, activeLabel, visibleCount]);

  const hasMore = shownCount < totalCount;

  useEffect(() => {
    setVisibleCount(PAGE);
  }, [currentSection, searchQuery, activeLabel]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisibleCount(count => count + PAGE);
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, visibleCount]);

  useEffect(() => {
    if (selectedNoteId && !appNotes.some(n => n.id === selectedNoteId)) {
      setSelectedNoteId(null);
    }
  }, [selectedNoteId, appNotes]);

  const emptyTitle = currentSection === 'ARCHIVE'
    ? 'No archived notes'
    : currentSection === 'TRASH'
      ? 'Trash is empty'
      : currentSection === 'EDIT_LABELS'
        ? activeLabel
          ? `No notes tagged "${activeLabel}"`
          : 'Pick a label to start'
        : 'No notes found';
  const emptyDescription = currentSection === 'ARCHIVE'
    ? 'Archived notes stay here until you restore them.'
    : currentSection === 'TRASH'
      ? 'Deleted notes will appear here before they are permanently removed.'
      : currentSection === 'EDIT_LABELS'
        ? activeLabel
          ? 'Try another label or clear the current filter.'
          : 'Select a label from the browser to filter notes.'
        : 'Create a note to start building your notebook.';

  const sensors = useSensors(
    useSensor(PointerSensor, {
        activationConstraint: {
            distance: 8,
        },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const reorderBusyRef = useRef(false);

  const handleDragEndNotes = async (event: DragEndEvent, list: KeepNote[], isPinnedList: boolean) => {
    const { active, over } = event;

    if (!over || active.id === over.id || reorderBusyRef.current) return;

    const oldIndex = list.findIndex(n => n.id === active.id);
    const newIndex = list.findIndex(n => n.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const categoryList = isPinnedList ? allPinnedNotes : allOtherNotes;
    const otherList = isPinnedList ? allOtherNotes : allPinnedNotes;
    const movedVisible = arrayMove(list, oldIndex, newIndex);
    const ordered = isPinnedList
      ? [...movedVisible, ...categoryList.slice(list.length), ...otherList]
      : [...otherList, ...movedVisible, ...categoryList.slice(list.length)];
    const updates = ordered.map((n, i) => ({ id: n.id, position: i }));
    const previousPositions = categoryList.map(n => ({ id: n.id, position: n.position }));

    reorderBusyRef.current = true;
    try {
      for (const update of updates) {
        await onUpdateNote({ id: update.id, position: update.position } as any);
      }
    } catch (error) {
      console.error('Failed to persist note order', error);
      pushToast('error', 'Reorder failed', 'Could not save the new order.');
      try {
        for (const restore of previousPositions) {
          await onUpdateNote({ id: restore.id, position: restore.position } as any);
        }
      } catch (revertError) {
        console.error('Failed to revert note order', revertError);
      }
    } finally {
      reorderBusyRef.current = false;
    }
  };

  const handleResetView = () => {
    setSearchQuery('');
    setSelectedNoteId(null);
    setActiveLabel(null);
  };

  useEffect(() => {
    if (activeLabel && !availableLabels.includes(activeLabel)) {
      setActiveLabel(null);
    }
  }, [activeLabel, availableLabels]);

  return (
    <div className={`flex flex-col h-full w-full font-sans overflow-hidden ${isResizing ? 'cursor-nwse-resize select-none' : ''}`} style={{ backgroundColor: 'var(--note-default-bg)', color: 'var(--notebook-text)' }}>
      {/* Header */}
      <header
        className="sticky top-0 grid grid-cols-[300px_1fr_300px] items-center px-8 py-1.5 border-b shrink-0 z-30 backdrop-blur-md"
        style={{
          backgroundColor: isDarkMode ? 'rgba(10, 10, 10, 0.8)' : 'rgba(255, 255, 255, 0.8)',
          borderColor: 'var(--notebook-divider)'
        }}
      >
        <div className="flex items-center gap-4 overflow-visible">
          {[
            { id: 'NOTES', icon: Lightbulb, title: 'Notes' },
            { id: 'ARCHIVE', icon: Archive, title: 'Archive' },
            { id: 'TRASH', icon: Trash2, title: 'Trash' },
            { id: 'EDIT_LABELS', icon: Tag, title: 'Labels' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => {
                const next = item.id as SidebarSection;
                setCurrentSection(next);
                if (next !== 'EDIT_LABELS') setActiveLabel(null);
              }}
              aria-current={currentSection === item.id ? 'page' : undefined}
              className={`flex items-center gap-2 py-2.5 transition-all relative group shrink-0`}
              title={item.title}
            >
              <item.icon className={`w-[18px] h-[18px] shrink-0 transition-colors ${
                currentSection === item.id
                  ? 'text-[#FF4F00]'
                  : 'text-[var(--notebook-muted)] group-hover:text-[var(--notebook-text)]'
              }`} />
              <span className={`text-[9px] font-bold uppercase tracking-widest transition-colors ${
                currentSection === item.id
                  ? 'text-[#FF4F00]'
                  : 'text-[var(--notebook-muted)] group-hover:text-[var(--notebook-text)]'
              }`}>
                {item.title}
              </span>
              {currentSection === item.id && (
                <div className="absolute -bottom-[7.5px] left-0 right-0 h-0.5 bg-[#FF4F00] rounded-full" />
              )}
            </button>
          ))}
        </div>

        <div className="flex justify-center">
          <div className={`w-full max-w-[400px] relative flex items-center rounded-lg transition-all group bg-[var(--notebook-hover)] focus-within:bg-[var(--note-default-bg)] focus-within:ring-1 focus-within:ring-[#FF4F00]/20`}>
            <div className={`pl-2.5 pr-1.5 text-[var(--notebook-muted)] group-focus-within:text-[#FF4F00]`}>
              <Search className="w-4 h-4" />
            </div>
            <input
              id="notes-search-input"
              name="search"
              aria-label="Search your notes"
              type="text"
              placeholder="Search your notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent outline-none py-1.5 text-xs placeholder:opacity-50"
              style={{ color: 'var(--notebook-text)' }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 justify-self-end">
          <HeaderIcon icon={<RotateCcw className="w-[17px] h-[17px]" />} title="Reset view" onClick={handleResetView} />
          <HeaderIcon icon={<Settings className="w-[17px] h-[17px]" />} title="Settings" onClick={() => onViewChange('settings')} />
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden relative">
        <div className={`flex flex-1 overflow-hidden transition-all duration-300`}>
            {/* Left Side: Scrollable Notes List */}
            <aside className="w-[340px] xl:w-[380px] flex flex-col border-r shrink-0 overflow-y-auto custom-scrollbar transition-all duration-300" style={{ backgroundColor: 'var(--note-default-bg)', borderColor: 'var(--notebook-divider)' }}>
                <div className="p-4 space-y-4">
                    {currentSection === 'EDIT_LABELS' && (
                        <div className="rounded-2xl border border-[#FF4F00]/20 bg-[#FF4F00]/5 p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-[#FF4F00]">Label Browser</p>
                                    <p className="text-xs opacity-60 mt-1">Filter notebook cards by label.</p>
                                </div>
                                {activeLabel && (
                                    <button
                                        onClick={() => setActiveLabel(null)}
                                        aria-label="Clear label filter"
                                        className="text-[10px] font-black uppercase tracking-widest text-[#FF4F00] hover:text-[#E64600]"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => setActiveLabel(null)}
                                    aria-label="Show all labels"
                                    className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${!activeLabel ? 'border-[#FF4F00] bg-[#FF4F00] text-white' : 'border-[var(--notebook-divider)] text-[var(--notebook-muted)] hover:text-[var(--notebook-text)]'}`}
                                >
                                    All Labels
                                </button>
                                {availableLabels.map(label => (
                                    <button
                                        key={label}
                                        onClick={() => setActiveLabel(label)}
                                        aria-label={`Filter by label ${label}`}
                                        className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${activeLabel === label ? 'border-[#FF4F00] bg-[#FF4F00] text-white' : 'border-[var(--notebook-divider)] text-[var(--notebook-muted)] hover:text-[var(--notebook-text)]'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            {availableLabels.length === 0 && (
                                <p className="text-xs opacity-50 mt-3 leading-relaxed">No labels yet. Add labels from the note editor menu when you're ready.</p>
                            )}
                        </div>
                    )}

                    <AnimatePresence initial={false} mode="popLayout">
                        {visiblePinned.length > 0 && (
                            <motion.div
                                key="pinned-section"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="mb-8"
                            >
                                <h2 className="text-[0.65rem] font-black tracking-widest mb-4 uppercase pl-2 opacity-50">Pinned</h2>
                                <div className="flex flex-col gap-3">
                                    <DndContext
                                        sensors={sensors}
                                        collisionDetection={closestCenter}
                                        onDragEnd={(e) => handleDragEndNotes(e, visiblePinned, true)}
                                    >
                                        <SortableContext items={visiblePinned.map(n => n.id)} strategy={verticalListSortingStrategy}>
                                            <AnimatePresence mode="popLayout">
                                                {visiblePinned.map(note => (
                                                    <SortableWrapper key={note.id} id={note.id}>
                                                        <NoteCard
                                                            note={note}
                                                            onClick={(n) => setSelectedNoteId(n.id)}
                                                            onPin={handlePinNote}
                                                            onArchive={handleArchiveNote}
                                                            onDelete={(e, n) => { e.stopPropagation(); void handleDeleteNote(n); }}
                                                            onRestore={handleRestoreNote}
                                                        />
                                                    </SortableWrapper>
                                                ))}
                                            </AnimatePresence>
                                        </SortableContext>
                                    </DndContext>
                                </div>
                            </motion.div>
                        )}

                        {(visiblePinned.length > 0 || visibleOther.length > 0) ? (
                            <motion.div key="others-section" layout>
                                {visiblePinned.length > 0 && visibleOther.length > 0 && (
                                    <h2 className="text-[0.65rem] font-black tracking-widest mb-4 uppercase pl-2 opacity-50">Others</h2>
                                )}
                                <div className="flex flex-col gap-3">
                                    <DndContext
                                        sensors={sensors}
                                        collisionDetection={closestCenter}
                                        onDragEnd={(e) => handleDragEndNotes(e, visibleOther, false)}
                                    >
                                        <SortableContext items={visibleOther.map(n => n.id)} strategy={verticalListSortingStrategy}>
                                            <AnimatePresence mode="popLayout">
                                                {visibleOther.map(note => (
                                                    <SortableWrapper key={note.id} id={note.id}>
                                                        <NoteCard
                                                            note={note}
                                                            onClick={(n) => setSelectedNoteId(n.id)}
                                                            onPin={handlePinNote}
                                                            onArchive={handleArchiveNote}
                                                            onDelete={(e, n) => { e.stopPropagation(); void handleDeleteNote(n); }}
                                                            onRestore={handleRestoreNote}
                                                        />
                                                    </SortableWrapper>
                                                ))}
                                            </AnimatePresence>
                                        </SortableContext>
                                    </DndContext>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="empty-state"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex flex-col items-center justify-center py-20 opacity-20"
                            >
                                <Lightbulb className="w-16 h-16 mb-4" />
                                <p className="text-sm font-bold uppercase tracking-wider">{emptyTitle}</p>
                                <p className="text-xs mt-2 max-w-2xl leading-relaxed whitespace-normal break-normal">{emptyDescription}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {hasMore && <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />}
                    {hasMore && (
                        <p className="text-center text-[10px] uppercase tracking-widest opacity-40 pb-2">
                            Showing {shownCount} of {totalCount}
                        </p>
                    )}
                </div>
            </aside>

            {/* Right Side: Workspace Canvas */}
            <main className={`flex-1 overflow-y-auto custom-scrollbar flex flex-col items-center py-12 px-8 relative bg-[var(--note-default-bg)]`}>

              <div
                ref={canvasPaneRef}
                className={`relative transition-all duration-300 ${isResizing ? 'ring-2 ring-[#FF4F00]/50' : ''}`}
                style={{
                  width: `${canvasWidth}px`,
                  height: canvasHeight > 0 ? `${canvasHeight}px` : 'auto',
                  minWidth: '320px',
                }}
              >
                {selectedNote ? (
                  <div className="w-full flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-500 ease-spring">
                    <NoteEditor
                      note={selectedNote}
                      onClose={(info) => {
                  setSelectedNoteId(null);
                  if (info?.saved) pushToast('success', 'All changes saved', 'Your note is up to date.');
                }}
                      onUpdate={handleUpdateKeepNote}
                      onDelete={handleDeleteNote}
                      onRestore={handleRestoreById}
                      onDuplicate={handleDuplicateNote}
                      canvasWidth={canvasWidth}
                      setCanvasWidth={setCanvasWidth}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="w-full mb-20">
                      <CreateArea
                        onCreate={handleCreateNote}
                        canvasWidth={canvasWidth}
                        setCanvasWidth={setCanvasWidth}
                      />
                    </div>

                    <div className={`w-full flex flex-col items-center text-center opacity-10 select-none pointer-events-none mt-12 text-[var(--notebook-text)]`}>
                            <div className="mb-6">
                               <Lightbulb className="w-32 h-32 mx-auto stroke-1" />
                            </div>
                            <h3 className="text-3xl font-black uppercase tracking-tight">Your Ideas Await</h3>
                            <p className="mt-2 text-lg font-medium">Select a note from the list to refine your thoughts</p>
                    </div>
                  </div>
                )}

                {/* Canvas Resize Handle */}
                <div
                  onMouseDown={startResizing}
                  className={`absolute bottom-0 right-0 w-10 h-10 flex items-center justify-center cursor-nwse-resize z-50 group pointer-events-auto
                    ${isResizing ? 'text-[#FF4F00]' : 'text-zinc-500 opacity-0 group-hover:opacity-100'}
                    hover:opacity-100 transition-all`}
                  title="Resize canvas"
                >
                  <svg
                    className="w-6 h-6 rotate-45 transform"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="16" y1="21" x2="21" y2="16" />
                    <line x1="11" y1="21" x2="21" y2="11" />
                  </svg>
                </div>
              </div>
            </main>
        </div>
      </div>
    </div>
  );
};

const SortableWrapper = React.forwardRef<HTMLDivElement, { id: string, children: React.ReactElement }>(
  ({ id, children }, ref) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging
    } = useSortable({ id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 50 : undefined,
      position: 'relative' as const
    };

    return (
      <motion.div
        ref={(el: HTMLDivElement | null) => {
          setNodeRef(el);
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        style={style}
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      >
        {React.cloneElement(children as React.ReactElement<any>, {
          isDragging,
          dragHandleProps: { ...attributes, ...listeners }
        })}
      </motion.div>
    );
  }
);

const HeaderIcon = ({ icon, title, onClick }: { icon: React.ReactNode, title: string, onClick?: () => void }) => (
    <button
      onClick={onClick}
      className={`p-2.5 rounded-xl transition-all active:scale-95 hover:bg-[var(--notebook-hover)] text-[var(--notebook-muted)] hover:text-[var(--notebook-text)]`}
      title={title}
      aria-label={title}
    >
        {icon}
    </button>
);

export default Notes;
