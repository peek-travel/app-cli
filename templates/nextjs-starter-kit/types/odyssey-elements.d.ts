import type { HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ody-button': HTMLAttributes<HTMLElement> & {
        variant?: 'primary' | 'secondary' | 'ghost' | 'tertiary' | 'danger';
        size?: 'base' | 'small';
      };
      'ody-alert': HTMLAttributes<HTMLElement> & {
        variant?: 'info' | 'success' | 'warning' | 'danger';
      };
      'ody-divider': HTMLAttributes<HTMLElement>;
      'ody-card': HTMLAttributes<HTMLElement> & {
        'bar-color'?: string;
        clickable?: boolean;
      };
      'ody-tag': HTMLAttributes<HTMLElement> & {
        variant?: 'primary' | 'secondary';
        color?: string;
        size?: 'base' | 'small';
      };
      'ody-icon': HTMLAttributes<HTMLElement> & {
        name?: string;
        size?: 'extra-small' | 'mid-small' | 'small' | 'base' | 'medium' | 'large' | 'free';
      };
      'ody-message': HTMLAttributes<HTMLElement>;
      'ody-loading-spinner': HTMLAttributes<HTMLElement> & {
        size?: 'small' | 'base' | 'large';
      };
      'ody-loading-bar': HTMLAttributes<HTMLElement>;
      'ody-empty-state': HTMLAttributes<HTMLElement> & {
        variant?: 'default' | 'error' | 'no-results' | 'no-search' | 'not-authorized';
      };
      'ody-status-dot': HTMLAttributes<HTMLElement> & {
        color?: 'green' | 'blue' | 'orange';
      };
      'ody-copy-button': HTMLAttributes<HTMLElement> & {
        value?: string;
        label?: string;
        'success-duration'?: number;
      };
    }
  }
}
