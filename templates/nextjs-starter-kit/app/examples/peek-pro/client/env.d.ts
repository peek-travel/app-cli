import 'react';

declare module 'react' {
  namespace JSX {
    // Base type that includes key/ref alongside standard HTML attributes.
    type CustomEl<Extra = object> = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Extra;

    interface IntrinsicElements {
      'ody-page-container': CustomEl;
      'ody-tabs': CustomEl<{ tabs?: string; active?: string; size?: string; position?: string }>;
      'ody-button': CustomEl<{ variant?: string; disabled?: boolean }>;
      'ody-card': CustomEl<{ 'bar-color'?: string; 'no-bar'?: boolean; clickable?: boolean }>;
      'ody-loading-spinner': CustomEl<{ size?: string }>;
      'ody-status-dot': CustomEl<{ color?: string }>;
      'ody-copy-button': CustomEl<{ value?: string; label?: string }>;
      'ody-divider': CustomEl;
      'ody-message': CustomEl<{ icon?: string }>;
      'ody-alert': CustomEl<{ variant?: string; heading?: string }>;
      'ody-product-indicator': CustomEl<{ name?: string; detail?: string; 'bar-color'?: string; 'text-color'?: string; size?: string; clickable?: boolean; 'indicator-id'?: string }>;
      'ody-stat-summary': CustomEl;
      'ody-stat': CustomEl<{ label?: string; value?: string; sub?: string; tone?: string }>;
      'ody-stat-summary-detail': CustomEl;
      'ody-stat-detail': CustomEl<{ value?: string }>;
      'ody-tag': CustomEl<{ variant?: string; color?: string; size?: string; icon?: string; count?: string }>;
      'ody-empty-state': CustomEl<{ variant?: string; label?: string; caption?: string; icon?: string; 'img-src'?: string; 'img-alt'?: string }>;
    }
  }
}

export {};
