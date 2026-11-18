# slurm: submit and track jobs over SSH

A small Node.js library and CLI that submit the [`job.sh`](../sbatch/README.md) batch script
on a MeluXina login node over SSH (`sbatch`) and look up a job's state (`sacct`).
This lets an external service start cluster jobs without anyone logging in by hand.

| File | Purpose |
|---|---|
| `slurm_caller.js` | Library: `runRemoteCommand`, `submitSlurmJob`, `getSlurmJobState` |
| `cli.js` | Command line front end |
| `.env.example` | Template for the environment variables |

## Install

Needs Node.js 18 or newer (20.6+ for `--env-file`).

```bash
cd slurm
npm ci
```

## Configure

All site-specific values come from environment variables. Nothing is hardcoded.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `MLUX_HOST` | yes | | SSH login host |
| `MLUX_PORT` | no | `8822` | SSH port |
| `MLUX_USER` | yes | | SSH user name |
| `MLUX_KEY` | see Auth | | Path to the private key file |
| `MLUX_KEY_PASSPHRASE` | no | | Passphrase for `MLUX_KEY` |
| `MLUX_REMOTE_DIR` | yes | | Remote folder the job is submitted from |
| `MLUX_JOB_SCRIPT` | yes | | Job script, relative to `MLUX_REMOTE_DIR` |

The easiest way is a `.env` file (git-ignored):

```bash
cp .env.example .env      # then fill it in
node --env-file=.env cli.js submit <session-id>
```

**Auth** is chosen in this order:

1. `MLUX_KEY` and `MLUX_KEY_PASSPHRASE` are both set: the key file is decrypted.
2. An ssh-agent is running (`SSH_AUTH_SOCK`, or the Windows OpenSSH agent): its unlocked key is used.
3. Only `MLUX_KEY` is set: it is used as an unencrypted key file.

Prefer ssh-agent over `MLUX_KEY_PASSPHRASE`. Environment variables can be seen by other
processes of the same user and can end up in shell history.

## Use

```bash
JOB=$(node cli.js submit <session-id>)   # prints only the Slurm job id
node cli.js status "$JOB"                # e.g. "123456: RUNNING (elapsed 00:03:12, exit 0:0)"
```

`input` (session id, video URL or path on the cluster) is passed to the job script as its
first argument. Without it, the script's default input is used.

From code:

```js
import { submitSlurmJob, getSlurmJobState } from './slurm_caller.js';

const jobId = await submitSlurmJob(sessionId);
const { state, elapsed, exitCode } = await getSlurmJobState(jobId);
```
