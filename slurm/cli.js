#!/usr/bin/env node
// Small command line front end for slurm_caller.js.
// Usage:
//   node cli.js submit [input]    submit the job; input = video URL, remote path or session id
//   node cli.js status <jobId>    show the job's Slurm state
import { submitSlurmJob, getSlurmJobState } from './slurm_caller.js';

const [command, arg] = process.argv.slice(2);

try {
    switch (command) {
    case 'submit': {
        const jobId = await submitSlurmJob(arg);
        console.log(jobId);                      // only the id on stdout, easy to capture
        break;
    }
    case 'status': {
        if (!arg) throw new Error('Usage: node cli.js status <jobId>');
        const { state, elapsed, exitCode } = await getSlurmJobState(arg);
        console.log(`${arg}: ${state} (elapsed ${elapsed || '-'}, exit ${exitCode || '-'})`);
        break;
    }
    default:
        console.error('Usage:\n  node cli.js submit [input]\n  node cli.js status <jobId>');
        process.exit(2);
    }
} catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
}
