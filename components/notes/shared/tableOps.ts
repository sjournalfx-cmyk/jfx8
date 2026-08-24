import { TableData, TableCell, NoteColor } from '../types';
import { MIN_TABLE_ROWS, MIN_TABLE_COLS } from './constants';

type Rows = TableCell[][];

export const createEmptyTable = (): TableData => ({
  rows: [
    [{ text: '' }, { text: '' }],
    [{ text: '' }, { text: '' }],
  ],
});

export function setCellText(rows: Rows, rIdx: number, cIdx: number, text: string): Rows {
  return rows.map((row, i) =>
    i === rIdx ? row.map((cell, j) => (j === cIdx ? { ...cell, text } : cell)) : row
  );
}

export function setCellColor(rows: Rows, rIdx: number, cIdx: number, color: NoteColor | undefined): Rows {
  return rows.map((row, i) =>
    i === rIdx
      ? row.map((cell, j) => {
          if (j !== cIdx) return cell;
          const next = { ...cell };
          if (!color || color === NoteColor.DEFAULT) delete next.color;
          else next.color = color;
          return next;
        })
      : row
  );
}

export function addTableRow(rows: Rows): Rows {
  const colCount = rows[0]?.length ?? 2;
  return [...rows, Array.from({ length: colCount }, () => ({ text: '' }) as TableCell)];
}

export function removeTableRow(rows: Rows, rIdx: number): Rows {
  if (rows.length <= MIN_TABLE_ROWS) return rows;
  return rows.filter((_, i) => i !== rIdx);
}

export function addTableColumn(rows: Rows): Rows {
  return rows.map(row => [...row, { text: '' } as TableCell]);
}

export function removeTableColumn(rows: Rows, cIdx: number): Rows {
  if ((rows[0]?.length ?? 0) <= MIN_TABLE_COLS) return rows;
  return rows.map(row => row.filter((_, j) => j !== cIdx));
}
