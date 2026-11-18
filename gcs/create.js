// Create a new model session:
//   - adds a document to the Firestore sessions collection (state INITIALIZED)
//   - writes <id>/index.json to the bucket
// Prints ONLY the new id on stdout, so a shell script can capture it:
//   ID=$(node create.js "My model") || exit 1
// Usage: node create.js <name>
// The owner user id comes from the GCS_OWNER environment variable (required).

const name = process.argv[2];
if (!name) {
  console.error('Usage: node create.js <name>');
  process.exit(2);
}

const user = process.env.GCS_OWNER;
if (!user) {
  console.error('Environment variable GCS_OWNER is not set');
  process.exit(2);
}

// Loaded after the argument checks, so a usage error doesn't need a key
const { bucket, db, collection, ModelState } = await import('./bucket.js');

try {
  const date = new Date().toUTCString();
  const docRef = await db.collection(collection).add({
    downloads: 0,
    name,
    rating: 0,
    reconstruction_time: 0,
    state: ModelState.INITIALIZED,
    date,
    user,
    filenames: ['index.json'],
  });

  await bucket.file(`${docRef.id}/index.json`).save(JSON.stringify({ user, date }), {
    contentType: 'application/octet-stream',
  });

  console.log(docRef.id);
} catch (err) {
  console.error('Create failed:', err.message);
  process.exit(1);
}
