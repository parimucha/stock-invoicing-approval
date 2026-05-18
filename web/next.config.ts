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

export default nextConfig;
