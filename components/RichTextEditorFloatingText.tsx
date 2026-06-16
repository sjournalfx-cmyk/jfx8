import React, { useState, useRef, useEffect } from 'react';
import { NodeViewWrapper, NodeViewProps, NodeViewContent } from '@tiptap/react';
import { Trash2, Move, GripHorizontal, Type } from 'lucide-react';

const FloatingTextNode: React.FC<NodeViewProps> = (props) => {
  const { node, updateAttributes, deleteNode, selected } = props;
  const [isDragging, setIsDragging] = useState(false);
  
  const x = node.attrs.x || 0;
  const y = node.attrs.y || 0;
  const width = node.attrs.width || '250px';
  const color = node.attrs.color || 'transparent';

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);

    const startX = e.clientX - x;
    const startY = e.clientY - y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newX = moveEvent.clientX - startX;
      const newY = moveEvent.clientY - startY;
      updateAttributes({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <NodeViewWrapper 
      className="absolute z-40" 
      style={{ 
        left: `${x}px`, 
        top: `${y}px`, 
        width: width,
        minWidth: '100px'
      }}
    >
      <div 
        className={`group/floating-text relative rounded-lg border transition-all ${
          selected ? 'ring-2 ring-indigo-500 border-indigo-500 shadow-xl' : 'border-transparent hover:border-zinc-500/30'
        } ${color === 'transparent' ? '' : 'p-4 shadow-sm'}`}
        style={{ backgroundColor: color }}
      >
        {/* Drag Handle */}
        <div 
          onMouseDown={handleMouseDown}
          className={`absolute -top-3 -left-3 p-1.5 rounded-full bg-indigo-600 text-white shadow-lg cursor-grab active:cursor-grabbing z-50 opacity-0 group-hover/floating-text:opacity-100 transition-opacity ${isDragging ? 'opacity-100' : ''}`}
        >
          <Move size={12} />
        </div>

        {/* Delete Button */}
        <button 
          onClick={deleteNode}
          className="absolute -top-3 -right-3 p-1.5 rounded-full bg-rose-500 text-white shadow-lg opacity-0 group-hover/floating-text:opacity-100 transition-opacity z-50"
        >
          <Trash2 size={12} />
        </button>

        {/* Content Area */}
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <NodeViewContent className="outline-none min-h-[1em]" />
        </div>


        {node.content.size === 0 && (
          <div className="absolute inset-0 pointer-events-none flex items-center px-1 opacity-30 text-xs italic">
            Type something...
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export default FloatingTextNode;
