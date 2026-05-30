import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ChartErrorBoundary extends React.Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Chart component crashed:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="w-full h-full flex flex-col items-center justify-center bg-black text-zinc-400 p-6 rounded-lg border border-zinc-800">
                    <AlertTriangle size={48} className="text-amber-500 mb-4" />
                    <h2 className="text-lg font-bold text-white mb-2">Chart Rendering Error</h2>
                    <p className="text-sm text-center mb-4 max-w-2xl whitespace-normal break-normal">
                        Something went wrong with the chart visualization. This might be due to invalid data or a library conflict.
                    </p>
                    <div className="bg-black/50 p-3 rounded text-xs font-mono text-rose-400 mb-6 max-w-full overflow-auto">
                        {this.state.error?.message}
                    </div>
                    <button 
                        onClick={() => this.setState({ hasError: false, error: null })}
                        className="px-4 py-2 bg-black hover:bg-black text-white rounded transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
