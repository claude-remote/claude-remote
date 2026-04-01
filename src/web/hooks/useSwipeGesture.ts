import { useEffect, useRef } from 'react';

interface SwipeGestureOptions {
  /** Minimum horizontal distance in px to trigger swipe (default: 50) */
  threshold?: number;
  /** Maximum vertical distance in px to still count as horizontal swipe (default: 100) */
  maxVertical?: number;
  /** Minimum velocity in px/ms to trigger (default: 0.3) */
  minVelocity?: number;
  /** Called when a right swipe is detected */
  onSwipeRight?: () => void;
  /** Called when a left swipe is detected */
  onSwipeLeft?: () => void;
  /** Element ref to attach listeners to; defaults to document */
  elementRef?: React.RefObject<HTMLElement | null>;
}

export function useSwipeGesture({
  threshold = 50,
  maxVertical = 100,
  minVelocity = 0.3,
  onSwipeRight,
  onSwipeLeft,
  elementRef,
}: SwipeGestureOptions) {
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    const target = elementRef?.current ?? document;

    const handleTouchStart = (e: Event) => {
      const touch = (e as TouchEvent).touches[0];
      if (!touch) return;
      touchStart.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    };

    const handleTouchEnd = (e: Event) => {
      if (!touchStart.current) return;
      const touch = (e as TouchEvent).changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - touchStart.current.x;
      const dy = touch.clientY - touchStart.current.y;
      const dt = Date.now() - touchStart.current.t;
      const velocity = Math.abs(dx) / dt;

      touchStart.current = null;

      // Must be primarily horizontal
      if (Math.abs(dy) > maxVertical) return;
      // Must meet threshold and velocity
      if (Math.abs(dx) < threshold) return;
      if (velocity < minVelocity) return;

      if (dx > 0) {
        onSwipeRight?.();
      } else {
        onSwipeLeft?.();
      }
    };

    target.addEventListener('touchstart', handleTouchStart, { passive: true });
    target.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      target.removeEventListener('touchstart', handleTouchStart);
      target.removeEventListener('touchend', handleTouchEnd);
    };
  }, [threshold, maxVertical, minVelocity, onSwipeRight, onSwipeLeft, elementRef]);
}
