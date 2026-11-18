// Mark a session as finished: sets the session document's state to COMPLETED.
// Usage: node complete.js <id>        (the id printed by create.js)

const id = process.argv[2];
if (!id) {
  console.error('Usage: node complete.js <id>');
  process.exit(2);
}

// Loaded after the argument check, so a usage error doesn't need a key
const { setState, ModelState } = await import('./bucket.js');

try {
  await setState(id, ModelState.COMPLETED);
  console.log(`Completed ${id}`);
} catch (err) {
  console.error('Complete failed:', err.message);
  process.exit(1);
}
