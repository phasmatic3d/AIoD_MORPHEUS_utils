#!/bin/bash -l
#SBATCH --account=pXXXXXX
#SBATCH --job-name=<job-name>
#SBATCH --partition=gpu
#SBATCH --qos=short
#SBATCH --nodes=1
#SBATCH --gpus=1
#SBATCH --time=00:30:00
#SBATCH --output=slurm-%j.out
# (#SBATCH lines must come before any command.

# ==== SETTINGS, all from environment variables ==============================
#   PROJECT_WORKDIR        base folder of the project on the cluster   (required)
#   GCS_BUCKET             bucket name                                 (required)
#   GCS_COLLECTION         Firestore collection of sessions            (required)
#   GCS_KEY                service account key file    (default: $PROJECT_GCS_DIR/serviceAccountKey.json)
#   PROJECT_GCS_DIR        folder with package.json, bucket.js, ...    (default: $PROJECT_WORKDIR/gcs)
#   PROJECT_DATA_DIR       where per-job folders are created           (default: $PROJECT_WORKDIR/data)
#   PROJECT_SIF            Apptainer image                             (required)
#   PROJECT_DEFAULT_INPUT  input used when no argument is given        (optional)
for VAR in PROJECT_WORKDIR GCS_BUCKET GCS_COLLECTION PROJECT_SIF; do
    if [[ -z "${!VAR}" ]]; then
        echo "Error: environment variable $VAR is not set" >&2
        exit 1
    fi
done
WORKDIR="$PROJECT_WORKDIR"
GCS_DIR="${PROJECT_GCS_DIR:-$WORKDIR/gcs}"
DATA_DIR="${PROJECT_DATA_DIR:-$WORKDIR/data}"
SIF="$PROJECT_SIF"
[[ -f "$SIF" ]] || { echo "Error: Apptainer image not found: $SIF" >&2; exit 1; }
DEFAULT_INPUT="${PROJECT_DEFAULT_INPUT:-}"
export GCS_BUCKET
export GCS_KEY="${GCS_KEY:-$GCS_DIR/serviceAccountKey.json}"
# ============================================================================

# Usage: sbatch job.sh [video URL | path on the cluster | session id]
#   URL or path: run on the video and upload generated model files
#   session id: fetch the video from <id>/ in the bucket, mark the
#     session PROCESSING, run, upload <id>/model.fbx + model.glb, then mark it COMPLETED

# ---- Refuse to run outside Slurm ----
if [[ -z "$SLURM_JOB_ID" ]]; then
    echo "Error: submit this script with sbatch, not sh/bash" >&2
    exit 1
fi

# ---- General settings ----
MAX_DOWNLOAD_MB=200                                     # max size of a downloaded input video
VIDEO_EXT_RE='\.(mp4|mov|m4v|avi|mkv|webm)$'            # what counts as a video in a session folder

# ---- Arguments: work out what the input type is ----
INPUT="${1:-$DEFAULT_INPUT}"
if [[ -z "$INPUT" ]]; then
    echo "Error: no input given (pass a URL, path or session id, or set PROJECT_DEFAULT_INPUT)" >&2
    exit 1
fi
SESSION_ID=""
if [[ "$INPUT" =~ ^(https?|ftp):// ]]; then
    INPUT_TYPE=url
elif [[ -f "$INPUT" ]]; then
    INPUT_TYPE=file
elif [[ "$INPUT" =~ ^[A-Za-z0-9]{20}$ ]]; then          # Firestore auto-generated document id
    INPUT_TYPE=session
    SESSION_ID="$INPUT"
else
    echo "Error: input is not a URL, an existing file or a session id: $INPUT" >&2
    exit 1
fi

cd "$WORKDIR" || exit 1

# ---- Job folder layout ----
JOBNAME="${SLURM_JOB_NAME}_${SLURM_JOB_ID}"
JOBDIR="$DATA_DIR/$JOBNAME"
VIDEO_DIR="$JOBDIR/video"
LOG_DIR="$JOBDIR/log"
MESH_DIR="$JOBDIR/mesh"
mkdir -p "$VIDEO_DIR" "$LOG_DIR" "$MESH_DIR" || exit 1
LOGFILE="$LOG_DIR/${SLURM_JOB_ID}.log"

# Move Slurm's own output file into the job's log folder.
# Slurm keeps writing to it after the move (same filesystem = same open file).
mv "$SLURM_SUBMIT_DIR/slurm-${SLURM_JOB_ID}.out" "$LOG_DIR/" 2>/dev/null

echo "Job:    $SLURM_JOB_NAME ($SLURM_JOB_ID) on $(hostname)"
echo "Start:  $(date)"
echo "Input:  $INPUT ($INPUT_TYPE)"
echo "Folder: $JOBDIR"

# ---- GPUs given to this job ----
echo "GPUs:   Slurm allocated ${SLURM_GPUS_ON_NODE:-?} (CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-unset})"
if command -v nvidia-smi >/dev/null 2>&1; then
    GPU_INFO=$(nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free \
                          --format=csv,noheader,nounits 2>&1)
    if (( $? == 0 )); then
        echo "        nvidia-smi sees $(printf '%s\n' "$GPU_INFO" | grep -c .) GPU(s):"
        printf '%s\n' "$GPU_INFO" | while IFS=, read -r idx name total used free; do
            printf '        [%s] %s: %s MiB total, %s MiB used, %s MiB free\n' \
                "${idx// /}" "${name# }" "${total// /}" "${used// /}" "${free// /}"
        done
    else
        echo "Warning: nvidia-smi failed: $GPU_INFO" >&2
    fi
else
    echo "Warning: nvidia-smi not found, cannot list GPUs" >&2
fi

# ---- Environment ----
module load env/release/2023.1
module load Apptainer/1.2.4-GCCcore-12.3.0
module load nodejs/18.17.1-GCCcore-12.3.0

# ---- Make sure the GCS tools are built (reuse if present, else build) ----
# Done before fetching the input, because a session id needs them to get the video.
GCS_READY=0
if ! command -v node >/dev/null 2>&1; then
    echo "Warning: node not available, GCS upload will be skipped" >&2
elif [[ ! -f "$GCS_DIR/package.json" ]]; then
    echo "Warning: $GCS_DIR/package.json not found, GCS upload will be skipped" >&2
elif (cd "$GCS_DIR" && node --input-type=module -e "
        await import('firebase-admin/app');
        await import('@google-cloud/storage');      // optional deps of firebase-admin,
        await import('@google-cloud/firestore');    // npm sometimes leaves them out
    ") >/dev/null 2>&1; then
    echo "GCS tools: already built, reusing $GCS_DIR/node_modules"
    GCS_READY=1
else
    echo "GCS tools: not built (or broken), building in $GCS_DIR ..."
    if [[ -f "$GCS_DIR/package-lock.json" ]]; then
        BUILD_CMD=(npm ci --no-audit --no-fund)        # exact versions from the lock file
    else
        BUILD_CMD=(npm install firebase-admin --no-audit --no-fund)
    fi
    if (cd "$GCS_DIR" && "${BUILD_CMD[@]}"); then
        echo "GCS tools: build OK"
        GCS_READY=1
    else
        echo "Warning: GCS tools build failed, upload will be skipped" >&2
    fi
fi
if (( GCS_READY == 1 )) && [[ ! -f "$GCS_KEY" ]]; then
    echo "Warning: GCS key not found at $GCS_KEY, GCS will be skipped" >&2
    GCS_READY=0
fi

# ---- Put the input video into video/ ----
case "$INPUT_TYPE" in
url)
    DEST="$VIDEO_DIR/$(basename "${INPUT%%\?*}")"   # drop ?query=..., keep file name
    MAX_BYTES=$(( MAX_DOWNLOAD_MB * 1024 * 1024 ))
    echo "Downloading (limit ${MAX_DOWNLOAD_MB} MB) -> $DEST"

    (
        ulimit -f $(( MAX_BYTES / 1024 ))   # hard cap: the system blocks writes past this size
        trap "" XFSZ                        # fail with a clean error instead of a crash message
        if command -v curl >/dev/null 2>&1; then
            exec curl --fail --location --retry 3 --retry-delay 5 --connect-timeout 30 \
                 --silent --show-error --max-filesize "$MAX_BYTES" --output "$DEST" "$INPUT"
        elif command -v wget >/dev/null 2>&1; then
            exec wget --tries=3 --timeout=30 --quiet --output-document="$DEST" "$INPUT"
        else
            echo "Error: neither curl nor wget is available" >&2; exit 127
        fi
    )
    RC=$?
    SIZE=$(stat -c %s "$DEST" 2>/dev/null || echo 0)

    if (( RC == 63 || SIZE >= MAX_BYTES )); then
        echo "Error: file is larger than ${MAX_DOWNLOAD_MB} MB, download aborted: $INPUT" >&2
        rm -f "$DEST"; exit 1
    elif (( RC != 0 )); then
        echo "Error: download failed (exit code $RC): $INPUT" >&2
        rm -f "$DEST"; exit 1
    fi
    echo "Downloaded $(( SIZE / 1024 / 1024 )) MB"
    ;;

file)
    DEST="$VIDEO_DIR/$(basename "$INPUT")"
    echo "Copying -> $DEST"
    cp "$INPUT" "$DEST" || { echo "Error: copy failed: $INPUT" >&2; exit 1; }
    ;;

session)
    if (( GCS_READY == 0 )); then
        echo "Error: session id given, but the GCS tools are not ready" >&2
        exit 1
    fi
    # Find the first video directly inside <id>/ (list.js prints "<size>  <name>" per file)
    LISTING=$(node "$GCS_DIR/list.js" "$SESSION_ID/") \
        || { echo "Error: could not list gs://$GCS_BUCKET/$SESSION_ID/ (see error above)" >&2; exit 1; }
    VIDEO_OBJ=$(printf '%s\n' "$LISTING" \
        | sed -E 's/^ *[0-9]* +//' \
        | grep -iE "^$SESSION_ID/[^/]+$VIDEO_EXT_RE" \
        | head -n 1)
    if [[ -z "$VIDEO_OBJ" ]]; then
        echo "Error: no video found in gs://$GCS_BUCKET/$SESSION_ID/" >&2
        exit 1
    fi
    DEST="$VIDEO_DIR/$(basename "$VIDEO_OBJ")"
    echo "Fetching gs://$GCS_BUCKET/$VIDEO_OBJ -> $DEST"
    node "$GCS_DIR/fetch.js" "$VIDEO_OBJ" "$VIDEO_DIR" \
        || { echo "Error: could not fetch $VIDEO_OBJ" >&2; exit 1; }

    node "$GCS_DIR/process.js" "$SESSION_ID" \
        || { echo "Error: could not mark session $SESSION_ID as PROCESSING" >&2; exit 1; }
    ;;
esac
INPUT="$DEST"

# ---- Run (working directory = mesh/) ----
BIND="$WORKDIR"
[[ "$DATA_DIR/" == "$WORKDIR/"* ]] || BIND="$BIND,$DATA_DIR"   # data dir outside workdir: mount it too
apptainer run --nv --bind "$BIND" --pwd "$MESH_DIR" "$SIF" \
    --run_pipeline --input_path "$INPUT" > "$LOGFILE" 2>&1
STATUS=$?
echo "Pipeline finished with exit code $STATUS"

# ---- Move pipeline output from video/unwrapped_mesh/ into mesh/ ----
SRC_MESH="$VIDEO_DIR/unwrapped_mesh"
if [[ -d "$SRC_MESH" ]]; then
    shopt -s dotglob nullglob            # include hidden files; empty match = empty list
    MESH_FILES=("$SRC_MESH"/*)
    if (( ${#MESH_FILES[@]} > 0 )); then
        mv "${MESH_FILES[@]}" "$MESH_DIR/" && echo "Moved mesh output -> $MESH_DIR"
    else
        echo "Warning: $SRC_MESH is empty" >&2
    fi
    rmdir "$SRC_MESH" 2>/dev/null        # remove the now-empty folder
else
    echo "Warning: no mesh output found at $SRC_MESH" >&2
fi

# ---- Upload the files to the bucket ----
# Session: gs://<bucket>/<id>/model.fbx, <id>/model.glb
# Otherwise: gs://<bucket>/<job>/model.fbx, .../model.glb
if [[ -n "$SESSION_ID" ]]; then
    REMOTE_DIR="$SESSION_ID"
else
    REMOTE_DIR="$JOBNAME"
fi
UPLOADED=0
if (( GCS_READY == 0 )); then
    echo "Skipping GCS upload (tools or key not ready)" >&2
else
    UPLOADED=1                                         # set back to 0 if any model is missing or fails
    for EXT in fbx glb; do
        # All files with this extension anywhere under mesh/ (any case), sorted for a stable pick
        mapfile -t FOUND < <(find "$MESH_DIR" -type f -iname "*.$EXT" | sort)
        if (( ${#FOUND[@]} == 0 )); then
            echo "Warning: no .$EXT file found in $MESH_DIR" >&2
            UPLOADED=0; continue
        fi
        if (( ${#FOUND[@]} > 1 )); then
            echo "Warning: ${#FOUND[@]} .$EXT files found, using ${FOUND[0]}" >&2
        fi
        echo "Uploading ${FOUND[0]} -> gs://$GCS_BUCKET/$REMOTE_DIR/model.$EXT"
        node "$GCS_DIR/upload.js" "${FOUND[0]}" "$REMOTE_DIR" "model.$EXT" \
            || { echo "Warning: upload of model.$EXT failed (still in $MESH_DIR)" >&2; UPLOADED=0; }
    done
fi

# ---- Mark the session COMPLETED (only if the pipeline worked and results were uploaded) ----
if [[ -n "$SESSION_ID" ]]; then
    if (( STATUS == 0 && UPLOADED == 1 )); then
        node "$GCS_DIR/complete.js" "$SESSION_ID" \
            || echo "Warning: could not mark session $SESSION_ID as completed" >&2
    else
        echo "Warning: session $SESSION_ID left as PROCESSING (pipeline or upload failed)" >&2
    fi
fi

echo "End:    $(date)  (exit code $STATUS)"
exit $STATUS
