import React from 'react';
import { Renderer } from '@openuidev/react-lang';
import { library } from './library';

export type GenUiNavTarget = 'history' | 'analytics' | 'log-trade';

/**
 * Error boundary for model-generated UI. A malformed program from the model
 * must never crash the chat or leave a blank bubble: on any render error we
 * show the plain-text fallback instead.
 */
class GenUiBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[ai-chat] generative UI failed, falling back to text', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface GenerativeMessageProps {
  code: string;
  isStreaming?: boolean;
  fallback: React.ReactNode;
  onNavigate?: (target: GenUiNavTarget, tradeId?: string) => void;
}

/**
 * Renders one OpenUI Lang program with the JFX component library.
 * Actions only ever navigate inside the app; nothing here can place, close,
 * or modify a trade.
 */
const GenerativeMessage: React.FC<GenerativeMessageProps> = ({ code, isStreaming, fallback, onNavigate }) => {
  const handleAction = React.useCallback((event: { type: string; params?: Record<string, unknown> }) => {
    if (!onNavigate) return;
    switch (event.type) {
      case 'OpenJournal':
        onNavigate('history');
        break;
      case 'OpenAnalytics':
        onNavigate('analytics');
        break;
      case 'OpenLogTrade':
        onNavigate('log-trade');
        break;
      case 'OpenTradeDetail': {
        const tradeId = typeof event.params?.tradeId === 'string' ? event.params.tradeId : undefined;
        onNavigate('history', tradeId);
        break;
      }
      default:
        // Unknown or built-in actions (e.g. OpenUrl) are ignored on purpose.
        break;
    }
  }, [onNavigate]);

  return (
    <GenUiBoundary fallback={fallback}>
      <div className="jfx-genui w-full min-w-0 max-w-full overflow-hidden">
        <Renderer
          response={code}
          library={library}
          isStreaming={Boolean(isStreaming)}
          onAction={handleAction as any}
        />
      </div>
    </GenUiBoundary>
  );
};

export default GenerativeMessage;
