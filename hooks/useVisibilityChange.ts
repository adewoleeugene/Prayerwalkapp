'use client';

import { useEffect, useRef } from 'react';

type Handlers = {
  onHidden?: () => void;
  onVisible?: () => void;
};

export function useVisibilityChange({ onHidden, onVisible }: Handlers) {
  const onHiddenRef = useRef(onHidden);
  const onVisibleRef = useRef(onVisible);
  onHiddenRef.current = onHidden;
  onVisibleRef.current = onVisible;

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'hidden') {
        onHiddenRef.current?.();
      } else {
        onVisibleRef.current?.();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);
}
