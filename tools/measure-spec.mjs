/**
 * Measure what different GmlSpec.xml representations would cost in context.
 *
 * Usage: npx tsx tools/measure-spec.mjs [path/to/GmlSpec.xml]
 */
import { readFileSync } from 'node:fs';

const PATH =
  process.argv[2] ??
  'C:/ProgramData/GameMakerStudio2/Cache/runtimes/runtime-2024.14.4.268/GmlSpec.xml';

const xml = readFileSync(PATH, 'utf8');

// Crude but sufficient extraction for measurement purposes.
const functions = [...xml.matchAll(/<Function\s+([^>]*?)>([\s\S]*?)<\/Function>|<Function\s+([^>]*?)\/>/g)].map(
  (m) => {
    const attrs = m[1] ?? m[3] ?? '';
    const body = m[2] ?? '';
    const attr = (name) => (new RegExp(`${name}="([^"]*)"`).exec(attrs) ?? [])[1] ?? '';
    const params = [...body.matchAll(/<Parameter\s+([^>]*?)>([\s\S]*?)<\/Parameter>|<Parameter\s+([^>]*?)\/>/g)].map(
      (p) => {
        const pa = p[1] ?? p[3] ?? '';
        const pAttr = (name) => (new RegExp(`${name}="([^"]*)"`).exec(pa) ?? [])[1] ?? '';
        return {
          name: pAttr('Name'),
          type: pAttr('Type'),
          optional: pAttr('Optional') === 'true',
          description: (p[2] ?? '').trim(),
        };
      },
    );
    return {
      name: attr('Name'),
      returns: attr('ReturnType'),
      deprecated: attr('Deprecated') === 'true',
      pure: attr('Pure') === 'true',
      description: (/<Description>([\s\S]*?)<\/Description>/.exec(body) ?? [])[1]?.trim() ?? '',
      params,
    };
  },
);

const variables = [...xml.matchAll(/<Variable\s+([^>]*)/g)].length;
const constants = [...xml.matchAll(/<Constant\s+([^>]*)/g)].length;

const signature = (f) =>
  `${f.name}(${f.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')}): ${f.returns}`;

const variants = {
  'raw XML (the file itself)': xml,
  'full: signature + description + param docs': functions
    .map(
      (f) =>
        `${signature(f)}\n  ${f.description}\n${f.params.map((p) => `  @${p.name} ${p.description}`).join('\n')}`,
    )
    .join('\n\n'),
  'signature + one-line description': functions.map((f) => `${signature(f)} — ${f.description}`).join('\n'),
  'signatures only': functions.map(signature).join('\n'),
  'names only': functions.map((f) => f.name).join('\n'),
};

// ~4 chars/token is the usual rough figure for code-like English text.
const tokens = (s) => Math.round(s.length / 4);
const pad = (s, n) => String(s).padEnd(n);
const num = (n) => n.toLocaleString('en-US');

console.log(`functions=${functions.length} variables=${variables} constants=${constants}\n`);
console.log(`${pad('representation', 44)} ${pad('chars', 12)} ${pad('~tokens', 10)}`);
console.log('-'.repeat(70));
for (const [label, text] of Object.entries(variants)) {
  console.log(`${pad(label, 44)} ${pad(num(text.length), 12)} ${pad(num(tokens(text)), 10)}`);
}

const typical = functions.filter((f) => ['instance_create_layer', 'network_create_server_raw', 'buffer_write'].includes(f.name));
console.log('\nwhat a lookup actually returns:');
for (const f of typical) {
  const entry = `${signature(f)}\n  ${f.description}\n${f.params.map((p) => `  @${p.name} ${p.description}`).join('\n')}`;
  console.log(`  ${pad(f.name, 30)} ${pad(num(entry.length) + ' chars', 14)} ~${tokens(entry)} tokens`);
}
