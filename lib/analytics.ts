/**
 * Deferred PostHog loader.
 *
 * The analytics SDK is not needed for the first paint, so it is pulled in as
 * its own chunk the first time the app initialises or captures an event. All
 * calls are queued behind a single import, which keeps init idempotent and
 * makes the helper safe to call before the chunk has finished loading.
 */

type PostHogClient = typeof import('posthog-js').default;

const POSTHOG_KEY = 'phc_afcj9r3oxhjFLVOZq2hUbcbkWBYM0mPxgNpiYYYjlSw';
const POSTHOG_HOST = 'https://us.i.posthog.com';

let clientPromise: Promise<PostHogClient | null> | null = null;

const loadPostHog = (): Promise<PostHogClient | null> => {
  if (!clientPromise) {
    clientPromise = import('posthog-js')
      .then(({ default: posthog }) => {
        posthog.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          autocapture: true,
          capture_pageview: false,
        });
        return posthog;
      })
      .catch(() => null);
  }
  return clientPromise;
};

export const initAnalytics = (): void => {
  void loadPostHog();
};

export const captureAnalytics = (event: string, properties?: Record<string, unknown>): void => {
  void loadPostHog().then((posthog) => {
    try {
      posthog?.capture(event, properties);
    } catch {
      /* analytics must never break the app */
    }
  });
};

export const identifyAnalytics = (distinctId: string, properties?: Record<string, unknown>): void => {
  void loadPostHog().then((posthog) => {
    try {
      posthog?.identify(distinctId, properties);
    } catch {
      /* analytics must never break the app */
    }
  });
};
