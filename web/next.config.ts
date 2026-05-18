import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The repo root has its own package.json + node_modules (for an unrelated
// MCP server), which confuses Turbopack's workspace inference — it walks
// up from web/, hits the parent's node_modules first, and can't find
// tailwindcss. Pinning the workspace root keeps resolution inside web/.
// __dirname isn't reliably defined when Next loads .ts configs, so derive
// from import.meta.url instead.
const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: here,
  },
  outputFileTracingRoot: here,
};

export default nextConfig;
