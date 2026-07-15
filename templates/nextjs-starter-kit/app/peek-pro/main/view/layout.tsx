import type { ReactNode } from 'react';
import { OdysseyLoader } from '../OdysseyLoader';
import '@peektravel/app-utilities/ui/tokens.css';
import '@peektravel/app-utilities/ui/odyssey.css';

export default function SettingsViewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OdysseyLoader />
      {children}
    </>
  );
}
