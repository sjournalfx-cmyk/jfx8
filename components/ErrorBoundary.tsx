import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
  isDarkMode: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { isDarkMode } = this.props;
      const { error } = this.state;

      return (
        <div className={`fixed inset-0 z-[9999] w-screen h-screen flex items-center justify-center px-4 py-8 overflow-y-auto ${isDarkMode ? 'bg-[#000000] text-white' : 'bg-slate-50 text-slate-900'}`}>
          <div className={`w-[min(100%,28rem)] sm:w-[min(100%,32rem)] p-6 sm:p-8 rounded-3xl border text-center relative shadow-2xl ${isDarkMode ? 'bg-[#0a0a0c] border-zinc-800 shadow-black/80' : 'bg-white border-slate-200 shadow-xl'}`}>
            <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl mx-auto mb-5 flex items-center justify-center ${isDarkMode ? 'bg-rose-500/10 text-rose-500' : 'bg-rose-50 text-rose-600'}`}>
              <AlertTriangle size={40} />
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-3 leading-tight">Something went wrong</h1>
            <p className={`text-sm sm:text-[15px] mb-6 leading-relaxed max-w-[26rem] mx-auto ${isDarkMode ? 'text-zinc-400' : 'text-slate-500'}`}>
              We hit an unexpected error in this view. It has been logged.
            </p>

            {error && (
              <div className="mb-8 text-left">
                <span className="text-[10px] font-black uppercase tracking-wider text-rose-500 mb-2 block">Error details</span>
                <code className={`block p-3 rounded-xl text-xs font-mono overflow-x-auto max-h-32 border whitespace-pre-wrap break-words ${
                  isDarkMode ? 'bg-black border-zinc-800 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}>
                  {error.message}
                </code>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <button
                onClick={this.handleReset}
                className="flex-1 min-h-12 flex items-center justify-center gap-2 px-6 py-3.5 bg-[#FF4F01] hover:bg-[#FF4F01]/90 text-white rounded-xl font-bold transition-all active:scale-95 shadow-lg shadow-[#FF4F01]/20 text-sm"
              >
                <RefreshCw size={18} /> Reload Application
              </button>
              
              <button
                onClick={() => window.location.href = '/'}
                className={`flex-1 min-h-12 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold transition-all border text-sm ${
                  isDarkMode 
                    ? 'bg-zinc-900 border-zinc-800 text-white hover:bg-zinc-800' 
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Home size={18} /> Return Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
