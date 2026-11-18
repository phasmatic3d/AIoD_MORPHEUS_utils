// Shared Firebase/GCS setup used by list.js, upload.js, create.js, submit.js, process.js and complete.js.
// Settings come from environment variables:
//   GCS_KEY        path to the service account key (default: ./serviceAccountKey.json next to this file)
//   GCS_BUCKET     bucket name                     (required; copy it from the Firebase Storage page)
//   GCS_COLLECTION Firestore collection of sessions (required)
//
// Uses the modular firebase-admin API (firebase-admin/app, firebase-admin/storage).
// The old `admin.credential.cert(...)` style no longer works with ES module imports
// in current firebase-admin versions.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const keyPath = process.env.GCS_KEY ?? fileURLToPath(new URL('./serviceAccountKey.json', import.meta.url));
export const bucketName = process.env.GCS_BUCKET;
export const collection = process.env.GCS_COLLECTION;

for (const [name, value] of [['GCS_BUCKET', bucketName], ['GCS_COLLECTION', collection]]) {
  if (!value) {
    console.error(`Environment variable ${name} is not set`);
    process.exit(1);
  }
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(await fs.readFile(keyPath, 'utf8'));
} catch (err) {
  console.error(`Could not read service account key at ${keyPath}: ${err.message}`);
  process.exit(1);
}

// Let Google's auth library load the key from this path itself. Passing it
// via cert() makes firebase-admin use the deprecated `credentials` option,
// which prints a deprecation warning in google-auth-library 11+.
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

initializeApp({
  credential: applicationDefault(),
  projectId: serviceAccount.project_id,
  storageBucket: bucketName,
});

export const bucket = getStorage().bucket();
export const db = getFirestore();

// Session states (must match the values the backend uses)
export const ModelState = Object.freeze({ INITIALIZED: 0, SUBMITTED: 1, PROCESSING: 2, COMPLETED: 3 });

// Set a session's state. update() fails with NOT_FOUND if the id doesn't exist.
export const setState = (id, state) => db.collection(collection).doc(id).update({ state });
