import 'react';

// Single source of truth for `<ody-*>` JSX typings. The library ships no React
// typings for its web components, so we declare them here. One file, one
// declaration per element — no cross-file precedence to reason about.
//
// Every element uses the `CustomEl` base (DetailedHTMLProps) so `key`/`ref` and
// standard HTML attributes are always allowed; the `Extra` generic adds the
// element's own attributes, typed with literal unions where the component
// constrains them.
declare module 'react' {
  namespace JSX {
    type CustomEl<Extra = object> = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Extra;

    interface IntrinsicElements {
      'ody-page-container': CustomEl;
      'ody-tabs': CustomEl<{ tabs?: string; active?: string; size?: string; position?: string }>;
      'ody-button': CustomEl<{ variant?: 'primary' | 'secondary' | 'ghost' | 'tertiary' | 'danger'; size?: 'base' | 'small'; disabled?: boolean }>;
      'ody-card': CustomEl<{ 'bar-color'?: string; 'no-bar'?: boolean; clickable?: boolean }>;
      'ody-loading-spinner': CustomEl<{ size?: 'small' | 'base' | 'large' }>;
      'ody-loading-bar': CustomEl;
      'ody-status-dot': CustomEl<{ color?: 'green' | 'blue' | 'orange' }>;
      'ody-copy-button': CustomEl<{ value?: string; label?: string; 'success-duration'?: number }>;
      'ody-divider': CustomEl;
      'ody-message': CustomEl<{ icon?: string }>;
      'ody-alert': CustomEl<{ variant?: 'info' | 'success' | 'warning' | 'danger'; heading?: string }>;
      'ody-icon': CustomEl<{ name?: string; size?: 'extra-small' | 'mid-small' | 'small' | 'base' | 'medium' | 'large' | 'free' }>;
      'ody-product-indicator': CustomEl<{ name?: string; detail?: string; 'bar-color'?: string; 'text-color'?: string; size?: string; clickable?: boolean; 'indicator-id'?: string }>;
      'ody-stat-summary': CustomEl;
      'ody-stat': CustomEl<{ label?: string; value?: string; sub?: string; tone?: string }>;
      'ody-stat-summary-detail': CustomEl;
      'ody-stat-detail': CustomEl<{ value?: string }>;
      'ody-tag': CustomEl<{ variant?: 'primary' | 'secondary'; color?: string; size?: 'base' | 'small'; icon?: string; count?: string }>;
      'ody-empty-state': CustomEl<{ variant?: 'default' | 'error' | 'no-results' | 'no-search' | 'not-authorized'; label?: string; caption?: string; icon?: string; 'img-src'?: string; 'img-alt'?: string }>;
    }
  }
}

export {};
