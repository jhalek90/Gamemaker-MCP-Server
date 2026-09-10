import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatBuildDiagnostics, IgorRunner, parseBuildOutput, resolveScript } from '../src/build/index.js';
import { GmProject } from '../src/project/index.js';
import { findRuntimes } from '../src/spec/index.js';

/** Real Igor output, captured from a 2024.14 runtime. */
const OBJECT_ERROR = `Setting up the Asset compiler
Found Project Format 2
Error : gml_Object_objCar_Step_0(9) : invalid token @
Compile finished
`;

const SCRIPT_ERRORS = `Compiling...
Error : gml_GlobalScript_scr_nn(123) : cannot redeclare a builtin variable
Error : gml_GlobalScript_scr_nn(123) : unexpected symbol ";" in expression
Final Compile...Error : gml_GlobalScript_scr_nn(123) : malformed assignment statement
GMAssetCompiler.dll exited with non-zero status (1)
`;

describe('parsing compiler output', () => {
  it('reads severity, script, line and message', () => {
    const [diagnostic] = parseBuildOutput(OBJECT_ERROR);
    expect(diagnostic).toMatchObject({
      severity: 'error',
      script: 'gml_Object_objCar_Step_0',
      // The compiler reported (9); zero-based, so line 10.
      line: 10,
      message: 'invalid token @',
    });
  });

  it('finds errors that are not at the start of a line', () => {
    // The compiler emits `Final Compile...Error : ...` on one line.
    const messages = parseBuildOutput(SCRIPT_ERRORS).map((d) => d.message);
    expect(messages).toContain('malformed assignment statement');
    expect(messages).toHaveLength(3);
  });

  it('does not report the same diagnostic twice', () => {
    expect(parseBuildOutput(OBJECT_ERROR + OBJECT_ERROR)).toHaveLength(1);
  });

  it('falls back to a bare failure when nothing is located', () => {
    const [diagnostic] = parseBuildOutput('GMAssetCompiler.dll exited with non-zero status (1)');
    expect(diagnostic!.severity).toBe('error');
    expect(diagnostic!.line).toBeUndefined();
    expect(diagnostic!.file).toBeUndefined();
    expect(diagnostic!.message).toContain('non-zero status');
  });

  it('reports nothing for a clean build', () => {
    expect(parseBuildOutput('Igor complete.\n')).toEqual([]);
  });
});

describe('mapping script names to files', () => {
  const objects = ['objCar', 'obj_thing', 'obj_thing_extra'].sort((a, b) => b.length - a.length);

  it('resolves object events', () => {
    expect(resolveScript('gml_Object_objCar_Step_0', objects)).toBe('objects/objCar/Step_0.gml');
    expect(resolveScript('gml_Object_objCar_Collision_objWall', objects)).toBe(
      'objects/objCar/Collision_objWall.gml',
    );
  });

  it('prefers the longest matching object name', () => {
    // Both the object name and the event name contain underscores, so this
    // cannot be split without knowing which objects exist.
    expect(resolveScript('gml_Object_obj_thing_extra_Step_0', objects)).toBe(
      'objects/obj_thing_extra/Step_0.gml',
    );
    expect(resolveScript('gml_Object_obj_thing_Step_0', objects)).toBe(
      'objects/obj_thing/Step_0.gml',
    );
  });

  it('resolves scripts and room creation code', () => {
    expect(resolveScript('gml_GlobalScript_scr_nn', objects)).toBe('scripts/scr_nn/scr_nn.gml');
    expect(resolveScript('gml_RoomCC_Room1_0', objects)).toBe('rooms/Room1/RoomCreationCode.gml');
  });

  it('uses the symbol table for a named function', () => {
    const symbols = { get: (name: string) => (name === 'my_fn' ? { file: 'scripts/a/a.gml' } : undefined) };
    expect(resolveScript('gml_Script_my_fn', objects, symbols as never)).toBe('scripts/a/a.gml');
  });

  it('returns undefined for an unknown shape', () => {
    expect(resolveScript('gml_Object_objMissing_Step_0', objects)).toBeUndefined();
    expect(resolveScript('something_else', objects)).toBeUndefined();
  });
});

describe('formatting', () => {
  it('renders a located diagnostic like gml_check does', () => {
    const project = { resources: () => [{ name: 'objCar', kind: 'objects', path: '' }] };
    const formatted = formatBuildDiagnostics(parseBuildOutput(OBJECT_ERROR, project as never));
    expect(formatted).toBe('objects/objCar/Step_0.gml:10  error: invalid token @');
  });

  it('says so when there is nothing to report', () => {
    expect(formatBuildDiagnostics([])).toBe('Compiled cleanly.');
  });
});

// -- live build -----------------------------------------------------------

const SAMPLE = process.env.GML_MCP_SAMPLE_PROJECT;
const canBuild = SAMPLE !== undefined && findRuntimes().some((runtime) => runtime.igorPath);
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function copyProject(): GmProject {
  const root = mkdtempSync(join(tmpdir(), 'gml-mcp-build-'));
  roots.push(root);
  cpSync(SAMPLE!, root, { recursive: true });
  return GmProject.open(root);
}

describe.skipIf(!canBuild)('live Igor build', () => {
  it('compiles a real project cleanly', async () => {
    const result = await IgorRunner.create(copyProject()).compile();
    expect(result.diagnostics, result.log.slice(-2000)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  }, 600000);

  it('reports a syntax error against the right file and line', async () => {
    const project = copyProject();
    const event = project
      .resources()
      .filter((resource) => resource.kind === 'objects')
      .map((resource) => join(project.root, 'objects', resource.name, 'Step_0.gml'))
      .find((path) => project.readText(path.slice(project.root.length + 1).replace(/\\/g, '/')));
    if (!event) return;

    const original = readFileSync(event, 'utf8');
    const updated = `${original}\nvar broken = ;\n`;
    writeFileSync(event, updated);
    // Derive the expected line from the file we actually wrote, rather than
    // doing trailing-newline arithmetic.
    const lineOfError = updated.split('\n').findIndex((l) => l.includes('var broken')) + 1;

    const result = await IgorRunner.create(project).compile();
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    const located = result.diagnostics.filter((d) => d.file?.endsWith('Step_0.gml'));
    expect(located.length).toBeGreaterThan(0);
    expect(located[0]!.line).toBe(lineOfError);
  }, 600000);

  it('keeps its build artefacts out of the project proper', async () => {
    const project = copyProject();
    const runner = IgorRunner.create(project);
    await runner.compile();
    // Sharing the IDE's cache would make agent and IDE builds collide.
    expect(runner.buildDir).toContain('.gml-mcp');
    expect(project.readText('.gml-mcp/.gitignore')).toBe('*\n');
  }, 600000);
});

describe('line numbering', () => {
  it('converts the compiler zero-based line to a one-based line', () => {
    // Planting an error on physical line 1 makes GameMaker report (0).
    const [first] = parseBuildOutput('Error : gml_Object_o_Step_0(0) : bad');
    expect(first!.line).toBe(1);
    const [third] = parseBuildOutput('Error : gml_Object_o_Step_0(2) : bad');
    expect(third!.line).toBe(3);
  });
});
