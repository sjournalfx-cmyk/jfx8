import React, { useState, useRef, useEffect } from 'react';
import CreateArea from './CreateArea';
import NoteCard from './NoteCard';
import NoteEditor from './NoteEditor';
import { Note as KeepNote, NoteColor, SidebarSection } from './types';
import { Note as AppNote, UserProfile } from '../../../types';
import { dataService } from '../../../services/dataService';
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
import { useToast, type ToastType } from '../../ui/Toast';

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
  /** Receives the rows a batched reorder actually persisted, with their new
   *  `updated_at`, so App can refresh its optimistic-concurrency cache instead
   *  of leaving the next edit looking "changed elsewhere". */
  onReorderNotes?: (rows: { id: string; position: number; updatedAt?: string }[]) => void;
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
  onReorderNotes,
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
    updatedAt: new Date(n.updatedAt || (n as any).updated_at || (n as any).created_at || n.date).getTime(),
    serverUpdatedAt: (n as any).updatedAt || (n as any).updated_at || undefined,
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
      // Preserve the server revision so the guarded update does not mistake
      // this edit for a stale write.
      updatedAt: updatedNote.serverUpdatedAt,
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
      pushToast('error', 'Update failed', error instanceof Error ? error.message : 'Your changes could not be saved.');
      throw error;
    }
  };

  const handlePinNote = (e: React.MouseEvent, note: KeepNote) => {
    e.stopPropagation();
    void handleUpdateKeepNote({ ...note, isPinned: !note.isPinned }).catch(() => undefined);
  };

  const handleArchiveNote = (e: React.MouseEvent, note: KeepNote) => {
    e.stopPropagation();
    void handleUpdateKeepNote({ ...note, isArchived: !note.isArchived }).catch(() => undefined);
  };

  const trashNote = async (note: KeepNote) => {
    if (isDemoMode) {
      blockDemoAction('Cannot delete note');
      return;
    }
    try {
      await handleUpdateKeepNote({ ...note, isTrashed: true });
      if (selectedNoteId === note.id) setSelectedNoteId(null);
      pushToast('success', 'Note deleted', `"${note.title || 'Untitled'}" moved to trash.`, {
        label: 'Undo',
        onClick: () => void restoreNote(note),
      });
    } catch (error) {
      console.error('Failed to delete note', error);
      pushToast('error', 'Delete failed', error instanceof Error ? error.message : 'An error occurred while deleting the note.');
    }
  };

  const restoreNote = async (note: KeepNote) => {
    if (isDemoMode) {
      blockDemoAction('Cannot restore note');
      return;
    }
    try {
      await handleUpdateKeepNote({ ...note, isTrashed: false });
      pushToast('success', 'Note restored', `"${note.title || 'Untitled'}" is back in your library.`);
    } catch (error) {
      console.error('Failed to restore note', error);
      pushToast('error', 'Restore failed', error instanceof Error ? error.message : 'The note could not be restored.');
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

    // Pinned and unpinned notes are sorted independently, so only the dragged
    // group needs renumbering. Renumbering both doubled the writes and left the
    // group that did not move without a matching rollback.
    const categoryList = isPinnedList ? allPinnedNotes : allOtherNotes;
    const movedVisible = arrayMove(list, oldIndex, newIndex);
    const ordered = [...movedVisible, ...categoryList.slice(list.length)];
    const updates = ordered.map((n, i) => ({ id: n.id, position: i }));
    const previousPositions = categoryList.map(n => ({ id: n.id, position: n.position ?? 0 }));

    reorderBusyRef.current = true;
    try {
      // One batched write instead of a full-row update per note.
      const saved = await dataService.updateNotePositions(updates);
      onReorderNotes?.(saved.map(row => ({
        id: row.id,
        position: updates.find(u => u.id === row.id)?.position ?? 0,
        updatedAt: row.updated_at,
      })));
    } catch (error) {
      console.error('Failed to persist note order', error);
      pushToast('error', 'Reorder failed', 'Could not save the new order.');
      try {
        const reverted = await dataService.updateNotePositions(previousPositions);
        onReorderNotes?.(reverted.map(row => ({
          id: row.id,
          position: previousPositions.find(u => u.id === row.id)?.position ?? 0,
          updatedAt: row.updated_at,
        })));
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
      {/* Header — minimal, typography-first (Bear / Apple Notes) */}
      <header
        className="sticky top-0 z-30 shrink-0 border-b backdrop-blur-xl"
        style={{
          backgroundColor: isDarkMode ? 'rgba(8,8,8,0.9)' : 'rgba(255,255,255,0.85)',
          borderColor: 'var(--notebook-divider)'
        }}
      >
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3">
          <div className="flex items-center gap-1">
            <h1 className="text-[15px] font-bold tracking-tight mr-2 hidden sm:block" style={{ color: 'var(--notebook-text)' }}>Notebook</h1>
            {[
              { id: 'NOTES', label: 'All' },
              { id: 'ARCHIVE', label: 'Archive' },
              { id: 'TRASH', label: 'Trash' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  const next = item.id as SidebarSection;
                  setCurrentSection(next);
                  setActiveLabel(null);
                }}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${currentSection === item.id ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'}`}
              >
                {item.label}
              </button>
            ))}
            <button
              onClick={() => setCurrentSection('EDIT_LABELS')}
              className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${currentSection === 'EDIT_LABELS' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'}`}
            >
              Labels
            </button>
          </div>

          <div className="flex-1 flex justify-center max-w-[360px] mx-auto hidden sm:flex">
            <div className="w-full relative flex items-center rounded-full bg-zinc-900 border border-zinc-800 focus-within:border-zinc-700 focus-within:bg-zinc-900 transition-colors">
              <Search className="w-3.5 h-3.5 ml-3 text-zinc-500 shrink-0" />
              <input
                id="notes-search-input"
                name="search"
                aria-label="Search your notes"
                type="text"
                placeholder="Search notes"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent outline-none py-2 pl-2 pr-3 text-[13px] placeholder:text-zinc-500"
                style={{ color: 'var(--notebook-text)' }}
              />
            </div>
          </div>

          <div className="flex items-center gap-1 ml-auto">
            <HeaderIcon icon={<RotateCcw className="w-4 h-4" />} title="Reset view" onClick={handleResetView} />
            <HeaderIcon icon={<Settings className="w-4 h-4" />} title="Settings" onClick={() => onViewChange('settings')} />
          </div>
        </div>
        {/* Mobile search */}
        <div className="px-4 pb-3 sm:hidden">
          <div className="w-full relative flex items-center rounded-full bg-zinc-900 border border-zinc-800">
            <Search className="w-3.5 h-3.5 ml-3 text-zinc-500 shrink-0" />
            <input
              aria-label="Search your notes"
              type="text"
              placeholder="Search notes"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent outline-none py-2 pl-2 pr-3 text-[13px] placeholder:text-zinc-500"
              style={{ color: 'var(--notebook-text)' }}
            />
          </div>
        </div>
      </header>

      {/* Notion-style single column — no split screen */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#050505]">
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 pt-0 pb-24">

          {selectedNote ? (
            /* Full-page editor — like opening a Notion page */
            <div className="animate-in fade-in duration-200 pt-6">
              <button
                onClick={() => setSelectedNoteId(null)}
                className="mb-4 text-[13px] font-medium text-zinc-500 hover:text-zinc-200 flex items-center gap-1.5"
              >
                ← Back to notes
              </button>
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
            <>
              {/* Create — frozen at top while notes scroll underneath */}
              <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 bg-[#050505]/95 backdrop-blur-sm">
                <CreateArea
                  onCreate={handleCreateNote}
                  canvasWidth={canvasWidth}
                  setCanvasWidth={setCanvasWidth}
                />
              </div>

              {/* Label filter — inline chips only when in labels mode */}
              {currentSection === 'EDIT_LABELS' && (
                <div className="flex flex-wrap gap-1.5 mb-6">
                  <button
                    onClick={() => setActiveLabel(null)}
                    className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors ${!activeLabel ? 'bg-white text-black border-white' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                  >
                    All
                  </button>
                  {availableLabels.map(label => (
                    <button
                      key={label}
                      onClick={() => setActiveLabel(label)}
                      className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors ${activeLabel === label ? 'bg-white text-black border-white' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                    >
                      #{label}
                    </button>
                  ))}
                  {availableLabels.length === 0 && (
                    <span className="text-[12px] text-zinc-500 py-1">No labels yet — add one from a note.</span>
                  )}
                </div>
              )}

              {/* Notes — single vertical stack, Notion-like */}
              <div className="space-y-3">
                <AnimatePresence initial={false} mode="popLayout">
                  {visiblePinned.length > 0 && (
                    <motion.div
                      key="pinned"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-3 mb-6"
                    >
                      <h2 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-500">Pinned</h2>
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEndNotes(e, visiblePinned, true)}>
                        <SortableContext items={visiblePinned.map(n => n.id)} strategy={verticalListSortingStrategy}>
                          <div className="space-y-2.5">
                            <AnimatePresence mode="popLayout">
                              {visiblePinned.map(note => (
                                <SortableWrapper key={note.id} id={note.id}>
                                  <NoteCard note={note} onClick={(n) => setSelectedNoteId(n.id)} onPin={handlePinNote} onArchive={handleArchiveNote} onDelete={(e, n) => { e.stopPropagation(); void handleDeleteNote(n); }} onRestore={handleRestoreNote} />
                                </SortableWrapper>
                              ))}
                            </AnimatePresence>
                          </div>
                        </SortableContext>
                      </DndContext>
                    </motion.div>
                  )}

                  {(visiblePinned.length > 0 || visibleOther.length > 0) ? (
                    <motion.div key="others" layout className="space-y-3">
                      {visiblePinned.length > 0 && visibleOther.length > 0 && (
                        <h2 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-500">Others</h2>
                      )}
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEndNotes(e, visibleOther, false)}>
                        <SortableContext items={visibleOther.map(n => n.id)} strategy={verticalListSortingStrategy}>
                          <div className="space-y-2.5">
                            <AnimatePresence mode="popLayout">
                              {visibleOther.map(note => (
                                <SortableWrapper key={note.id} id={note.id}>
                                  <NoteCard note={note} onClick={(n) => setSelectedNoteId(n.id)} onPin={handlePinNote} onArchive={handleArchiveNote} onDelete={(e, n) => { e.stopPropagation(); void handleDeleteNote(n); }} onRestore={handleRestoreNote} />
                                </SortableWrapper>
                              ))}
                            </AnimatePresence>
                          </div>
                        </SortableContext>
                      </DndContext>
                    </motion.div>
                  ) : (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16 text-center">
                      <Lightbulb className="w-12 h-12 mb-3 text-zinc-700" />
                      <p className="text-[13px] font-semibold text-zinc-400">{emptyTitle}</p>
                      <p className="text-[12px] text-zinc-600 mt-1 max-w-sm">{emptyDescription}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {hasMore && <div ref={sentinelRef} className="h-px w-full" />}
                {hasMore && <p className="text-center text-[11px] text-zinc-600 pt-2">Showing {shownCount} of {totalCount}</p>}
              </div>
            </>
          )}
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
      className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors"
      title={title}
      aria-label={title}
    >
        {icon}
    </button>
);

export default Notes;
