#!/usr/bin/env node
/**
 * Entry point. The project root comes from argv or GML_MCP_PROJECT; if neither
 * is given, the current directory is used.
 *
 * Nothing is written to stdout except the MCP protocol itself — stdio is the
 * transport, so diagnostics go to stderr.
 */

import { resolve } from 'node:path';
import { GmProject } from '../project/index.js';
import { runStdioServer } from './server.js';

function parseArgs(argv: string[]): { projectRoot: string } {
  const args = argv.slice(2);
  let projectRoot = process.env.GML_MCP_PROJECT ?? process.cwd();
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--project' || args[i] === '-p') && args[i + 1]) projectRoot = args[++i]!;
    else if (args[i]!.startsWith('--project=')) projectRoot = args[i]!.slice('--project='.length);
    else if (!args[i]!.startsWith('-')) projectRoot = args[i]!;
  }
  return { projectRoot: resolve(projectRoot) };
}

const { projectRoot } = parseArgs(process.argv);

try {
  // Fail loudly at startup rather than on the first tool call.
  const project = GmProject.open(projectRoot);
  process.stderr.write(`gml-mcp: ${project.name} (${project.resources().length} resources)\n`);
} catch (error) {
  process.stderr.write(
    `gml-mcp: cannot open a GameMaker project at ${projectRoot}\n` +
      `  ${(error as Error).message}\n` +
      '  Pass --project <path> or set GML_MCP_PROJECT.\n',
  );
  process.exit(1);
}

runStdioServer({ projectRoot }).catch((error: unknown) => {
  process.stderr.write(`gml-mcp: ${(error as Error).message}\n`);
  process.exit(1);
});
