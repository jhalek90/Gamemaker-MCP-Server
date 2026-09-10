import { GmProject } from './src/project/index.js';
import { checkProject, ProjectSymbols } from './src/project/symbols.js';
import { GmlSpec, requireRuntime } from './src/spec/index.js';
import { formatBuildDiagnostics, IgorRunner } from './src/build/index.js';

const project = GmProject.open('D:/projects/GML_MCP/bridge/mcp_bridge');
const spec = GmlSpec.load(requireRuntime().specPath);

console.log('=== gml_check ===');
const diags = checkProject(project, spec, ProjectSymbols.scan(project));
console.log(diags.length ? diags.map((d) => `  ${d.file}:${d.line}:${d.column} ${d.message}` + (d.suggestions.length ? `  (${d.suggestions.join(', ')})` : '')).join('\n') : '  no unknown identifiers');

console.log('\n=== gml_compile ===');
const result = await IgorRunner.create(project).compile();
console.log(`  ok=${result.ok} exit=${result.exitCode} ${result.durationMs}ms`);
console.log(formatBuildDiagnostics(result.diagnostics).split('\n').map((l) => '  ' + l).join('\n'));
