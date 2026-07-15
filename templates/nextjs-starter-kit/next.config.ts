import type { NextConfig } from "next";

const appHostname = process.env.PEEK_APP_URL
  ? new URL(process.env.PEEK_APP_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  transpilePackages: ['@peektravel/app-utilities'],
  allowedDevOrigins: appHostname
    ? [appHostname, "**.peek.com", "**.connectngo.com", "**.connectngo-*.com", "**.acmeticketing.net", "**.acmeticketing.com"]
    : ["**.peek.com", "**.connectngo.com", "**.connectngo-*.com", "**.acmeticketing.net", "**.acmeticketing.com"],
  async headers() {
    // Peek Pro and ConnectNGo may embed this app. Allow any peek.com /
    // peek.stack / connectngo.com host at any subdomain depth (e.g. foo.peek.com,
    // foo.connectngo.com). A CSP `*.peek.com` host-source matches any number of
    // leading labels, so it covers nested subdomains; the bare hosts cover the apex.
    // frame-ancestors supersedes X-Frame-Options in modern browsers.
    //
    // CNG per-env hosts are listed explicitly: CSP host wildcards are only valid
    // as the leftmost label (`*.host`), so the mid-label `*.connectngo-*.com`
    // cannot be a single source. Envs: staging, demo, qa, training.
    const frameAncestors =
      "frame-ancestors 'self' *.peek.com peek.com *.peek.stack peek.stack " +
      "*.connectngo.com connectngo.com " +
      "*.connectngo-staging.com connectngo-staging.com " +
      "*.connectngo-demo.com connectngo-demo.com " +
      "*.connectngo-qa.com connectngo-qa.com " +
      "*.connectngo-training.com connectngo-training.com " +
      "*.acmeticketing.net acmeticketing.net " +
      "*.acmeticketing.com acmeticketing.com";
    return [
      {
        // Applies to every route, not just the initial embedded entry route.
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: frameAncestors,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
