import path from "node:path";
import { fileURLToPath } from "node:url";

// The repo root has its own package.json + node_modules (MCP server, no
// tailwind). @tailwindcss/postcss defaults its base to process.cwd(), and
// something in the Next 16 / Turbopack pipeline is starting it at the
// parent — so the plugin walks up from there and never sees
// web/node_modules. Pin base to this config file's directory.
const here = path.dirname(fileURLToPath(import.meta.url));

const config = {
  plugins: {
    "@tailwindcss/postcss": {
      base: here,
    },
  },
};

export default config;
