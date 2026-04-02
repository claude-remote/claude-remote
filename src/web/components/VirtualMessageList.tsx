import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Virtual scrolling container that only renders visible items plus a buffer.
 * Uses IntersectionObserver and ResizeObserver for efficient layout measurement.
 */

interface VirtualMessageListProps {
  /** Total number of items */
  itemCount: number;
  /** Estimated height for items before measurement */
  estimatedItemHeight?: number;
  /** Number of items to render above/below the visible range */
  overscan?: number;
  /** Threshold (in px) from bottom to consider "near bottom" for auto-scroll */
  autoScrollThreshold?: number;
  /** Called when user scrolls to the top */
  onScrollToTop?: () => void;
  /** Render function for each item */
  renderItem: (index: number) => React.ReactNode;
  /** CSS class for outer container */
  className?: string;
}

export function VirtualMessageList({
  itemCount,
  estimatedItemHeight = 80,
  overscan = 5,
  autoScrollThreshold = 100,
  onScrollToTop,
  renderItem,
  className = '',
}: VirtualMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<Map<number, number>>(new Map());
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 });
  const wasNearBottomRef = useRef(true);
  const prevItemCountRef = useRef(itemCount);

  /** Get the height of an item (measured or estimated) */
  const getItemHeight = useCallback(
    (index: number): number => {
      return measureRef.current.get(index) ?? estimatedItemHeight;
    },
    [estimatedItemHeight],
  );

  /** Calculate total height of all items */
  const getTotalHeight = useCallback((): number => {
    let total = 0;
    for (let i = 0; i < itemCount; i++) {
      total += getItemHeight(i);
    }
    return total;
  }, [itemCount, getItemHeight]);

  /** Calculate the offset (top position) for a given item index */
  const getItemOffset = useCallback(
    (index: number): number => {
      let offset = 0;
      for (let i = 0; i < index; i++) {
        offset += getItemHeight(i);
      }
      return offset;
    },
    [getItemHeight],
  );

  /** Determine which items are visible given the current scroll position */
  const calculateVisibleRange = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;

    let startIndex = 0;
    let accum = 0;
    for (let i = 0; i < itemCount; i++) {
      const h = getItemHeight(i);
      if (accum + h >= scrollTop) {
        startIndex = i;
        break;
      }
      accum += h;
    }

    let endIndex = startIndex;
    let visible = accum - scrollTop;
    for (let i = startIndex; i < itemCount; i++) {
      if (visible >= viewportHeight) {
        endIndex = i;
        break;
      }
      visible += getItemHeight(i);
      endIndex = i + 1;
    }

    const start = Math.max(0, startIndex - overscan);
    const end = Math.min(itemCount, endIndex + overscan);

    setVisibleRange((prev) => {
      if (prev.start === start && prev.end === end) return prev;
      return { start, end };
    });
  }, [itemCount, getItemHeight, overscan]);

  /** Set up ResizeObserver to measure rendered items */
  useEffect(() => {
    resizeObserverRef.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement;
        const index = Number(el.dataset.virtualIndex);
        if (Number.isNaN(index)) continue;
        const height = entry.contentRect.height;
        if (measureRef.current.get(index) !== height) {
          measureRef.current.set(index, height);
          changed = true;
        }
      }
      if (changed) {
        calculateVisibleRange();
      }
    });

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [calculateVisibleRange]);

  /** Observe/unobserve item elements */
  const setItemRef = useCallback((index: number, el: HTMLDivElement | null) => {
    const observer = resizeObserverRef.current;
    const prev = itemRefs.current.get(index);
    if (prev && observer) {
      observer.unobserve(prev);
    }
    if (el) {
      itemRefs.current.set(index, el);
      if (observer) observer.observe(el);
    } else {
      itemRefs.current.delete(index);
    }
  }, []);

  /** Handle scroll events */
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Check if near bottom
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    wasNearBottomRef.current = distFromBottom < autoScrollThreshold;

    // Detect scroll to top
    if (container.scrollTop < 80 && onScrollToTop) {
      onScrollToTop();
    }

    calculateVisibleRange();
  }, [autoScrollThreshold, onScrollToTop, calculateVisibleRange]);

  /** Auto-scroll to bottom when new items are added and user was near bottom */
  useLayoutEffect(() => {
    if (itemCount > prevItemCountRef.current && wasNearBottomRef.current) {
      const container = containerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
    prevItemCountRef.current = itemCount;
  }, [itemCount]);

  /** Initial visible range calculation */
  useEffect(() => {
    calculateVisibleRange();
  }, [calculateVisibleRange]);

  const totalHeight = getTotalHeight();
  const topSpacerHeight = getItemOffset(visibleRange.start);
  const bottomSpacerHeight = Math.max(0, totalHeight - getItemOffset(visibleRange.end));

  const items: React.ReactNode[] = [];
  for (let i = visibleRange.start; i < visibleRange.end && i < itemCount; i++) {
    items.push(
      <div key={i} data-virtual-index={i} ref={(el) => setItemRef(i, el)}>
        {renderItem(i)}
      </div>,
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className={`overflow-y-auto ${className}`}>
      {/* Top spacer for items above visible range */}
      <div style={{ height: topSpacerHeight }} />
      {items}
      {/* Bottom spacer for items below visible range */}
      <div style={{ height: bottomSpacerHeight }} />
    </div>
  );
}
