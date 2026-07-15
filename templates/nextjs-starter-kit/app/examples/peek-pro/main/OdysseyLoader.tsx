'use client'
import { useEffect } from 'react';

// Loaded client-side only so custom elements upgrade after React hydration,
// avoiding hydration mismatches.
export function OdysseyLoader() {
  useEffect(() => {
    import('@peektravel/app-utilities/ui');
  }, []);
  return null;
}
