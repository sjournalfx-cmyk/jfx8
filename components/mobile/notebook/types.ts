
export interface ListItem {
  id: string;
  text: string;
  checked: boolean;
  indentLevel?: number;
}

export interface TableCell {
  text: string;
  color?: NoteColor;
}

export interface TableData {
  rows: TableCell[][];
}

export interface Note {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  color: NoteColor;
  labels: string[];
  createdAt: number;
  updatedAt: number;
  /** Server revision (ISO timestamp) for stale-write protection. Carried
   * alongside the ms display value and sent back on updates. */
  serverUpdatedAt?: string;
  isList?: boolean;
  listItems?: ListItem[];
  image?: string; // Base64 or URL
  tableData?: TableData;
  position?: number;
}

export enum NoteColor {
  DEFAULT = 'DEFAULT',
  RED = 'RED',
  ORANGE = 'ORANGE',
  YELLOW = 'YELLOW',
  GREEN = 'GREEN',
  TEAL = 'TEAL',
  BLUE = 'BLUE',
  DARK_BLUE = 'DARK_BLUE',
  PURPLE = 'PURPLE',
  PINK = 'PINK',
  BROWN = 'BROWN',
  GRAY = 'GRAY',
}

export const ColorStyles: Record<NoteColor, string> = {
  [NoteColor.DEFAULT]: 'bg-[var(--note-default-bg)] border-[var(--note-default-border)]',
  [NoteColor.RED]: 'bg-[var(--note-red-bg)] border-[var(--note-red-border)]',
  [NoteColor.ORANGE]: 'bg-[var(--note-orange-bg)] border-[var(--note-orange-border)]',
  [NoteColor.YELLOW]: 'bg-[var(--note-yellow-bg)] border-[var(--note-yellow-border)]',
  [NoteColor.GREEN]: 'bg-[var(--note-green-bg)] border-[var(--note-green-border)]',
  [NoteColor.TEAL]: 'bg-[var(--note-teal-bg)] border-[var(--note-teal-border)]',
  [NoteColor.BLUE]: 'bg-[var(--note-blue-bg)] border-[var(--note-blue-border)]',
  [NoteColor.DARK_BLUE]: 'bg-[var(--note-dark-blue-bg)] border-[var(--note-dark-blue-border)]',
  [NoteColor.PURPLE]: 'bg-[var(--note-purple-bg)] border-[var(--note-purple-border)]',
  [NoteColor.PINK]: 'bg-[var(--note-pink-bg)] border-[var(--note-pink-border)]',
  [NoteColor.BROWN]: 'bg-[var(--note-brown-bg)] border-[var(--note-brown-border)]',
  [NoteColor.GRAY]: 'bg-[var(--note-gray-bg)] border-[var(--note-gray-border)]',
};

export type SidebarSection = 'NOTES' | 'EDIT_LABELS' | 'ARCHIVE' | 'TRASH';
