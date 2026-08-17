'use client';

import {
  type RefObject,
  type UIEvent,
  type WheelEvent,
  type TouchEvent,
  useRef,
  useCallback,
  useEffect,
} from 'react';

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
 * Container geometry captured after the last programmatic write or scroll
 * event - the baseline the next scroll event is compared against to tell
 * genuine user scrolling apart from browser-generated events.
 */
interface ObservedGeometry {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Smart auto-scroll for chat interfaces.
 *
 * Scrolls to bottom when new content arrives, but pauses if the user
 * has scrolled up to read earlier messages. Re-enables once the user
 * scrolls back near the bottom.
 *
 * Content that grows without a data update - an image finishing its load, an
 * expandable section opening, fonts swapping - is re-pinned through a
 * ResizeObserver: attach `contentRef` to the element wrapping the messages
 * inside the scroll container. Resize-driven pins run before paint, so growth
 * never flashes an unpinned frame.
 *
 * @example
 * ```tsx
 * const {
 *   scrollRef,
 *   contentRef,
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
 *   <div ref={contentRef}>...</div>
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
  const lastObservedRef = useRef<ObservedGeometry | null>(null);
  const lastTouchYRef = useRef(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const contentNodeRef = useRef<HTMLElement | null>(null);
  const observedContentRef = useRef<HTMLElement | null>(null);
  const observedContainerRef = useRef<HTMLElement | null>(null);

  const recordGeometry = useCallback((el: HTMLElement) => {
    lastObservedRef.current = {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  }, []);

  const pinToBottom = useCallback(
    (el: HTMLElement) => {
      el.scrollTop = el.scrollHeight;
      recordGeometry(el);
    },
    [recordGeometry],
  );

  const handleScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const el = scrollRef.current;
      if (!el || event.target !== el) return;

      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const last = lastObservedRef.current;

      if (distanceFromBottom <= threshold) {
        shouldAutoScrollRef.current = true;
      } else if (
        last !== null &&
        el.scrollTop < last.scrollTop &&
        el.scrollHeight === last.scrollHeight &&
        el.clientHeight === last.clientHeight
      ) {
        // A pure upward move with stable geometry is the user scrolling up.
        // Events caused by the browser itself - the clamp when content above
        // shrinks, anchoring adjustments while content grows, or the event a
        // bottom pin produces - always coincide with a height change or a
        // downward move, so they can never pause auto-scroll by mistake. This
        // also means the position check stays correct when content keeps
        // growing between a pin and its scroll event.
        shouldAutoScrollRef.current = false;
      }

      recordGeometry(el);
    },
    [scrollRef, threshold, recordGeometry],
  );

  // A wheel/touch scroll up is an unambiguous intent to leave the bottom, so it
  // authoritatively pauses auto-scroll - but only when the gesture actually
  // scrolls this container. Gestures over portaled overlays (e.g. an image
  // lightbox) bubble through the React tree without being DOM descendants, and
  // gestures inside a nested scrollable (an expanded details panel, a code
  // block) are consumed by that element - in both cases the container never
  // scrolls, no scroll event would ever re-enable auto-scroll, and pausing
  // would strand the chat mid-scroll.
  const isContainerScrollGesture = useCallback(
    (target: EventTarget | null) => {
      const el = scrollRef.current;
      if (!el) return false;
      if (el.scrollHeight <= el.clientHeight) return false;
      if (!(target instanceof Node) || !el.contains(target)) return false;
      return !hasNestedScrollableConsumingUpward(target, el);
    },
    [scrollRef],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLElement>) => {
      if (event.deltaY >= 0) return;
      if (!isContainerScrollGesture(event.target)) return;
      shouldAutoScrollRef.current = false;
    },
    [isContainerScrollGesture],
  );

  const handleTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    lastTouchYRef.current = event.touches[0]?.clientY ?? 0;
  }, []);

  const handleTouchMove = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      const y = event.touches[0]?.clientY ?? 0;
      const previousY = lastTouchYRef.current;
      lastTouchYRef.current = y;
      // A finger dragging down pulls earlier content into view (scrolling up).
      if (y <= previousY) return;
      if (!isContainerScrollGesture(event.target)) return;
      shouldAutoScrollRef.current = false;
    },
    [isContainerScrollGesture],
  );

  const scrollOnUpdate = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (shouldAutoScrollRef.current) {
      pinToBottom(el);
      return;
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= threshold;
  }, [scrollRef, threshold, pinToBottom]);

  const resetAutoScroll = useCallback(() => {
    shouldAutoScrollRef.current = true;
  }, []);

  /**
   * Callback ref for the element wrapping the scrollable content (a direct
   * child of the scroll container). Optional - without it, only data updates
   * and container resizes re-pin.
   */
  const contentRef = useCallback((node: HTMLElement | null) => {
    contentNodeRef.current = node;
  }, []);

  // Re-pins on any size change of the observed content or the container while
  // auto-scroll is active. ResizeObserver callbacks run after layout and before
  // paint, so growth (an image load, an expanding panel) never paints an
  // unpinned frame - this is what keeps the view glued to the bottom between
  // data updates. Observations are reconciled on every render (no dependency
  // array) because consumers may mount the container or content conditionally.
  useEffect(() => {
    const container = scrollRef.current;
    const content = contentNodeRef.current;
    if (!container && !content) return;

    resizeObserverRef.current ??= new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el && shouldAutoScrollRef.current) pinToBottom(el);
    });
    const observer = resizeObserverRef.current;

    if (observedContainerRef.current !== container) {
      if (observedContainerRef.current) observer.unobserve(observedContainerRef.current);
      observedContainerRef.current = container;
      if (container) observer.observe(container);
    }
    if (observedContentRef.current !== content) {
      if (observedContentRef.current) observer.unobserve(observedContentRef.current);
      observedContentRef.current = content;
      if (content) observer.observe(content);
    }
  });

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      observedContentRef.current = null;
      observedContainerRef.current = null;
    };
  }, []);

  return {
    scrollRef,
    contentRef,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    scrollOnUpdate,
    resetAutoScroll,
  };
}

/**
 * Whether any element between `target` and `container` (exclusive) is a
 * vertically scrollable area that can still scroll up - meaning an upward
 * wheel/touch gesture is consumed by it instead of reaching the container.
 * Once such an element hits its top, native scroll chaining hands the gesture
 * to the container, so it counts as a container gesture again.
 */
function hasNestedScrollableConsumingUpward(target: Node, container: HTMLElement): boolean {
  let node: HTMLElement | null =
    target instanceof HTMLElement ? target : (target.parentElement ?? null);

  while (node && node !== container) {
    if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight && isScrollableY(node)) {
      return true;
    }
    node = node.parentElement;
  }

  return false;
}

function isScrollableY(el: HTMLElement): boolean {
  const { overflowY } = getComputedStyle(el);
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}
