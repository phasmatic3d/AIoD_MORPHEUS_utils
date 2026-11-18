import { Client } from 'ssh2';
import fsSync from 'fs';

// All connection details come from environment variables (see .env.example / README.md).
//   MLUX_HOST            SSH host                                   (required)
//   MLUX_PORT            SSH port                                   (default 8822)
//   MLUX_USER            SSH user name                              (required)
//   MLUX_KEY             path to the private key file               (required unless using ssh-agent)
//   MLUX_KEY_PASSPHRASE  passphrase for MLUX_KEY                    (optional)
//   MLUX_REMOTE_DIR      remote project folder to cd into           (required)
//   MLUX_JOB_SCRIPT      job script, relative to MLUX_REMOTE_DIR    (required)

const required = (name) => {
    const value = process.env[name];
    if (!value) throw new Error(`Environment variable ${name} is not set`);
    return value;
};

// Read lazily, so importing this module never throws; errors show up when a call is made.
export const getConfig = () => Object.freeze({
    host: required('MLUX_HOST'),
    port: Number(process.env.MLUX_PORT ?? 8822),
    username: required('MLUX_USER'),
    keyPath: process.env.MLUX_KEY,
    passphrase: process.env.MLUX_KEY_PASSPHRASE,
    remoteDir: required('MLUX_REMOTE_DIR'),
    jobScript: required('MLUX_JOB_SCRIPT'),
});

// Quote a value for the remote bash shell: 'it'\''s' style.
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Auth, in this order:
//   1. MLUX_KEY + MLUX_KEY_PASSPHRASE -> decrypt the key file
//   2. ssh-agent (SSH_AUTH_SOCK, or the Windows OpenSSH agent pipe) -> already-unlocked key
//   3. MLUX_KEY alone -> unencrypted key file
const getAuthOptions = (config) => {
    const readKey = () => {
        try {
            return fsSync.readFileSync(config.keyPath);
        } catch (err) {
            throw new Error(`Cannot read SSH key at ${config.keyPath}: ${err.message}`);
        }
    };

    if (config.passphrase) {
        if (!config.keyPath) throw new Error('MLUX_KEY_PASSPHRASE is set but MLUX_KEY is not');
        return { privateKey: readKey(), passphrase: config.passphrase };
    }

    const agent = process.env.SSH_AUTH_SOCK
        ?? (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined);
    if (agent) return { agent };

    if (config.keyPath) return { privateKey: readKey() };

    throw new Error('No SSH auth available: set MLUX_KEY (and MLUX_KEY_PASSPHRASE if it has one), or run ssh-agent with the key added');
};

// Run a single command on the remote host. Resolves with { code, stdout, stderr }.
export const runRemoteCommand = (command, { timeoutMs = 30_000 } = {}) => new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        conn.end();
        fn(value);
    };

    const timer = setTimeout(() => finish(reject, new Error(`SSH command timed out after ${timeoutMs} ms: ${command}`)), timeoutMs);

    let config, auth;
    try {
        config = getConfig();
        auth = getAuthOptions(config);
    } catch (err) {
        return finish(reject, err);
    }

    conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
            if (err) return finish(reject, err);
            stream
                .on('close', (code) => finish(resolve, { code, stdout, stderr }))
                .on('data', (d) => { stdout += d; })
                .stderr.on('data', (d) => { stderr += d; });
        });
    });

    conn.on('error', (err) => finish(reject, err));

    try {
        conn.connect({
            host: config.host,
            port: config.port,
            username: config.username,
            readyTimeout: 20_000,
            ...auth,
        });
    } catch (err) {
        finish(reject, err);
    }
});

// Submit the job via sbatch. `input` is passed to the job script as its
// first argument. Resolves with the Slurm job ID.
export const submitSlurmJob = async (input) => {
    const { remoteDir, jobScript } = getConfig();
    const args = input ? ` ${shQuote(input)}` : '';
    const { code, stdout, stderr } = await runRemoteCommand(
        `cd ${shQuote(remoteDir)} && sbatch ${shQuote(jobScript)}${args}`
    );

    if (code !== 0) {
        throw new Error(`sbatch failed (exit ${code}): ${stderr.trim() || stdout.trim()}`);
    }

    const match = stdout.match(/Submitted batch job (\d+)/);
    if (!match) {
        throw new Error(`Unexpected sbatch output: ${stdout.trim()}`);
    }

    return match[1];
};

// Look up a job's Slurm state (PENDING, RUNNING, COMPLETED, FAILED, ...).
// Uses sacct, which also knows about jobs that have already finished.
export const getSlurmJobState = async (jobId) => {
    if (!/^\d+$/.test(String(jobId))) throw new Error(`Invalid job id: ${jobId}`);
    const { code, stdout, stderr } = await runRemoteCommand(
        `sacct -j ${jobId} -X -n -P --format=State,Elapsed,ExitCode`
    );
    if (code !== 0) {
        throw new Error(`sacct failed (exit ${code}): ${stderr.trim() || stdout.trim()}`);
    }
    const line = stdout.trim().split('\n')[0];
    if (!line) return { state: 'UNKNOWN', elapsed: '', exitCode: '' };
    const [state, elapsed, exitCode] = line.split('|');
    return { state, elapsed, exitCode };
};
