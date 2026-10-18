import React, { useRef, useState } from 'react';
import { Palette, PlusSquare, MinusSquare, Trash2 } from 'lucide-react';
import { TableData, NoteColor, ColorStyles } from '../types';
import {
  setCellText,
  setCellColor,
  addTableRow,
  removeTableRow,
  addTableColumn,
  removeTableColumn,
} from './tableOps';
import { usePopoverDismiss } from './usePopoverDismiss';

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

interface TableEditorProps {
  tableData: TableData;
  onChange: (next: TableData | undefined) => void;
  readOnly?: boolean;
}

/**
 * Shared table editor with immutable updates (safe undo history),
 * a properly dismissible cell-color popover and read-only mode.
 */
export const TableEditor: React.FC<TableEditorProps> = ({ tableData, onChange, readOnly }) => {
  const rows = tableData.rows;
  const cellPickerRef = useRef<HTMLDivElement | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ rIdx: number; cIdx: number } | null>(null);
  const [showCellColorOptions, setShowCellColorOptions] = useState(false);

  const pickerOpen = showCellColorOptions && focusedCell !== null;
  usePopoverDismiss([cellPickerRef], () => setShowCellColorOptions(false), pickerOpen, { closeOnEscape: false });

  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && showCellColorOptions) {
      e.stopPropagation();
      setShowCellColorOptions(false);
    }
  };

  const openCellPicker = (rIdx: number, cIdx: number) => {
    setFocusedCell({ rIdx, cIdx });
    setShowCellColorOptions(true);
  };

  const applyCellText = (rIdx: number, cIdx: number, text: string) => {
    onChange({ rows: setCellText(rows, rIdx, cIdx, text) });
  };

  const applyCellColor = (rIdx: number, cIdx: number, color: NoteColor) => {
    onChange({ rows: setCellColor(rows, rIdx, cIdx, color) });
  };

  return (
    <div className="overflow-x-auto custom-scrollbar pb-4" onKeyDown={handleContainerKeyDown}>
      <table className="w-full border-collapse border border-[var(--notebook-divider)] text-base">
        <tbody>
          {rows.map((row, rIdx) => (
            <tr key={rIdx}>
              {row.map((cell, cIdx) => (
                <td
                  key={cIdx}
                  className={`border border-[var(--notebook-divider)] p-0 relative group/cell align-top transition-colors duration-200 ${cell.color ? ColorStyles[cell.color] : ''}`}
                >
                  <textarea
                    aria-label={`Table cell row ${rIdx + 1} column ${cIdx + 1}`}
                    value={cell.text}
                    rows={1}
                    readOnly={readOnly}
                    onFocus={() => setFocusedCell({ rIdx, cIdx })}
                    onChange={(e) => {
                      applyCellText(rIdx, cIdx, e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${e.target.scrollHeight}px`;
                    }}
                    ref={(el) => {
                      if (el && el.style.height === '') {
                        el.style.height = `${el.scrollHeight}px`;
                      }
                    }}
                    className="w-full bg-transparent p-3 outline-none text-[var(--notebook-text)] placeholder-[var(--notebook-placeholder)] resize-none overflow-hidden block"
                    placeholder={rIdx === 0 && cIdx === 0 ? 'Cell...' : ''}
                  />
                  {!readOnly && (
                    <>
                      <div className="absolute top-1 right-1 opacity-0 group-cell/hover:opacity-100 flex gap-1 z-10">
                        <button
                          type="button"
                          onClick={() => {
                            if (pickerOpen && focusedCell?.rIdx === rIdx && focusedCell?.cIdx === cIdx) {
                              setShowCellColorOptions(false);
                            } else {
                              openCellPicker(rIdx, cIdx);
                            }
                          }}
                          className={`p-1 bg-[var(--note-default-bg)]/80 rounded-full shadow-sm transition-colors ${pickerOpen && focusedCell?.rIdx === rIdx && focusedCell?.cIdx === cIdx ? 'text-[var(--notebook-text)]' : 'text-[var(--notebook-muted)] hover:text-[var(--notebook-text)]'}`}
                          title="Cell color"
                          aria-label={`Change color of cell row ${rIdx + 1} column ${cIdx + 1}`}
                        >
                          <Palette className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {rIdx === 0 && rows[0].length > 1 && (
                        <button
                          type="button"
                          onClick={() => onChange({ rows: removeTableColumn(rows, cIdx) })}
                          className="absolute -top-3 left-1/2 -translate-x-1/2 opacity-0 group-cell/hover:opacity-100 text-[var(--notebook-muted)] hover:text-red-400 z-10 bg-[var(--note-default-bg)] rounded-full transition-opacity"
                          title={`Remove column ${cIdx + 1}`}
                          aria-label={`Remove column ${cIdx + 1}`}
                        >
                          <MinusSquare className="w-4 h-4" />
                        </button>
                      )}
                      {cIdx === 0 && rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onChange({ rows: removeTableRow(rows, rIdx) })}
                          className="absolute top-1/2 -left-4 -translate-y-1/2 opacity-0 group-cell/hover:opacity-100 text-[var(--notebook-muted)] hover:text-red-400 z-10 bg-[var(--note-default-bg)] rounded-full transition-opacity"
                          title={`Remove row ${rIdx + 1}`}
                          aria-label={`Remove row ${rIdx + 1}`}
                        >
                          <MinusSquare className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  )}
                  {pickerOpen && focusedCell?.rIdx === rIdx && focusedCell?.cIdx === cIdx && (
                    <div
                      ref={cellPickerRef}
                      role="menu"
                      aria-label="Cell color options"
                      className="absolute top-full right-0 mt-1 p-2 bg-[var(--note-default-bg)] border border-[var(--notebook-divider)] rounded-lg shadow-2xl grid grid-cols-6 gap-1 z-[60] min-w-[180px]"
                    >
                      {Object.values(NoteColor).map((c) => (
                        <button
                          key={c}
                          type="button"
                          title={COLOR_LABELS[c]}
                          aria-label={`${COLOR_LABELS[c]} cell color`}
                          className={`w-6 h-6 rounded-full border transition-all ${ColorStyles[c].split(' ')[0]} ${cell.color === c ? 'ring-2 ring-white scale-110' : 'hover:scale-110'}`}
                          onClick={() => {
                            applyCellColor(rIdx, cIdx, c);
                            setShowCellColorOptions(false);
                          }}
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
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={() => onChange({ rows: addTableRow(rows) })} className="flex items-center gap-1.5 text-xs text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-3 py-1.5 rounded transition-colors"><PlusSquare className="w-4 h-4" /> Add Row</button>
          <button type="button" onClick={() => onChange({ rows: addTableColumn(rows) })} className="flex items-center gap-1.5 text-xs text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-3 py-1.5 rounded transition-colors"><PlusSquare className="w-4 h-4" /> Add Column</button>
          <button
            type="button"
            onClick={() => onChange({ rows: removeTableRow(rows, rows.length - 1) })}
            disabled={rows.length <= 1}
            className="disabled:opacity-35 disabled:cursor-not-allowed flex items-center gap-1.5 text-xs text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-3 py-1.5 rounded transition-colors"
          ><MinusSquare className="w-4 h-4" /> Remove Row</button>
          <button
            type="button"
            onClick={() => onChange({ rows: removeTableColumn(rows, rows[0].length - 1) })}
            disabled={(rows[0]?.length ?? 0) <= 1}
            className="disabled:opacity-35 disabled:cursor-not-allowed flex items-center gap-1.5 text-xs text-[var(--notebook-muted)] hover:text-[var(--notebook-text)] bg-[var(--notebook-hover)] px-3 py-1.5 rounded transition-colors"
          ><MinusSquare className="w-4 h-4" /> Remove Column</button>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 ml-auto px-3 py-1.5 rounded bg-red-400/5 transition-colors"
          ><Trash2 className="w-4 h-4" /> Remove Table</button>
        </div>
      )}
    </div>
  );
};

export default TableEditor;
