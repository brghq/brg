import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { contextCommit, contextDiff, contextMerge, contextSearch } from '../mcp/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

/**
 * Builds brg's MCP server with its four tools registered — split out from
 * `mcpCommand` so tests can connect to it via an in-memory transport
 * instead of spawning a real stdio subprocess. Deliberately a small,
 * four-tool surface per the design doc: each tool is a thin wrapper over
 * src/mcp/tools.ts, which does the actual work against the same
 * versioning data brg branch/diff/merge/checkpoint already use — no
 * separate data path.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'brg', version: pkg.version });

  server.registerTool(
    'context_search',
    {
      description: "Query a brg branch's intent, summary, facts, and recent checkpoints. Defaults to the currently active branch.",
      inputSchema: {
        branch: z.string().optional().describe('Branch name; defaults to the currently active brg branch'),
        query: z.string().optional().describe('Optional text filter matched against fact subject/relation/object'),
      },
    },
    async (input) => textResult(contextSearch(input)),
  );

  server.registerTool(
    'context_commit',
    {
      description: 'Record a checkpoint on a brg branch, like `brg checkpoint`. Defaults to the currently active branch.',
      inputSchema: {
        message: z.string().describe('Checkpoint message'),
        branch: z.string().optional().describe('Branch name; defaults to the currently active brg branch'),
        tool: z.string().optional().describe('Tool name to attribute this checkpoint to'),
      },
    },
    async (input) => textResult(contextCommit(input)),
  );

  server.registerTool(
    'context_diff',
    {
      description: 'Structural diff of two branches\' facts (added/removed/changed triples). No LLM involved.',
      inputSchema: {
        branchA: z.string(),
        branchB: z.string(),
      },
    },
    async (input) => textResult(contextDiff(input)),
  );

  server.registerTool(
    'context_merge',
    {
      description:
        'Attempt to merge a branch into the target (defaults to the currently active branch). Facts with no conflict merge automatically. ' +
        'Real conflicts are returned as data instead of being resolved — call again with `resolutions` filled in (subject, relation, choice: ' +
        '"target"|"source"|"both") to finish the merge.',
      inputSchema: {
        source: z.string().describe('Branch to merge from'),
        target: z.string().optional().describe('Branch to merge into; defaults to the currently active brg branch'),
        tool: z.string().optional().describe('Tool name to attribute the merge checkpoint to'),
        resolutions: z
          .array(
            z.object({
              subject: z.string(),
              relation: z.string(),
              choice: z.enum(['target', 'source', 'both']),
            }),
          )
          .optional()
          .describe('Resolutions for conflicts returned by a prior call'),
      },
    },
    async (input) => textResult(contextMerge(input)),
  );

  return server;
}

/**
 * Starts brg's MCP server over stdio — the standard way a local MCP
 * server is consumed (an MCP client spawns this command as a subprocess
 * and talks to it over stdin/stdout).
 */
export async function mcpCommand(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
