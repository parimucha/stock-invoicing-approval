import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The repo root has its own package.json + node_modules (for an unrelated
// MCP server), which confuses Turbopack's workspace inference locally —
// it walks up from web/, hits the parent's node_modules first, and can't
// find tailwindcss. Pinning the workspace root keeps Turbopack resolution
// inside web/. __dirname isn't reliably defined when Next loads .ts
// configs as ESM, so derive from import.meta.url.
//
// Do NOT also set `outputFileTracingRoot` here — on Vercel (Root Directory
// = web/) it confuses the build adapter into looking for the routes
// manifest at /vercel/path0/.next/ instead of /vercel/path0/web/.next/
// and the deploy fails with ENOENT.
const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: here,
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "stock-invoicing-approval-app",

  project: "sentry-cobalt-bridge",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
