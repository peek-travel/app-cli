import type { ReactNode } from 'react';
import { OdysseyLoader } from '@/lib/odyssey/OdysseyLoader';
import '@peektravel/app-utilities/ui/tokens.css';
import '@peektravel/app-utilities/ui/odyssey.css';

// Shared shell for every embedded settings view (peek-pro, cng, ...). Loads the
// Odyssey design-system CSS and registers its custom elements client-side. Each
// example's app/.../view/layout.tsx re-exports this so Next still finds a layout
// in the route tree.
export default function SettingsViewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OdysseyLoader />
      {children}
    </>
  );
}
