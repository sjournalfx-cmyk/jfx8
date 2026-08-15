import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, ReactNodeViewRenderer, Node as TiptapNode } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Underline } from '@tiptap/extension-underline';
import { Link as TiptapLink } from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import BubbleMenuExtension from '@tiptap/extension-bubble-menu';
import {
  Bold, Italic, Underline as UnderlineIcon, List,
  ListChecks, Table as TableIcon, Eraser, Type,
  Plus, Trash2, PlusCircle, ArrowUp, ArrowDown,
  ArrowLeft, ArrowRight, Combine, Split, GripHorizontal,
  Palette, Image as ImageIcon, MousePointer2, AlignLeft,
  AlignCenter, AlignRight, Maximize2
} from 'lucide-react';
import ConfirmationModal from './ConfirmationModal';
import ImageNode from './RichTextEditorImage';
import FloatingTextNode from './RichTextEditorFloatingText';

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  isDarkMode: boolean;
  minHeight?: string;
  className?: string;
  customToolbarItems?: React.ReactNode;
  showTooltips?: boolean;
  showToolbar?: boolean;
  onImageUpload?: (file: File) => Promise<string | null>;
}

const TEXT_COLORS = [
  { name: 'Indigo', color: '#6366f1' },
  { name: 'Emerald', color: '#10b981' },
  { name: 'Amber', color: '#f59e0b' },
];

const CELL_COLORS = [
  { name: 'None', color: 'transparent' },
  { name: 'Indigo', color: 'rgba(99, 102, 241, 0.15)' },
  { name: 'Emerald', color: 'rgba(16, 185, 129, 0.15)' },
  { name: 'Amber', color: 'rgba(245, 158, 11, 0.15)' },
  { name: 'Rose', color: 'rgba(244, 63, 94, 0.15)' },
  { name: 'Slate', color: 'rgba(71, 85, 105, 0.15)' },
];

const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: element => element.getAttribute('data-background-color') || element.style.backgroundColor || null,
        renderHTML: attributes => {
          if (!attributes.backgroundColor) {
            return {}
          }
          return {
            'data-background-color': attributes.backgroundColor,
            style: `background-color: ${attributes.backgroundColor}`,
          }
        },
      },
      textAlign: {
        default: null,
        parseHTML: element => element.getAttribute('data-text-align') || element.style.textAlign || null,
        renderHTML: attributes => {
          if (!attributes.textAlign) {
            return {}
          }
          return {
            'data-text-align': attributes.textAlign,
            style: `text-align: ${attributes.textAlign}`,
          }
        },
      },
      minWidth: {
        default: '120px',
        parseHTML: element => element.getAttribute('data-min-width') || element.style.minWidth || '120px',
        renderHTML: attributes => ({
          'data-min-width': attributes.minWidth,
          style: `min-width: ${attributes.minWidth}`,
        }),
      },
    }
  },
});

const CustomImage = Image.extend({
  draggable: true,
  addNodeView() {
    return ReactNodeViewRenderer(ImageNode);
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: '200px',
        renderHTML: attributes => ({
          width: attributes.width,
        }),
      },
      align: {
        default: 'center',
        renderHTML: attributes => ({
          'data-align': attributes.align,
        }),
      },
      hasBorder: {
        default: false,
        renderHTML: attributes => ({
          'data-border': attributes.hasBorder,
        }),
      },
      layout: {
        default: 'block',
        renderHTML: attributes => ({
          'data-layout': attributes.layout,
        }),
      },
      caption: {
        default: '',
        renderHTML: attributes => ({
          'data-caption': attributes.caption,
        }),
      },
      borderColor: {
        default: 'auto',
        renderHTML: attributes => ({
          'data-border-color': attributes.borderColor,
        }),
      },
      x: {
        default: 0,
        renderHTML: attributes => ({
          'data-x': attributes.x,
        }),
      },
      y: {
        default: 0,
        renderHTML: attributes => ({
          'data-y': attributes.y,
        }),
      },
    };
  },
});

const FloatingText = TiptapNode.create({
  name: 'floatingText',
  group: 'block',
  content: 'inline*',
  draggable: true,
  selectable: true,
  atom: false,

  addAttributes() {
    return {
      x: { default: 0 },
      y: { default: 0 },
      width: { default: '250px' },
      color: { default: 'transparent' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="floating-text"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-type': 'floating-text', ...HTMLAttributes }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FloatingTextNode);
  },

  addCommands() {
    return {
      insertFloatingText: (attributes: any) => ({ commands }: { commands: any }) => {
        return commands.insertContent({
          type: this.name,
          attrs: attributes,
        });
      },
    } as any;
  },
});

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  content,
  onChange,
  placeholder = 'Start typing...',
  isDarkMode,
  minHeight = '150px',
  className = '',
  customToolbarItems,
  showTooltips = true,
  showToolbar = false,
  onImageUpload
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);

  // Update ref when onChange changes
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
        underline: false,
        // Link is included in StarterKit
        link: {
          openOnClick: false,
          HTMLAttributes: {
            class: 'text-indigo-500 underline cursor-pointer',
          },
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      CustomTableCell,
      TextStyle,
      Color,
      Underline,
      Placeholder.configure({ placeholder }),
      CustomImage.configure({
        inline: true,
        allowBase64: true,
      }),
      FloatingText,
    ],
    content: content,
    onUpdate: ({ editor }) => {
      // Use ref to avoid stale closure without editor re-mount
      onChangeRef.current(editor.getHTML());
    },
  });

  const editorRef = React.useRef<HTMLDivElement>(null);
  const [tableInfo, setTableInfo] = React.useState<{ rect: DOMRect, element: HTMLElement } | null>(null);
  const [menuOffset, setMenuOffset] = React.useState({ x: 0, y: 0 });
  const tableInfoRef = React.useRef<{ rect: DOMRect, element: HTMLElement } | null>(null);
  const menuOffsetRef = React.useRef({ x: 0, y: 0 });
  const isManuallyMoved = React.useRef(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStartPos = React.useRef({ x: 0, y: 0 });

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = React.useState<{
    isOpen: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: () => { },
  });

  const openConfirm = (title: string, description: string, onConfirm: () => void, variant: 'danger' | 'warning' | 'info' = 'danger') => {
    setConfirmModal({ isOpen: true, title, description, onConfirm, variant });
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0 && editor) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (onImageUpload) {
          // Use provided upload handler
          const url = await onImageUpload(file);
          if (url) {
            editor.chain().focus().setImage({ src: url }).run();
          }
        } else {
          // Fallback to Base64
          const reader = new FileReader();
          reader.onload = (e) => {
            const result = e.target?.result as string;
            editor.chain().focus().setImage({ src: result }).run();
          };
          reader.readAsDataURL(file);
        }
      }
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Sync content if it changes externally
  useEffect(() => {
    // Only set content if it's different and the editor isn't focused
    // AND it's not a normalization-only change (like empty string vs <p></p>)
    if (editor && !editor.isFocused) {
      const currentHTML = editor.getHTML();
      if (content !== currentHTML && !(content === '' && currentHTML === '<p></p>')) {
        editor.commands.setContent(content, { emitUpdate: false });
      }
    }
  }, [content, editor]);

  // Track active table for UI buttons
  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const { selection } = editor.state;
      let dom = editor.view.domAtPos(selection.from).node;

      // Handle the case where dom is a text node
      if (dom.nodeType === Node.TEXT_NODE) {
        dom = dom.parentNode!;
      }

      let foundTable = false;
      let current = dom as HTMLElement;
      while (current && current !== editor.view.dom) {
        if (current.tagName === 'TABLE') {
          const rect = current.getBoundingClientRect();
          const containerRect = editorRef.current?.getBoundingClientRect();
          const nextTableInfo = {
            rect,
            element: current
          };

          if (tableInfoRef.current?.element !== current) {
            tableInfoRef.current = nextTableInfo;
            setTableInfo(nextTableInfo);
          } else {
            tableInfoRef.current = nextTableInfo;
          }

          // Set initial menu position or follow table if not manually moved
          if (containerRect && (!isManuallyMoved.current || (menuOffsetRef.current.x === 0 && menuOffsetRef.current.y === 0))) {
            const newPos = {
              x: Math.max(20, rect.left - containerRect.left),
              y: Math.max(20, rect.top - containerRect.top - 120)
            };
            if (menuOffsetRef.current.x !== newPos.x || menuOffsetRef.current.y !== newPos.y) {
              menuOffsetRef.current = newPos;
              setMenuOffset(newPos);
            }
          }

          foundTable = true;
          break;
        }
        current = current.parentElement!;
      }
      if (!foundTable) {
        if (tableInfoRef.current !== null) {
          tableInfoRef.current = null;
          setTableInfo(null);
        }
        // Reset menu offset when table is lost so it re-centers next time
        const resetPos = { x: 0, y: 0 };
        if (menuOffsetRef.current.x !== 0 || menuOffsetRef.current.y !== 0) {
          menuOffsetRef.current = resetPos;
          setMenuOffset(resetPos);
        }
        isManuallyMoved.current = false;
      }
    };

    editor.on('selectionUpdate', update);
    editor.on('transaction', update);

    const container = editorRef.current;
    if (container) {
      container.addEventListener('scroll', update, true);
    }
    window.addEventListener('resize', update);

    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      if (container) {
        container.removeEventListener('scroll', update, true);
      }
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  // Drag logic for Bubble Menu
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newPos = {
          x: e.clientX - dragStartPos.current.x,
          y: e.clientY - dragStartPos.current.y,
        };
        menuOffsetRef.current = newPos;
        setMenuOffset(newPos);
        isManuallyMoved.current = true;
      }
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!editor) return;
    
    // Check if double click was on the canvas background, not inside an existing node
    const target = e.target as HTMLElement;
    if (target.classList.contains('ProseMirror')) {
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Insert floating text at double-click coordinates
      (editor.commands as any).insertFloatingText({ x, y });
    }
  };

  if (!editor) return null;

  return (
    <div
      ref={editorRef}
      className={`flex flex-col rounded-xl border transition-all relative ${isDarkMode ? 'bg-[#000000] border-[#27272a] focus-within:border-indigo-500/50' : 'bg-white border-slate-200 focus-within:border-indigo-500'} ${className}`}
    >
      {showToolbar && (
        <div className={`flex flex-wrap items-center gap-0.5 p-1 border-b transition-colors rounded-t-xl ${isDarkMode ? 'border-[#27272a] bg-black/50' : 'border-slate-200 bg-slate-50/50'}`}>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            icon={Bold}
            title="Bold"
            showTooltip={showTooltips}
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            icon={Italic}
            title="Italic"
            showTooltip={showTooltips}
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive('underline')}
            icon={UnderlineIcon}
            title="Underline"
            showTooltip={showTooltips}
          />

          <ToolbarDivider />

          <div className="flex items-center gap-1 mx-1 px-1 border-x border-zinc-500/20">
            {TEXT_COLORS.map(c => (
              <button
                key={c.name}
                type="button"
                onClick={() => editor.chain().focus().setColor(c.color).run()}
                className={`w-5 h-5 rounded-full border border-black/10 transition-transform hover:scale-125 ${editor.isActive('textStyle', { color: c.color }) ? 'ring-2 ring-offset-1 ring-indigo-500' : ''}`}
                title={c.name}
                style={{ backgroundColor: c.color }}
              />
            ))}
            <ToolbarButton
              onClick={() => editor.chain().focus().unsetColor().run()}
              icon={Type}
              title="Reset Color"
              className="opacity-60"
              showTooltip={showTooltips}
            />
          </div>

          <ToolbarDivider />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive('bulletList')}
            icon={List}
            title="Bullet List"
            showTooltip={showTooltips}
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            isActive={editor.isActive('taskList')}
            icon={ListChecks}
            title="Checklist"
            showTooltip={showTooltips}
          />

          <ToolbarDivider />

          <ToolbarButton
            onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 3, withHeaderRow: false }).run()}
            icon={TableIcon}
            title="Insert Table (2×3)"
            showTooltip={showTooltips}
          />
          
          <ToolbarButton
            onClick={handleImageClick}
            icon={ImageIcon}
            title="Insert Image"
            showTooltip={showTooltips}
          />

          <ToolbarButton
            onClick={() => (editor.commands as any).insertFloatingText({ x: 50, y: 50 })}
            icon={MousePointer2}
            title="Add Floating Text Box"
            showTooltip={showTooltips}
          />

          {customToolbarItems && (
            <>
              <ToolbarDivider />
              {customToolbarItems}
            </>
          )}

          <div className="flex-1" />

          <ToolbarButton
            onClick={() => {
              openConfirm(
                'Clear Content',
                'Are you sure you want to clear all content? This action cannot be undone.',
                () => editor.commands.clearContent(),
                'danger'
              );
            }}
            icon={Eraser}
            title="Clear All Content"
            className="text-rose-500 hover:bg-rose-500/10"
            showTooltip={showTooltips}
          />
        </div>
      )}

      {/* Bubble Menu for Text Formatting */}
      {editor && (
        <BubbleMenu
          editor={editor}
          shouldShow={({ editor, state }) => {
            return !editor.isActive('table') && !state.selection.empty;
          }}
          className={`flex items-center gap-0.5 p-1 rounded-xl shadow-xl border ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-white border-slate-200'}`}
        >
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            icon={Bold}
            title="Bold"
            showTooltip={showTooltips}
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            icon={Italic}
            title="Italic"
            showTooltip={showTooltips}
          />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive('underline')}
            icon={UnderlineIcon}
            title="Underline"
            showTooltip={showTooltips}
          />
          <div className="w-px h-4 bg-zinc-500/20 mx-1" />
          <div className="flex items-center gap-1 mx-1">
            {TEXT_COLORS.map(c => (
              <button
                key={c.name}
                type="button"
                onClick={() => editor.chain().focus().setColor(c.color).run()}
                className={`w-4 h-4 rounded-full border border-black/10 transition-transform hover:scale-125 ${editor.isActive('textStyle', { color: c.color }) ? 'ring-2 ring-offset-1 ring-indigo-500' : ''}`}
                title={c.name}
                style={{ backgroundColor: c.color }}
              />
            ))}
          </div>
        </BubbleMenu>
      )}

      {/* Custom Draggable Table Menu */}
      {editor && tableInfo && (
        <div
          className={`absolute z-[100] p-3 rounded-xl shadow-2xl border select-none transition-shadow ${isDarkMode ? 'bg-[#000000] border-[#27272a] shadow-black/50' : 'bg-white border-slate-200 shadow-slate-200/50'}`}
          style={{
            left: menuOffset.x,
            top: menuOffset.y,
            cursor: isDragging ? 'grabbing' : 'default',
          }}
        >
          {/* Drag Handle */}
          <div className="flex items-center justify-between mb-3">
            <div
              className="p-1 cursor-grab active:cursor-grabbing text-zinc-500 hover:text-indigo-500 transition-colors rounded"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDragging(true);
                dragStartPos.current = { x: e.clientX - menuOffset.x, y: e.clientY - menuOffset.y };
              }}
            >
              <GripHorizontal size={14} />
            </div>
            <span className="text-xs font-medium text-zinc-500">Table Tools</span>
          </div>

          {/* Cell Formatting */}
          <div className="mb-4">
            <div className="text-xs text-zinc-500 mb-2 font-medium">Cell Style</div>
            <div className="flex items-center gap-1">
              <Palette size={12} className="text-zinc-500 mr-1" />
              {CELL_COLORS.slice(0, 5).map(c => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => editor.chain().focus().setCellAttribute('backgroundColor', c.color).run()}
                  className={`w-4 h-4 rounded border border-black/10 transition-transform hover:scale-125 ${editor.isActive('tableCell', { backgroundColor: c.color }) ? 'ring-2 ring-offset-1 ring-indigo-500' : ''}`}
                  title={`Cell Color: ${c.name}`}
                  style={{ backgroundColor: c.color === 'transparent' ? (isDarkMode ? '#27272a' : '#f1f5f9') : c.color }}
                />
              ))}
            </div>
          </div>

          {/* Row Operations */}
          <div className="mb-4">
            <div className="text-xs text-zinc-500 mb-2 font-medium">Rows</div>
            <div className="flex gap-1">
              <ToolbarButton
                onClick={() => editor.chain().focus().addRowBefore().run()}
                icon={ArrowUp}
                title="Insert Row Above"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().addRowAfter().run()}
                icon={ArrowDown}
                title="Insert Row Below"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().deleteRow().run()}
                icon={Trash2}
                className="text-rose-500 hover:bg-rose-500/10 text-xs px-2 py-1"
                title="Delete Row"
                showTooltip={showTooltips}
              />
            </div>
          </div>

          {/* Column Operations */}
          <div className="mb-4">
            <div className="text-xs text-zinc-500 mb-2 font-medium">Columns</div>
            <div className="flex gap-1">
              <ToolbarButton
                onClick={() => editor.chain().focus().addColumnBefore().run()}
                icon={ArrowLeft}
                title="Insert Column Left"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().addColumnAfter().run()}
                icon={ArrowRight}
                title="Insert Column Right"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().deleteColumn().run()}
                icon={Trash2}
                className="text-rose-500 hover:bg-rose-500/10 text-xs px-2 py-1"
                title="Delete Column"
                showTooltip={showTooltips}
              />
            </div>
          </div>

          {/* Cell Operations */}
          <div className="mb-4">
            <div className="text-xs text-zinc-500 mb-2 font-medium">Cells</div>
            <div className="flex gap-1 mb-2">
              <ToolbarButton
                onClick={() => editor.chain().focus().mergeCells().run()}
                icon={Combine}
                title="Merge Cells"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().splitCell().run()}
                icon={Split}
                title="Split Cell"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1"
              />
              <ToolbarButton
                onClick={() => {
                  const currentCell = editor.state.selection.$from.node(1);
                  const currentWidth = currentCell?.attrs?.minWidth || '120px';
                  const newWidth = currentWidth === '120px' ? '200px' : currentWidth === '200px' ? '280px' : '120px';
                  editor.chain().focus().setCellAttribute('minWidth', newWidth).run();
                }}
                icon={Maximize2}
                title="Toggle Cell Width"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1"
              />
            </div>
            <div className="flex gap-1">
              <ToolbarButton
                onClick={() => editor.chain().focus().setCellAttribute('textAlign', 'left').run()}
                isActive={editor.isActive('tableCell', { textAlign: 'left' })}
                icon={AlignLeft}
                title="Align Left"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().setCellAttribute('textAlign', 'center').run()}
                isActive={editor.isActive('tableCell', { textAlign: 'center' })}
                icon={AlignCenter}
                title="Align Center"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().setCellAttribute('textAlign', 'right').run()}
                isActive={editor.isActive('tableCell', { textAlign: 'right' })}
                icon={AlignRight}
                title="Align Right"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().setCellAttribute('textAlign', null).run()}
                icon={Type}
                title="Reset Alignment"
                showTooltip={showTooltips}
                className="text-xs px-2 py-1 opacity-60"
              />
            </div>
          </div>

          {/* Delete Table */}
          <ToolbarButton
            onClick={() => {
              openConfirm(
                'Delete Table',
                'Are you sure you want to delete the entire table?',
                () => editor.chain().focus().deleteTable().run(),
                'danger'
              );
            }}
            icon={Trash2}
            className="text-white bg-rose-500 hover:bg-rose-600 shadow-sm w-full justify-center"
            title="Delete Table"
            showTooltip={showTooltips}
          />
        </div>
      )}

      {/* Editor Content */}
      <div
        className={`p-4 overflow-auto custom-scrollbar prose prose-sm max-w-none relative ${isDarkMode ? 'prose-invert' : ''}`}
        style={{ minHeight }}
        onDoubleClick={handleDoubleClick}
      >
        <EditorContent editor={editor} />

        {/* Table UI Buttons (Add Row/Col) */}
      </div>
      
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        style={{ display: 'none' }}
        accept="image/*"
        multiple
        onChange={handleFileChange}
      />

      <style>{`
        .ProseMirror {
          outline: none;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #64748b;
          pointer-events: none;
          height: 0;
          font-style: italic;
        }
        .ProseMirror ul {
          list-style-type: disc !important;
          padding-left: 1.5rem !important;
          margin: 1rem 0;
        }
        .ProseMirror ol {
          list-style-type: decimal !important;
          padding-left: 1.5rem !important;
          margin: 1rem 0;
        }
        .ProseMirror ul[data-type="taskList"] {
          list-style: none !important;
          padding: 0 !important;
        }
        .ProseMirror ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin-bottom: 4px;
        }
        .ProseMirror ul[data-type="taskList"] input[type="checkbox"] {
          cursor: pointer;
          width: 16px;
          height: 16px;
          margin-top: 4px;
          accent-color: #6366f1;
        }
        .ProseMirror table {
          border-collapse: collapse;
          table-layout: fixed;
          width: auto;
          min-width: 100%;
          margin: 32px auto 32px auto;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          counter-reset: row;
        }
        .ProseMirror table tr {
          counter-increment: row;
          position: relative;
          transition: background-color 0.15s ease;
        }
        .ProseMirror table tr:hover {
          background-color: ${isDarkMode ? 'rgba(99, 102, 241, 0.03)' : 'rgba(99, 102, 241, 0.02)'};
        }
        /* Row Headers */
        .ProseMirror table tr::before {
          content: counter(row);
          position: absolute;
          left: -36px;
          top: 0;
          bottom: 0;
          width: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: ${isDarkMode ? '#27272a' : '#f8fafc'};
          border: 1px solid ${isDarkMode ? '#3f3f46' : '#e2e8f0'};
          border-right: 2px solid ${isDarkMode ? '#52525b' : '#cbd5e1'};
          font-size: 11px;
          color: ${isDarkMode ? '#a1a1aa' : '#64748b'};
          font-weight: 600;
          border-radius: 4px 0 0 4px;
          z-index: 1;
        }
        /* Column Headers */
        .ProseMirror table tr:first-child {
          counter-reset: col;
        }
        .ProseMirror table tr:first-child td,
        .ProseMirror table tr:first-child th {
          counter-increment: col;
          position: relative;
        }
        .ProseMirror table tr:first-child td::after,
        .ProseMirror table tr:first-child th::after {
          content: counter(col, upper-alpha);
          position: absolute;
          top: -36px;
          left: 0;
          right: 0;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: ${isDarkMode ? '#27272a' : '#f8fafc'};
          border: 1px solid ${isDarkMode ? '#3f3f46' : '#e2e8f0'};
          border-bottom: 2px solid ${isDarkMode ? '#52525b' : '#cbd5e1'};
          font-size: 11px;
          color: ${isDarkMode ? '#a1a1aa' : '#64748b'};
          font-weight: 600;
          border-radius: 0 4px 0 0;
          z-index: 1;
        }
        /* Top-left corner */
        .ProseMirror table tr:first-child::after {
          content: "";
          position: absolute;
          top: -36px;
          left: -36px;
          width: 32px;
          height: 32px;
          background: ${isDarkMode ? '#27272a' : '#f8fafc'};
          border: 1px solid ${isDarkMode ? '#3f3f46' : '#e2e8f0'};
          border-radius: 4px 0 0 0;
          z-index: 2;
        }
        .ProseMirror table td, .ProseMirror table th {
          min-width: 120px;
          border: 1px solid ${isDarkMode ? '#374151' : '#e5e7eb'};
          padding: 16px 12px;
          vertical-align: top;
          box-sizing: border-box;
          position: relative;
          background: ${isDarkMode ? '#000000' : '#ffffff'};
          word-break: break-word;
          transition: all 0.15s ease;
        }
        .ProseMirror table td[data-text-align="left"], .ProseMirror table th[data-text-align="left"] {
          text-align: left !important;
        }
        .ProseMirror table td[data-text-align="center"], .ProseMirror table th[data-text-align="center"] {
          text-align: center !important;
        }
        .ProseMirror table td[data-text-align="right"], .ProseMirror table th[data-text-align="right"] {
          text-align: right !important;
        }

        .ProseMirror table td:hover, .ProseMirror table th:hover {
          background: ${isDarkMode ? 'rgba(99, 102, 241, 0.02)' : 'rgba(99, 102, 241, 0.01)'};
        }
        .ProseMirror table th {
          font-weight: 600;
          text-align: left;
          background: ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)'};
          border-bottom: 2px solid ${isDarkMode ? '#52525b' : '#d1d5db'};
        }
        .ProseMirror table .selectedCell:after {
          z-index: 2;
          background: rgba(99, 102, 241, 0.08);
          content: "";
          left: 0;
          right: 0;
          top: 0;
          bottom: 0;
          pointer-events: none;
          position: absolute;
          border: 2px solid #6366f1;
          border-radius: 4px;
        }
        .ProseMirror table .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: -2px;
          width: 4px;
          background-color: #6366f1;
          pointer-events: none;
          z-index: 10;
        }
        /* Canvas container */
        .ProseMirror {
          min-width: 100%;
          width: 100%;
          padding-right: 60px;
          padding-bottom: 60px;
          position: relative;
        }
        /* Responsive Wrapper */
        .editor-content-wrapper {
          width: 100%;
          overflow-x: auto;
        }
      `}</style>

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        description={confirmModal.description}
        onConfirm={() => {
          confirmModal.onConfirm();
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        isDarkMode={isDarkMode}
        variant={confirmModal.variant}
      />
    </div>
  );
};

const ToolbarButton = ({ onClick, isActive = false, icon: Icon, title, className = "", showTooltip = true }: any) => (
  <button
    type="button"
    onClick={onClick}
    className={`p-1.5 rounded-md transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none ${
      isActive 
        ? 'bg-indigo-600 text-white shadow-sm' 
        : 'text-zinc-500 hover:bg-zinc-200 dark:hover:bg-black'
    } ${className}`}
    title={showTooltip ? title : undefined}
  >
    <Icon size={14} />
  </button>
);

const ToolbarDivider = () => (
  <div className="w-px h-4 bg-zinc-500/20 mx-1" />
);

export default RichTextEditor;
export { ToolbarButton, ToolbarDivider };
