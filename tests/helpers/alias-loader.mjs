// Maps the Next.js "@/*" import alias (see jsconfig.json) onto the project
// root so plain-Node scripts and `node --test` can import the exact same
// modules the app uses — no duplicated test-only copies of production code.
//
// Next's resolver supports extension and directory-index guessing; plain ESM
// does not, so this loader reproduces both behaviours:
//   @/lib/repo           -> lib/repo/index.js   (directory import)
//   @/lib/demo-data      -> lib/demo-data.js    (extension guessing)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(process.cwd());

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context);

  const rel = specifier.slice(2);
  const exact = path.join(ROOT, rel);

  let target = exact;
  if (!path.extname(rel)) {
    if (fs.existsSync(`${exact}.js`)) target = `${exact}.js`;
    else if (fs.existsSync(path.join(exact, 'index.js'))) target = path.join(exact, 'index.js');
  }

  return nextResolve(pathToFileURL(target).href, context);
}
