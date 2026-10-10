import React from 'react';
import { GripVertical, X } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ListItem } from '../types';
import { genId } from './constants';

interface SortableListItemProps {
  item: ListItem;
  onChangeItems: (updater: (prev: ListItem[]) => ListItem[]) => void;
  onRemove: () => void;
  readOnly?: boolean;
}

const SortableListItem: React.FC<SortableListItemProps> = React.memo(({ item, onChangeItems, onRemove, readOnly }) => {
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
    opacity: isDragging ? 0.4 : 1,
    marginLeft: `${(item.indentLevel || 0) * 1}rem`,
  };

  const patchItem = (patch: Partial<ListItem>) => {
    if (readOnly) return;
    onChangeItems(prev => prev.map(i => (i.id === item.id ? { ...i, ...patch } : i)));
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 group/list-item"
    >
      {readOnly ? (
        <span className="w-4 shrink-0" aria-hidden="true" />
      ) : (
        <button
          type="button"
          // Drag is started from the handle only: listeners on the row would
          // hijack text selection inside the item input.
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab active:cursor-grabbing text-[var(--notebook-muted)] opacity-0 group-hover/list-item:opacity-100 pointer-coarse:opacity-100 transition-opacity"
          aria-label={`Reorder "${item.text || 'item'}"`}
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => patchItem({ checked: !item.checked })}
        disabled={readOnly}
        className={`p-1 shrink-0 ${readOnly ? 'cursor-default' : ''}`}
        aria-label={item.checked ? `Mark "${item.text || 'item'}" as not done` : `Mark "${item.text || 'item'}" as done`}
      >
        <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} className="pointer-events-none accent-[#FF4F00] w-3.5 h-3.5" />
      </button>
      <input
        value={item.text}
        readOnly={readOnly}
        disabled={readOnly}
        aria-label="Checklist item"
        onChange={(e) => patchItem({ text: e.target.value })}
        placeholder="List item..."
        className={`bg-transparent outline-none flex-1 text-base min-w-0 ${item.checked ? 'text-[var(--notebook-muted)] line-through' : 'text-[var(--notebook-text)]'} placeholder-[var(--notebook-placeholder)]`}
      />
      {!readOnly && (
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] opacity-0 group-hover/list-item:opacity-100 pointer-coarse:opacity-100 transition-opacity"
          aria-label="Remove checklist item"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
});
SortableListItem.displayName = 'SortableListItem';

interface ListEditorProps {
  items: ListItem[];
  onChange: (items: ListItem[]) => void;
  readOnly?: boolean;
}

export const ListEditor: React.FC<ListEditorProps> = ({ items, onChange, readOnly }) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex(i => i.id === active.id);
      const newIndex = items.findIndex(i => i.id === over.id);
      onChange(arrayMove(items, oldIndex, newIndex));
    }
  };

  const updateItems = (updater: (prev: ListItem[]) => ListItem[]) => onChange(updater(items));

  return (
    <div className="flex flex-col gap-1" role="list" aria-label="Checklist">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableListItem
              key={item.id}
              item={item}
              onChangeItems={updateItems}
              onRemove={() => updateItems(prev => prev.filter(i => i.id !== item.id))}
              readOnly={readOnly}
            />
          ))}
        </SortableContext>
      </DndContext>
      {!readOnly && (
        <button
          type="button"
          onClick={() => onChange([...items, { id: genId(), text: '', checked: false, indentLevel: 0 }])}
          className="mt-1 self-start px-2 py-1 text-xs rounded-lg text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] hover:bg-[var(--notebook-hover)] transition-colors"
          aria-label="Add checklist item"
        >
          + Add item
        </button>
      )}
    </div>
  );
};

export default ListEditor;
