// Submit a session: sets the session document's state to SUBMITTED.
// Usage: node submit.js <id>        (the id printed by create.js)

const id = process.argv[2];
if (!id) {
  console.error('Usage: node submit.js <id>');
  process.exit(2);
}

// Loaded after the argument check, so a usage error doesn't need a key
const { setState, ModelState } = await import('./bucket.js');

try {
  await setState(id, ModelState.SUBMITTED);
  console.log(`Submitted ${id}`);
} catch (err) {
  console.error('Submit failed:', err.message);
  process.exit(1);
}
