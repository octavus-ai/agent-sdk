'use client';

import { type RefObject, useRef, useCallback } from 'react';

const DEFAULT_THRESHOLD_PX = 80;

export interface UseAutoScrollOptions {
  /**
   * Provide your own ref if you need to share the scroll container
   * with other logic. When omitted, an internal ref is created.
   */
  scrollRef?: RefObject<HTMLDivElement | null>;

  /**
   * Distance from the bottom (in pixels) within which auto-scroll
   * stays active. Defaults to 80.
   */
  threshold?: number;
}

/**
 * Smart auto-scroll for chat interfaces.
 *
 * Scrolls to bottom when new content arrives, but pauses if the user
 * has scrolled up to read earlier messages. Re-enables once the user
 * scrolls back near the bottom.
 *
 * @example
 * ```tsx
 * const { scrollRef, handleScroll, scrollOnUpdate, resetAutoScroll } = useAutoScroll();
 *
 * useEffect(() => {
 *   const id = requestAnimationFrame(scrollOnUpdate);
 *   return () => cancelAnimationFrame(id);
 * }, [messages, scrollOnUpdate]);
 *
 * <div ref={scrollRef} onScroll={handleScroll}>...</div>
 *
 * // On send: resetAutoScroll() to force-scroll on next update
 * ```
 */
export function useAutoScroll(options: UseAutoScrollOptions = {}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const scrollRef = options.scrollRef ?? internalRef;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD_PX;
  const shouldAutoScrollRef = useRef(true);
  // Guards against the async scroll event from a programmatic scrollTop
  // assignment falsely disabling auto-scroll. When content height grows
  // between the assignment and the scroll event handler, the distance-
  // from-bottom check can exceed the threshold even though no user
  // interaction occurred. This is most visible in narrow containers
  // (e.g. a 30%-width chat panel) where wrapping amplifies height changes.
  const isProgrammaticScrollRef = useRef(false);

  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= threshold;
  }, [scrollRef, threshold]);

  const scrollOnUpdate = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (shouldAutoScrollRef.current) {
      // Only set the guard when the assignment actually moves scrollTop.
      // If we're already at the bottom, the browser fires no scroll event
      // and a stale `true` would swallow the next genuine user scroll.
      const previousScrollTop = el.scrollTop;
      el.scrollTop = el.scrollHeight;
      if (el.scrollTop !== previousScrollTop) {
        isProgrammaticScrollRef.current = true;
      }
      return;
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= threshold;
  }, [scrollRef, threshold]);

  const resetAutoScroll = useCallback(() => {
    shouldAutoScrollRef.current = true;
  }, []);

  return { scrollRef, handleScroll, scrollOnUpdate, resetAutoScroll };
}
