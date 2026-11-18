# sbatch: the Slurm job script

`job.sh` is the batch script that runs on a MeluXina GPU node. It is submitted with
`sbatch`, by hand or through [`../slurm`](../slurm/README.md), and does the whole
stage-in / compute / stage-out cycle:

1. Works out the input type: video URL, file on the cluster, or session id.
2. Makes sure the [`gcs`](../gcs/README.md) tools are installed (runs `npm ci` if needed).
3. **Stages the input onto the node:** downloads the URL (max 200 MB), copies the file, or fetches
   the session's video from the bucket and marks the session PROCESSING.
4. Runs the pipeline inside an Apptainer image on the allocated GPU.
5. **Stages the results out:** uploads the first `.fbx` and `.glb` it finds to the bucket as
   `model.fbx` and `model.glb`.
6. Marks the session COMPLETED, but only if the pipeline succeeded and both uploads worked.

## Install on the cluster

```
$PROJECT_WORKDIR/
├── job.sh                    this script
├── gcs/                      the gcs tools + service account key
├── <image>.sif               the Apptainer image
└── data/                     created per job (see below)
```

Edit the `#SBATCH` header for your project, or pass the values on the command line
(command line options override the header):

```bash
sbatch --account=p123456 --job-name=myjob job.sh <input>
```

## Configure

All settings come from environment variables. `sbatch` passes the submitting shell's
environment to the job, so set them in your shell profile on the cluster (e.g. `~/.bashrc`).
That way they are also there when [`../slurm`](../slurm/README.md) submits over SSH.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `PROJECT_WORKDIR` | yes | | Base folder of the project on the cluster |
| `PROJECT_SIF` | yes | | Path to the Apptainer image |
| `GCS_BUCKET` | yes | | Bucket name |
| `GCS_COLLECTION` | yes | | Firestore collection of sessions |
| `GCS_KEY` | no | `$PROJECT_GCS_DIR/serviceAccountKey.json` | Service account key |
| `PROJECT_GCS_DIR` | no | `$PROJECT_WORKDIR/gcs` | Folder with the gcs tools |
| `PROJECT_DATA_DIR` | no | `$PROJECT_WORKDIR/data` | Where per-job folders are created |
| `PROJECT_DEFAULT_INPUT` | no | | Input used when no argument is given |

The image is currently configured for the specific input requirements of the MORPHEUS project, so please adjust accordingly.

## Run

```bash
sbatch job.sh <session-id>                       # results -> <id>/model.fbx, model.glb
sbatch job.sh https://example.com/video.mp4      # results -> <job>/model.fbx, model.glb
sbatch job.sh /path/on/cluster/video.mp4
```

Each job gets its own folder `$PROJECT_DATA_DIR/<job-name>_<job-id>/`:

| Subfolder | Contents |
|---|---|
| `video/` | the staged input |
| `mesh/` | the pipeline output |
| `log/` | the Slurm output file and the pipeline log |

The script refuses to run outside Slurm, and it stops early if a required variable
or the image is missing.
