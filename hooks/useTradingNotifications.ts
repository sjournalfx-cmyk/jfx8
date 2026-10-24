import { useCallback } from 'react';
import { useToast } from '../components/ui/Toast';
import {
  notifyTradingEvent,
  requestTradingNotificationPermission,
  type TradingEvent,
} from '../lib/tradingNotifications';

/**
 * Desktop trading notifications: in-app toasts for events that the mobile
 * components did not already toast, plus browser notifications when allowed.
 */
export const useTradingNotifications = () => {
  const { addToast } = useToast();

  const notify = useCallback(
    (event: TradingEvent) => {
      notifyTradingEvent(event, { addToast });
    },
    [addToast]
  );

  return { notify, requestPermission: requestTradingNotificationPermission };
};
