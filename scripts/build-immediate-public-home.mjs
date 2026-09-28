import { mkdir, readdir, readFile, copyFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const source = 'dist-immediate';
const target = 'dist-public-home';
const targetPath = resolve(target);
if (!targetPath.startsWith(resolve('.') + sep)) throw Error('PUBLIC_HOME_OUTPUT_OUTSIDE_WORKSPACE');
const html = await readFile(join(source, 'public.html'), 'utf8');
if (!html.includes('/deploy-now/assets/')) throw Error('PUBLIC_ASSET_PATH_MISSING');
await rm(targetPath, { recursive: true, force: true });
await mkdir(join(target, 'assets'), { recursive: true });
await writeFile(join(target, 'index.html'), html.replaceAll('/deploy-now/assets/', '/preview/assets/'));
for (const asset of await readdir(join(source, 'assets'))) {
  await copyFile(join(source, 'assets', asset), join(target, 'assets', asset));
}
console.log('PUBLIC_HOME_BUILT');
