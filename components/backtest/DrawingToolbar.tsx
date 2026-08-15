import React, { useState, useCallback } from 'react';
import {
    MousePointer2, Slash, ArrowRight,
    Minus, Square, Layers, Trash2, GripVertical, Magnet,
    Lock, Unlock, TrendingUp, TrendingDown, Undo, Redo, MoreHorizontal
} from 'lucide-react';
import { ToolType } from './types';

// Drawing-tool glyphs styled after TradingView's compact chart toolbar.
// The ray keeps a visible arrowhead at its open end, while the vertical line
// uses small caps so it cannot be confused with the rectangle tool.
const RayToolIcon = ({ size = 16, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20 19.5 4.5" />
        <path d="M13.5 4.5h6v6" />
    </svg>
);

const VerticalLineToolIcon = ({ size = 16, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v18" />
        <path d="M8 4h8M8 20h8" />
    </svg>
);

interface DrawingToolbarProps {
    activeTool: ToolType;
    setActiveTool: (tool: ToolType) => void;
    clearDrawings: () => void;
    magnetMode: boolean;
    toggleMagnetMode: () => void;
    isLocked: boolean;
    toggleLocked: () => void;
    orientation: 'horizontal' | 'vertical';
    toggleOrientation: () => void;
    isDarkMode?: boolean;
    style?: React.CSSProperties;
    onPositionChange?: (pos: { x: number, y: number }) => void;
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    currentColor?: string;
    setCurrentColor?: (color: string) => void;
    currentStrokeWidth?: number;
    currentStrokeStyle?: 'solid' | 'dashed' | 'dotted';
    setStrokeWidth?: (width: number) => void;
    setStrokeStyle?: (style: 'solid' | 'dashed' | 'dotted') => void;
    selectedDrawingId?: string | null;
}

const TOOL_COLORS = [
    '#2962ff', '#FF4F01', '#10b981', '#ef4444', '#f59e0b', 
    '#8b5cf6', '#ec4899', '#787b86', '#ffffff', '#000000'
];

const TOOLS = [
    { id: 'cursor', icon: MousePointer2, title: 'Cursor', shortcut: 'V' },
    { id: 'trendline', icon: Slash, title: 'Trend Line', shortcut: 'T' },
    { id: 'ray', icon: RayToolIcon, title: 'Ray', shortcut: 'R' },
    { id: 'arrow', icon: ArrowRight, title: 'Arrow', shortcut: 'A' },
    { id: 'horizontal', icon: Minus, title: 'Horizontal Line', shortcut: 'H' },
    { id: 'vertical', icon: VerticalLineToolIcon, title: 'Vertical Line', shortcut: 'N' },
    { id: 'rect', icon: Square, title: 'Rectangle', shortcut: 'B' },
    { id: 'long', icon: TrendingUp, title: 'Long Position', shortcut: 'L' },
    { id: 'short', icon: TrendingDown, title: 'Short Position', shortcut: 'S' },
];

export const DrawingToolbar = React.memo<DrawingToolbarProps>(({
    activeTool,
    setActiveTool,
    clearDrawings,
    magnetMode,
    toggleMagnetMode,
    isLocked,
    toggleLocked,
    orientation,
    toggleOrientation,
    isDarkMode,
    style,
    onPositionChange,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
    currentColor = '#2962ff',
    setCurrentColor,
    currentStrokeWidth = 1,
    currentStrokeStyle = 'solid',
    setStrokeWidth,
    setStrokeStyle,
    selectedDrawingId = null
}) => {
    const isDragging = React.useRef(false);
    const dragOffset = React.useRef({ x: 0, y: 0 });
    const [showWidthMenu, setShowWidthMenu] = useState(false);
    const [showStyleMenu, setShowStyleMenu] = useState(false);
    const [showColorMenu, setShowColorMenu] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        isDragging.current = true;
        
        const toolbarEl = e.currentTarget.closest('.drawing-toolbar-root') as HTMLElement;
        if (toolbarEl) {
            const rect = toolbarEl.getBoundingClientRect();
            dragOffset.current = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        }

        const onMouseMove = (moveEvent: MouseEvent) => {
            if (!isDragging.current) return;
            moveEvent.preventDefault();
            
            const toolbarDiv = document.querySelector('.drawing-toolbar-root') as HTMLElement;
            const container = toolbarDiv?.offsetParent as HTMLElement;
            
            if (container) {
                const containerRect = container.getBoundingClientRect();
                
                let newX = moveEvent.clientX - containerRect.left - dragOffset.current.x;
                let newY = moveEvent.clientY - containerRect.top - dragOffset.current.y;
                
                newX = Math.max(0, Math.min(newX, containerRect.width - (toolbarDiv?.offsetWidth || 50)));
                newY = Math.max(0, Math.min(newY, containerRect.height - (toolbarDiv?.offsetHeight || 300)));

                if (onPositionChange) {
                    onPositionChange({ x: newX, y: newY });
                }
            }
        };

        const onMouseUp = () => {
            isDragging.current = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    const handleToolSelect = useCallback((toolId: ToolType) => {
        if (activeTool !== toolId) {
            setActiveTool(toolId);
        }
    }, [activeTool, setActiveTool]);

    return (
        <div className={`absolute z-30 drawing-toolbar-root transition-all duration-200 ease-out`} style={style}>
            <div className={`flex items-center gap-1 rounded-[18px] shadow-2xl border px-2 py-1 ${isDarkMode ? 'bg-[#191919] border-white/10 text-zinc-200' : 'bg-white border-slate-200 text-slate-700'}`}>
                <button
                    className={`w-7 h-7 grid place-items-center rounded-md cursor-grab active:cursor-grabbing ${isDarkMode ? 'hover:bg-white/5 text-zinc-500' : 'hover:bg-slate-100 text-slate-400'}`}
                    onMouseDown={handleMouseDown}
                    title="Drag toolbar"
                >
                    <GripVertical size={14} />
                </button>

                <button
                    onClick={toggleOrientation}
                    className={`w-7 h-7 grid place-items-center rounded-md ${isDarkMode ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-slate-100 text-slate-500'}`}
                    title="Flip toolbar"
                >
                    <Layers size={15} />
                </button>

                <div className={`w-px h-5 mx-1 ${isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`} />

                {TOOLS.map(tool => {
                    const active = activeTool === tool.id;
                    return (
                        <button
                            key={tool.id}
                            onClick={() => handleToolSelect(tool.id as ToolType)}
                            className={`relative w-8 h-8 grid place-items-center rounded-md transition-colors ${active ? 'text-white' : (isDarkMode ? 'text-zinc-400 hover:bg-white/5' : 'text-slate-500 hover:bg-slate-100')}`}
                            title={tool.title}
                        >
                            <tool.icon size={16} strokeWidth={1.8} />
                            {active && <span className="absolute left-1.5 right-1.5 -bottom-0.5 h-0.5 rounded-full bg-white" />}
                        </button>
                    );
                })}

                <div className={`w-px h-5 mx-1 ${isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`} />

                <div className="relative">
                    <button
                        onClick={() => setShowColorMenu(v => !v)}
                        className={`h-7 px-1.5 rounded-md flex items-center gap-1.5 text-[11px] font-medium tracking-tight transition-colors ${isDarkMode ? 'hover:bg-white/5 text-zinc-200' : 'hover:bg-slate-100 text-slate-700'}`}
                        title="Stroke color"
                    >
                        <span
                            className={`w-4 h-4 rounded-sm border shadow-sm ${isDarkMode ? 'border-white/10' : 'border-slate-300'}`}
                            style={{ backgroundColor: currentColor }}
                        />
                        <span className="sr-only">Color</span>
                    </button>
                    {showColorMenu && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowColorMenu(false)} />
                            <div className={`absolute left-0 top-full mt-2 z-50 w-64 rounded-xl border shadow-2xl p-2 ${isDarkMode ? 'bg-[#121212] border-white/10 shadow-black/40' : 'bg-slate-100 border-slate-300 shadow-slate-300/30'}`}>
                                <div className="flex items-center gap-1.5 mb-2">
                                    {TOOL_COLORS.slice(0, 10).map(color => (
                                        <button
                                            key={color}
                                            onClick={() => {
                                                setCurrentColor?.(color);
                                                setShowColorMenu(false);
                                            }}
                                            className={`w-5 h-5 rounded-sm ring-1 ring-inset transition-transform ${currentColor === color ? 'scale-110 ring-white/80' : (isDarkMode ? 'ring-white/10' : 'ring-slate-300')}`}
                                            style={{ backgroundColor: color, filter: 'brightness(0.9) saturate(0.82)' }}
                                        />
                                    ))}
                                </div>
                                <div className={`h-px my-2 ${isDarkMode ? 'bg-white/10' : 'bg-slate-300'}`} />
                                <div className="grid grid-cols-10 gap-1">
                                    {[
                                        '#ffd1dc', '#ffcc99', '#fff59d', '#c8e6c9', '#b2dfdb',
                                        '#b3e5fc', '#c5cae9', '#e1bee7', '#f8bbd0', '#f5f5f5',
                                        '#ffab91', '#ff8a65', '#ff7043', '#ff5722', '#e64a19',
                                        '#4caf50', '#26a69a', '#29b6f6', '#5c6bc0', '#7e57c2'
                                    ].map(color => (
                                        <button
                                            key={color}
                                            onClick={() => {
                                                setCurrentColor?.(color);
                                                setShowColorMenu(false);
                                            }}
                                            className={`w-5 h-5 rounded-sm ring-1 ring-inset transition-transform hover:scale-110 ${currentColor === color ? 'ring-white/80' : (isDarkMode ? 'ring-white/10' : 'ring-slate-300')}`}
                                            style={{ backgroundColor: color, filter: 'brightness(0.88) saturate(0.8)' }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className={`w-px h-5 mx-1 ${isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`} />

                <div className="relative">
                    <button
                        onClick={() => setShowWidthMenu(v => !v)}
                        className={`h-7 px-2.5 rounded-md flex items-center gap-2 text-[11px] font-medium tracking-tight transition-colors ${isDarkMode ? 'hover:bg-white/5 text-zinc-200' : 'hover:bg-slate-100 text-slate-700'}`}
                        title="Stroke width"
                    >
                        <Minus size={14} className={isDarkMode ? 'text-zinc-500' : 'text-slate-400'} />
                        <span>{currentStrokeWidth}px</span>
                    </button>
                    {showWidthMenu && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowWidthMenu(false)} />
                            <div className={`absolute left-0 top-full mt-2 z-50 w-24 rounded-xl border shadow-2xl p-1 ${isDarkMode ? 'bg-[#191919] border-white/10' : 'bg-white border-slate-200'}`}>
                                {[1, 2, 3, 4].map(width => (
                                    <button
                                        key={width}
                                        onClick={() => {
                                            setStrokeWidth?.(width);
                                            setShowWidthMenu(false);
                                        }}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs ${currentStrokeWidth === width ? (isDarkMode ? 'bg-white text-black' : 'bg-slate-900 text-white') : (isDarkMode ? 'text-zinc-300 hover:bg-white/5' : 'text-slate-600 hover:bg-slate-100')}`}
                                    >
                                        <span>{width}px</span>
                                        <Minus size={14} strokeWidth={Math.max(1, width)} />
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                <div className={`w-px h-5 mx-1 ${isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`} />

                <div className="relative">
                    <button
                        onClick={() => setShowStyleMenu(v => !v)}
                        className={`h-7 px-2.5 rounded-md flex items-center gap-2 text-[11px] font-medium tracking-tight transition-colors ${isDarkMode ? 'hover:bg-white/5 text-zinc-200' : 'hover:bg-slate-100 text-slate-700'}`}
                        title="Stroke style"
                    >
                        <span className="flex flex-col gap-0.5 w-5">
                            <span className={`h-px w-full ${currentStrokeStyle === 'dotted' ? 'border-b border-dotted' : currentStrokeStyle === 'dashed' ? 'border-b border-dashed' : 'bg-current'}`} />
                            <span className={`h-px w-full ${currentStrokeStyle === 'dotted' ? 'border-b border-dotted' : currentStrokeStyle === 'dashed' ? 'border-b border-dashed' : 'bg-current'}`} />
                        </span>
                        <span>{currentStrokeStyle === 'solid' ? 'Line' : currentStrokeStyle === 'dashed' ? 'Dashed' : 'Dotted'}</span>
                    </button>
                    {showStyleMenu && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowStyleMenu(false)} />
                            <div className={`absolute left-0 top-full mt-2 z-50 w-40 rounded-xl border shadow-2xl p-1 ${isDarkMode ? 'bg-[#191919] border-white/10' : 'bg-white border-slate-200'}`}>
                                {([
                                    { key: 'solid', label: 'Line' },
                                    { key: 'dashed', label: 'Dashed line' },
                                    { key: 'dotted', label: 'Dotted line' },
                                ] as const).map(option => (
                                    <button
                                        key={option.key}
                                        onClick={() => {
                                            setStrokeStyle?.(option.key);
                                            setShowStyleMenu(false);
                                        }}
                                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs ${currentStrokeStyle === option.key ? (isDarkMode ? 'bg-white text-black' : 'bg-slate-900 text-white') : (isDarkMode ? 'text-zinc-300 hover:bg-white/5' : 'text-slate-600 hover:bg-slate-100')}`}
                                    >
                                        <span className="w-8 flex items-center">
                                            <span className={`w-8 ${option.key === 'dotted' ? 'border-b-2 border-dotted' : option.key === 'dashed' ? 'border-b-2 border-dashed' : 'border-b-2 border-current'}`} />
                                        </span>
                                        <span>{option.label}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                <div className={`w-px h-5 mx-1 ${isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`} />

                <div className="relative">
                    <button
                        onClick={() => setShowMoreMenu(v => !v)}
                        className={`w-8 h-8 grid place-items-center rounded-md transition-colors ${isDarkMode ? 'text-zinc-400 hover:bg-white/5' : 'text-slate-500 hover:bg-slate-100'}`}
                        title="More"
                    >
                        <MoreHorizontal size={16} />
                    </button>
                    {showMoreMenu && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                            <div className={`absolute right-0 top-full mt-2 z-50 w-52 rounded-xl border shadow-2xl p-2 ${isDarkMode ? 'bg-[#191919] border-white/10' : 'bg-white border-slate-200'}`}>
                                <div className="grid grid-cols-2 gap-1 mb-2">
                                    <button
                                        onClick={() => { onUndo?.(); setShowMoreMenu(false); }}
                                        disabled={!canUndo}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${canUndo ? (isDarkMode ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-slate-100 text-slate-700') : 'opacity-30 cursor-not-allowed'}`}
                                    >
                                        <Undo size={14} /> Undo
                                    </button>
                                    <button
                                        onClick={() => { onRedo?.(); setShowMoreMenu(false); }}
                                        disabled={!canRedo}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${canRedo ? (isDarkMode ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-slate-100 text-slate-700') : 'opacity-30 cursor-not-allowed'}`}
                                    >
                                        <Redo size={14} /> Redo
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-1">
                                    <button
                                        onClick={toggleMagnetMode}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${magnetMode ? (isDarkMode ? 'bg-white text-black' : 'bg-slate-900 text-white') : (isDarkMode ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-slate-100 text-slate-700')}`}
                                    >
                                        <Magnet size={14} /> Magnet
                                    </button>
                                    <button
                                        onClick={toggleLocked}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${isLocked ? (isDarkMode ? 'bg-white text-black' : 'bg-slate-900 text-white') : (isDarkMode ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-slate-100 text-slate-700')}`}
                                    >
                                        {isLocked ? <Lock size={14} /> : <Unlock size={14} />} {isLocked ? 'Unlock' : 'Lock'}
                                    </button>
                                    <button
                                        onClick={clearDrawings}
                                        className={`col-span-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-rose-500 hover:bg-rose-500/10`}
                                    >
                                        <Trash2 size={14} /> Delete drawings
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
});
