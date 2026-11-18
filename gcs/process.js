// Mark a session as being worked on: sets the session document's state to PROCESSING.
// Called by job.sh when the job actually starts on a session.
// Usage: node process.js <id>        (the id printed by create.js)

const id = process.argv[2];
if (!id) {
  console.error('Usage: node process.js <id>');
  process.exit(2);
}

// Loaded after the argument check, so a usage error doesn't need a key
const { setState, ModelState } = await import('./bucket.js');

try {
  await setState(id, ModelState.PROCESSING);
  console.log(`Processing ${id}`);
} catch (err) {
  console.error('Process failed:', err.message);
  process.exit(1);
}
