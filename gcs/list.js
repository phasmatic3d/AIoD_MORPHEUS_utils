// List files in the bucket.
// Usage: node list.js [prefix]      e.g. node list.js folder/
// If the prefix starts with a session id (e.g. node list.js <id>/), the session's
// session document is printed first (state, name, date, ...).
import { bucket, bucketName, db, collection, ModelState } from './bucket.js';

const prefix = process.argv[2] ?? '';

// Firestore auto-generated ids: 20 letters/digits
const sessionId = prefix.split('/')[0];
const isSessionId = /^[A-Za-z0-9]{20}$/.test(sessionId);

const stateName = (s) => Object.keys(ModelState).find((k) => ModelState[k] === s) ?? 'UNKNOWN';

try {
  if (isSessionId) {
    const doc = await db.collection(collection).doc(sessionId).get();
    if (!doc.exists) {
      console.log(`Session ${sessionId}: no session document`);
    } else {
      console.log(`Session ${sessionId}:`);
      const data = doc.data();
      for (const key of Object.keys(data).sort()) {
        const value = key === 'state'
          ? `${data.state} (${stateName(data.state)})`
          : typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key];
        console.log(`  ${key}: ${value}`);
      }
    }
    console.log('');
  }

  const [files] = await bucket.getFiles({ prefix });
  if (files.length === 0) {
    console.log(`(no files in gs://${bucketName}/${prefix})`);
  }
  for (const f of files) {
    const size = String(f.metadata.size ?? '').padStart(12);
    console.log(`${size}  ${f.name}`);
  }
  console.log(`${files.length} file(s)`);
} catch (err) {
  console.error('List failed:', err.message);
  process.exit(1);
}
