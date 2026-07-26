'use client';

import { type RefObject, type WheelEvent, type TouchEvent, useRef, useCallback } from 'react';

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
 * const {
 *   scrollRef,
 *   handleScroll,
 *   handleWheel,
 *   handleTouchStart,
 *   handleTouchMove,
 *   scrollOnUpdate,
 *   resetAutoScroll,
 * } = useAutoScroll();
 *
 * useEffect(() => {
 *   const id = requestAnimationFrame(scrollOnUpdate);
 *   return () => cancelAnimationFrame(id);
 * }, [messages, scrollOnUpdate]);
 *
 * <div
 *   ref={scrollRef}
 *   onScroll={handleScroll}
 *   onWheel={handleWheel}
 *   onTouchStart={handleTouchStart}
 *   onTouchMove={handleTouchMove}
 * >
 *   ...
 * </div>
 *
 * // On send: resetAutoScroll() to force-scroll on next update
 * ```
 */
export function useAutoScroll(options: UseAutoScrollOptions = {}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const scrollRef = options.scrollRef ?? internalRef;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD_PX;
  const shouldAutoScrollRef = useRef(true);
  // Swallows the async scroll event from a programmatic scrollTop write so it
  // can't falsely disable auto-scroll when content height grows between the
  // write and the event.
  const isProgrammaticScrollRef = useRef(false);
  const lastTouchYRef = useRef(0);

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

  // A wheel/touch scroll up is an unambiguous intent to leave the bottom, so it
  // authoritatively pauses auto-scroll. Unlike the onScroll position check, the
  // input event exists regardless of where the per-frame programmatic write left
  // scrollTop, so it can never be mistaken for (or swallowed by) an auto-scroll.
  const handleWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    if (event.deltaY < 0) shouldAutoScrollRef.current = false;
  }, []);

  const handleTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    lastTouchYRef.current = event.touches[0]?.clientY ?? 0;
  }, []);

  const handleTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    const y = event.touches[0]?.clientY ?? 0;
    // A finger dragging down pulls earlier content into view (scrolling up).
    if (y > lastTouchYRef.current) shouldAutoScrollRef.current = false;
    lastTouchYRef.current = y;
  }, []);

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

  return {
    scrollRef,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    scrollOnUpdate,
    resetAutoScroll,
  };
}
