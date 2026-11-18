// Download a file or a whole folder (recursively) from the bucket.
// Usage: node fetch.js <bucket-path-or-folder> [localDir]
//   node fetch.js videos/video.mp4            -> ./video.mp4
//   node fetch.js videos/video.mp4 downloads  -> downloads/video.mp4
//   node fetch.js folder/run1 mesh          -> mesh/<files under folder/run1/>
// Existing local files with the same name are overwritten.
import fs from 'fs/promises';
import path from 'path';

const [remotePath, localDir = '.'] = process.argv.slice(2);
if (!remotePath) {
  console.error('Usage: node fetch.js <bucket-path-or-folder> [localDir]');
  process.exit(2);
}

// Loaded after the argument check, so a usage error doesn't need a key
const { bucket, bucketName } = await import('./bucket.js');

// Turn a bucket object name into a local path under root, refusing names
// (e.g. containing "..") that would land outside it.
function localPathFor(root, rel) {
  const target = path.resolve(root, ...rel.split('/'));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside ${root}: ${rel}`);
  }
  return target;
}

async function download(file, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await file.download({ destination: target });
  console.log(`Downloaded gs://${bucketName}/${file.name} -> ${target}`);
}

try {
  const root = path.resolve(localDir);
  const single = bucket.file(remotePath);
  const [isFile] = remotePath.endsWith('/') ? [false] : await single.exists();

  if (isFile) {
    await download(single, localPathFor(root, path.posix.basename(remotePath)));
    console.log('Done: 1 file(s)');
  } else {
    // Treat it as a folder: everything under "<remotePath>/"
    const prefix = remotePath.endsWith('/') ? remotePath : `${remotePath}/`;
    const [files] = await bucket.getFiles({ prefix });
    // Skip zero-byte "folder" placeholder objects that end in "/"
    const real = files.filter((f) => !f.name.endsWith('/'));
    if (real.length === 0) {
      console.error(`Nothing found at gs://${bucketName}/${remotePath}`);
      process.exit(1);
    }
    for (const f of real) {
      await download(f, localPathFor(root, f.name.slice(prefix.length)));
    }
    console.log(`Done: ${real.length} file(s)`);
  }
} catch (err) {
  console.error('Fetch failed:', err.message);
  process.exit(1);
}
