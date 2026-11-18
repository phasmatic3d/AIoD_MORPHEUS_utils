// Upload a file or a whole folder (recursively) to the bucket.
// Usage: node upload.js <file-or-folder> [destPrefix] [newName]
//   node upload.js mesh/ folder/run1      -> folder/run1/<files in mesh>
//   node upload.js video.mp4 videos         -> videos/video.mp4
//   node upload.js video.mp4 videos 1.mp4   -> videos/1.mp4   (rename; single files only)
import fs from 'fs/promises';
import path from 'path';

const [localPath, destPrefix = '', newName] = process.argv.slice(2);
if (!localPath) {
  console.error('Usage: node upload.js <file-or-folder> [destPrefix] [newName]');
  process.exit(2);
}

// Loaded after the argument check, so a usage error doesn't need a key
const { bucket, bucketName } = await import('./bucket.js');

async function listFiles(p) {
  const stat = await fs.stat(p);
  if (!stat.isDirectory()) return [p];
  const entries = await fs.readdir(p, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => listFiles(path.join(p, e.name))));
  return nested.flat();
}

try {
  const root = path.resolve(localPath);
  const isDir = (await fs.stat(root)).isDirectory();
  if (isDir && newName) {
    console.error('newName only works when uploading a single file, not a folder');
    process.exit(2);
  }
  const files = await listFiles(root);

  for (const file of files) {
    // Bucket paths always use "/", also when running on Windows
    const rel = newName ?? (isDir ? path.relative(root, file) : path.basename(file)).split(path.sep).join('/');
    const dest = path.posix.join(destPrefix, rel);
    await bucket.upload(file, { destination: dest });
    console.log(`Uploaded ${file} -> gs://${bucketName}/${dest}`);
  }
  console.log(`Done: ${files.length} file(s)`);
} catch (err) {
  console.error('Upload failed:', err.message);
  process.exit(1);
}
