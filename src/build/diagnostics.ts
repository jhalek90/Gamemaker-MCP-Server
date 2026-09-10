/**
 * Turn GameMaker compiler output into located diagnostics.
 *
 * Igor reports errors against the compiler's internal script names rather
 * than file paths:
 *
 *   Error : gml_Object_objCar_Step_0(9) : invalid token @
 *   Error : gml_GlobalScript_scr_nn(123) : unexpected symbol ";" in expression
 *
 * The line number in parentheses is ZERO-based: an error on the first line of
 * a file reports `(0)`. Verified by planting an error at known positions —
 * line 1 reports 0, line 3 reports 2 — independent of line endings. We add one
 * so reported locations match every editor, and match `gml_check`.
 *
 * The script name has to be mapped back to a path, which needs the project's
 * resource list: both object names and event names contain underscores, so
 * `gml_Object_obj_my_thing_Step_0` cannot be split without knowing that
 * `obj_my_thing` is a real object.
 */

import type { GmProject } from '../project/index.js';
import type { ProjectSymbols } from '../project/symbols.js';

export interface BuildDiagnostic {
  severity: 'error' | 'warning';
  /** Project-relative source file, when the script name could be resolved. */
  file?: string;
  /** 1-based line in `file`, converted from the compiler's 0-based number. */
  line?: number;
  /** The compiler's own script name, e.g. `gml_Object_objCar_Step_0`. */
  script: string;
  message: string;
}

/**
 * Errors are not always at the start of a line — the compiler emits things
 * like `Final Compile...Error : gml_GlobalScript_x(12) : ...` — so this
 * deliberately does not anchor.
 */
const DIAGNOSTIC = /\b(Error|Warning)\s*:\s*([A-Za-z0-9_@$]+)\s*\((\d+)\)\s*:\s*([^\r\n]*)/g;

/** A compiler failure with no location, e.g. the asset compiler exiting non-zero. */
const BARE_FAILURE = /^(.*exited with non-zero status.*)$/gm;

export function parseBuildOutput(
  log: string,
  project?: GmProject,
  symbols?: ProjectSymbols,
): BuildDiagnostic[] {
  const objectNames = project
    ? project
        .resources()
        .filter((resource) => resource.kind === 'objects')
        .map((resource) => resource.name)
        // Longest first, so `obj_thing_extra` wins over `obj_thing`.
        .sort((a, b) => b.length - a.length)
    : [];

  const seen = new Set<string>();
  const diagnostics: BuildDiagnostic[] = [];

  for (const match of log.matchAll(DIAGNOSTIC)) {
    const [, severity, script, line, message] = match;
    const key = `${script}:${line}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({
      severity: severity!.toLowerCase() as 'error' | 'warning',
      script: script!,
      // The compiler counts from zero; everything else counts from one.
      line: Number(line) + 1,
      file: resolveScript(script!, objectNames, symbols),
      message: message!.trim(),
    });
  }

  if (diagnostics.length === 0) {
    for (const match of log.matchAll(BARE_FAILURE)) {
      diagnostics.push({ severity: 'error', script: '', message: match[1]!.trim() });
    }
  }
  return diagnostics;
}

/** Map a compiler script name back to a project-relative file. */
export function resolveScript(
  script: string,
  objectNames: readonly string[],
  symbols?: ProjectSymbols,
): string | undefined {
  if (script.startsWith('gml_Object_')) {
    const rest = script.slice('gml_Object_'.length);
    for (const name of objectNames) {
      if (rest.startsWith(`${name}_`)) {
        return `objects/${name}/${rest.slice(name.length + 1)}.gml`;
      }
    }
    return undefined;
  }

  if (script.startsWith('gml_GlobalScript_')) {
    const name = script.slice('gml_GlobalScript_'.length);
    return `scripts/${name}/${name}.gml`;
  }

  // A function inside a script: only the symbol table knows which file.
  if (script.startsWith('gml_Script_')) {
    return symbols?.get(script.slice('gml_Script_'.length))?.file;
  }

  if (script.startsWith('gml_RoomCC_')) {
    const rest = script.slice('gml_RoomCC_'.length);
    const room = rest.replace(/_\d+$/, '');
    return `rooms/${room}/RoomCreationCode.gml`;
  }

  return undefined;
}

/** Human-readable rendering, matching the shape `gml_check` produces. */
export function formatBuildDiagnostics(diagnostics: readonly BuildDiagnostic[]): string {
  if (diagnostics.length === 0) return 'Compiled cleanly.';
  return diagnostics
    .map((diagnostic) => {
      const where = diagnostic.file
        ? `${diagnostic.file}:${diagnostic.line}`
        : diagnostic.script
          ? `${diagnostic.script}(${diagnostic.line})`
          : '<build>';
      return `${where}  ${diagnostic.severity}: ${diagnostic.message}`;
    })
    .join('\n');
}
