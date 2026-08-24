
import React, { useState } from 'react';
import { Pin, Archive, Trash2, RotateCcw, Square, CheckSquare, GripVertical } from 'lucide-react';
import { Note, ColorStyles } from './types';

interface NoteCardProps {
  note: Note;
  onClick: (note: Note) => void;
  onPin: (e: React.MouseEvent, note: Note) => void;
  onArchive: (e: React.MouseEvent, note: Note) => void;
  onDelete?: (e: React.MouseEvent, note: Note) => void;
  onRestore?: (e: React.MouseEvent, note: Note) => void;
  isDragging?: boolean;
  dragHandleProps?: Record<string, any>;
}

const NoteCard: React.FC<NoteCardProps> = ({
  note,
  onClick,
  onPin,
  onArchive,
  onDelete,
  onRestore,
  isDragging,
  dragHandleProps,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const renderContent = () => {
    if (note.isList && note.listItems && note.listItems.length > 0) {
      const maxItems = 4;
      const visibleItems = note.listItems.slice(0, maxItems);
      const remaining = note.listItems.length - maxItems;

      return (
        <div className="flex flex-col gap-0.5 mt-1 pointer-events-none">
          {visibleItems.map(item => (
            <div 
                key={item.id} 
                className="flex items-start gap-1.5 py-0.5"
                style={{ marginLeft: item.indentLevel ? `${item.indentLevel * 1}rem` : '0px' }}
            >
              <div className="mt-0.5 text-[var(--notebook-muted)] shrink-0">
                {item.checked ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              </div>
              <span className={`text-[0.8rem] leading-tight break-words line-clamp-2 ${item.checked ? 'line-through text-[var(--notebook-muted)] opacity-60' : 'text-[var(--notebook-text)]'}`}>
                {item.text}
              </span>
            </div>
          ))}
          {remaining > 0 && (
            <div className="text-[var(--notebook-muted)] text-[0.7rem] mt-0.5 pl-5">
              + {remaining} more items
            </div>
          )}
        </div>
      );
    }

    if (note.tableData && note.tableData.rows.length > 0) {
      const maxRows = 3;
      const visibleRows = note.tableData.rows.slice(0, maxRows);
      
      return (
        <div className="mt-2 overflow-hidden border border-[var(--notebook-divider)] rounded text-[0.7rem] pointer-events-none">
          <table className="w-full border-collapse">
            <tbody>
              {visibleRows.map((row, i) => (
                <tr key={i} className="border-b border-[var(--notebook-divider)] last:border-0">
                  {row.slice(0, 3).map((cell, j) => {
                    const cellData = typeof cell === 'string' ? { text: cell } : cell;
                    return (
                      <td key={j} className={`p-1 border-r border-[var(--notebook-divider)] last:border-0 truncate max-w-[60px] text-[var(--notebook-text)] opacity-80 ${cellData.color ? ColorStyles[cellData.color] : ''}`}>
                        {cellData.text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {note.tableData.rows.length > maxRows && (
            <div className="text-[0.6rem] text-[var(--notebook-muted)] p-1 text-center bg-black/5">... more rows</div>
          )}
        </div>
      );
    }

    return (
      <div className="text-[var(--notebook-text)] text-[0.8rem] leading-normal whitespace-pre-wrap break-words opacity-85 line-clamp-5 pointer-events-none">
          {note.content}
      </div>
    );
  };

  return (
    <div
      className={`relative rounded-xl border transition-all duration-200 ease-out group overflow-hidden
        ${ColorStyles[note.color]} 
        ${note.color === 'DEFAULT' ? 'border-[var(--notebook-divider)]' : 'border-transparent'}
        ${isDragging ? 'opacity-40 grayscale-[0.5]' : 'opacity-100'}
        hover:border-[var(--notebook-text)]/30 hover:shadow-lg
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onClick(note)}
    >
      {!note.isTrashed && (
        <button
          {...(dragHandleProps || {})}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-10 z-10 p-1 rounded-full text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] hover:bg-[var(--notebook-hover)] transition-all duration-150 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing"
          title="Drag to reorder"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}
      {note.image && (
          <div className="w-full h-auto max-h-48 overflow-hidden border-b border-white/5 pointer-events-none">
              <img src={note.image} alt="Note attachment" className="w-full object-cover" />
          </div>
      )}
      <div className="p-3 pb-2">
        <div className="flex justify-between items-start mb-1.5 pointer-events-none">
          {note.title ? (
            <h3 className="text-[var(--notebook-text)] font-medium text-[0.95rem] leading-snug break-words w-[85%]">
              {note.title}
            </h3>
          ) : (
             <div className="h-4 w-full"></div> 
          )}
          {!note.isTrashed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPin(e, note);
              }}
              className={`text-[var(--notebook-text)] p-1.5 -mr-1 -mt-1 rounded-full hover:bg-[var(--notebook-hover)] transition-all duration-150 pointer-events-auto ${isHovered || note.isPinned ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}
              title={note.isPinned ? "Unpin note" : "Pin note"}
              aria-label={note.isPinned ? "Unpin note" : "Pin note"}
            >
              <Pin className={`w-4 h-4 ${note.isPinned ? 'fill-current' : ''}`} />
            </button>
          )}
        </div>

        {renderContent()}

        {note.labels && note.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3 pointer-events-none">
            {note.labels.map((label) => (
              <span key={label} className="bg-black/20 text-[var(--notebook-text)] text-[0.6rem] px-1.5 py-0.5 rounded-full font-medium">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={`h-[32px] flex items-center justify-between px-2 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
         <div className="flex items-center gap-1">
             {note.isTrashed ? (
               <>
                 <ToolbarButton 
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete?.(e, note);
                    }}
                    icon={<Trash2 className="w-3 h-3" />} 
                    title="Delete forever" 
                 />
                 <ToolbarButton 
                    onClick={(e) => {
                      e.stopPropagation();
                      onRestore?.(e, note);
                    }}
                    icon={<RotateCcw className="w-3 h-3" />} 
                    title="Restore" 
                 />
               </>
             ) : (
               <>
                 <ToolbarButton 
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchive(e, note);
                    }}
                    icon={<Archive className="w-3 h-3" />} 
                    title={note.isArchived ? "Unarchive" : "Archive"} 
                 />
                 <ToolbarButton 
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete?.(e, note);
                    }}
                    icon={<Trash2 className="w-3 h-3" />} 
                    title="Delete" 
                 />
               </>
             )}
         </div>
      </div>
    </div>
  );
};

const ToolbarButton = ({ icon, title, onClick }: { icon: React.ReactNode, title: string, onClick?: (e: React.MouseEvent) => void }) => (
    <button 
        onClick={(e) => {
            e.stopPropagation();
            if(onClick) onClick(e);
        }}
        className="w-6 h-6 flex items-center justify-center rounded-full text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] hover:bg-[var(--notebook-hover)] transition-colors" 
        title={title}
        aria-label={title}
    >
        {icon}
    </button>
)

export default React.memo(NoteCard, (prevProps, nextProps) =>
  prevProps.note === nextProps.note &&
  prevProps.isDragging === nextProps.isDragging
);
