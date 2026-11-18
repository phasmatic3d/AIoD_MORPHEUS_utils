# Google Cloud Services utilities

Node.js command line tools for the Firebase / Google Cloud Storage bucket and for the
Firestore documents that track each session. They are used in two places:

- **Client side:** create a session, upload its input video and submit it.
- **On the compute node:** [`../sbatch/job.sh`](../sbatch/README.md) uses them to fetch the
  input onto the node, upload the results, and set the session state.

## Install

Needs Node.js 18 or newer.

```bash
cd gcs
npm ci            # installs the exact versions from package-lock.json
```

## Configure

| Variable | Required | Meaning |
|---|---|---|
| `GCS_KEY` | no | Path to the service account key JSON. Default: `serviceAccountKey.json` next to `bucket.js`. |
| `GCS_BUCKET` | yes | Bucket name, e.g. `your-project-id.firebasestorage.app` (Firebase console → Storage). |
| `GCS_COLLECTION` | yes | Firestore collection that holds the session documents. |
| `GCS_OWNER` | `create.js` only | User id written as the owner of new sessions. |

```bash
# Linux / macOS
export GCS_KEY=~/.gcs/serviceAccountKey.json
export GCS_BUCKET=your-project-id.firebasestorage.app
export GCS_COLLECTION=your-collection
export GCS_OWNER=your-user-id
```

```powershell
# Windows PowerShell
$env:GCS_KEY = "$HOME\.gcs\serviceAccountKey.json"
$env:GCS_BUCKET = "your-project-id.firebasestorage.app"
$env:GCS_COLLECTION = "your-collection"
$env:GCS_OWNER = "your-user-id"
```

Keep the key outside the repository, or at least out of anything you share.
`.gitignore` only protects it inside a git repository.

## Tools

| Script | Purpose |
|---|---|
| `bucket.js` | Shared setup: reads the key and the settings, connects to Storage and Firestore. |
| `create.js <name>` | Creates a session document (INITIALIZED) and `<id>/index.json`. Prints only the id. |
| `submit.js <id>` | Sets the session to SUBMITTED. |
| `process.js <id>` | Sets the session to PROCESSING. `job.sh` calls it when the job starts. |
| `complete.js <id>` | Sets the session to COMPLETED. `job.sh` calls it after a successful upload. |
| `list.js [prefix]` | Lists files. If the prefix is a session id, shows the session document first. |
| `upload.js <file-or-folder> [prefix] [newName]` | Uploads a file or a folder (recursively). |
| `fetch.js <path-or-folder> [localDir]` | Downloads a file or a folder (recursively). Overwrites local files. |

Session states: `INITIALIZED (0) → SUBMITTED (1) → PROCESSING (2) → COMPLETED (3)`.

## Examples

```bash
ID=$(node create.js "My model")        # new session
node upload.js video.mp4 "$ID"         # -> <id>/video.mp4
node submit.js "$ID"
node list.js "$ID/"                    # session document + its files

node upload.js some/folder folder/run1 # folder contents -> folder/run1/<files>
node fetch.js folder/run1 out          # folder -> out/<files under folder/run1/>
node fetch.js "$ID/model.glb"          # single file -> ./model.glb
```
