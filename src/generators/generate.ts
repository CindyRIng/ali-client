/**
 * 契约生成：spec/openapi.json / spec/mcp-tools.json / spec/cli-commands.json / spec/operations/*.json
 *
 * 用法：npm run gen / npm run gen:check
 */
import fs from 'node:fs';
import path from 'node:path';
import { OPERATIONS } from '../api/operations.js';
import { buildCliCommands, buildMcpTools, buildOpenApi } from './openapi.js';
import { toJsonSchema } from './json-schema.js';

const ROOT = process.cwd();
const SPEC_DIR = path.join(ROOT, 'spec');

interface GeneratedFile {
  file: string;
  content: string;
}

function buildFiles(): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  files.push({ file: 'openapi.json', content: JSON.stringify(buildOpenApi(), null, 2) + '\n' });
  files.push({ file: 'mcp-tools.json', content: JSON.stringify(buildMcpTools(), null, 2) + '\n' });
  files.push({ file: 'cli-commands.json', content: JSON.stringify(buildCliCommands(), null, 2) + '\n' });
  for (const op of OPERATIONS) {
    const content = {
      id: op.id,
      summary: op.summary,
      auth: op.auth,
      rest: {
        method: op.rest.method,
        path: op.rest.path,
        ...(op.rest.pathParams ? { pathParams: toJsonSchema(op.rest.pathParams, 'input') } : {}),
        ...(op.rest.query ? { query: toJsonSchema(op.rest.query, 'input') } : {}),
        ...(op.rest.body ? { body: toJsonSchema(op.rest.body, 'input') } : {}),
      },
      cli: op.cli,
      mcp: op.mcp,
      input: toJsonSchema(op.input, 'input'),
      output: toJsonSchema(op.output, 'output'),
    };
    files.push({ file: path.join('operations', `${op.id}.json`), content: JSON.stringify(content, null, 2) + '\n' });
  }
  return files;
}

function writeFiles(files: GeneratedFile[], check: boolean): boolean {
  let ok = true;
  for (const f of files) {
    const target = path.join(SPEC_DIR, f.file);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (check) {
      if (current !== f.content) {
        console.error(`[gen:check] out of date: ${path.relative(ROOT, target)}`);
        ok = false;
      }
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content);
  }
  if (!check) console.log(`generated ${files.length} spec files into ${path.relative(ROOT, SPEC_DIR)}/`);
  return ok;
}

function main(): void {
  const check = process.argv.includes('--check');
  const files = buildFiles();
  const ok = writeFiles(files, check);
  if (check && !ok) process.exit(1);
}

main();
