const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, ListToolsResultSchema, CallToolRequestSchema, CallToolResultSchema } = require("@modelcontextprotocol/sdk/types.js");

const UPSTREAM_URL = "https://ai.databy.io/mcp";
const TOKEN = process.env.DATABY_TOKEN;
const ALLOW_REGEX_STR = process.argv[2] || ".*";
const ALLOW_REGEX = new RegExp(ALLOW_REGEX_STR);

async function main() {
  // Use mcp-remote as the upstream driver because it handles the SSE/Auth handshake reliably
  const transport = new StdioClientTransport({
      command: "npx",
      args: [
          "-y",
          "mcp-remote",
          UPSTREAM_URL,
          "--header",
          `Authorization: Bearer ${TOKEN}`
      ],
      env: {
          ...process.env,
          // Ensure mcp-remote uses a writable directory for its internal configuration
          HOME: "/tmp/mcp-home",
          // Ensure npx doesn't use the restricted global cache
          npm_config_cache: "/tmp/npm-cache"
      }
  });

  const client = new Client({ name: "databy-partition-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const server = new Server({
    name: `databy-partition-server-${ALLOW_REGEX_STR.replace(/[^a-z0-9]/gi, "_")}`,
    version: "1.0.0"
  }, {
    capabilities: { tools: {} }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await client.request({ method: "tools/list" }, ListToolsResultSchema);
    const filteredTools = result.tools.filter(t => ALLOW_REGEX.test(t.name));
    return { tools: filteredTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await client.request({
      method: "tools/call",
      params: request.params
    }, CallToolResultSchema);
  });

  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
}

main().catch(err => {
    console.error("Fatal proxy error:", err);
    process.exit(1);
});
