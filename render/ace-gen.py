"""Background music with ACE-Step 1.5 (MIT), on a small GPU (6 GB): DiT only, INT8, CPU offload, no language model.
Part of the motion kit, see 22-electronic-music.md. Instrumental only; one WAV per seed, 48 kHz.

ACE-Step lives outside the kit (about 12 GB with the models): ACESTEP_DIR, default local/ACE-Step-1.5.
    git clone --depth 1 https://github.com/ACE-Step/ACE-Step-1.5.git local/ACE-Step-1.5 && uv sync --project local/ACE-Step-1.5

Usage (from the kit root; `uv run --project` picks ACE-Step's environment):
    uv run --project local/ACE-Step-1.5 python render/ace-gen.py --out local/ace-out --name deep --bpm 124 --keyscale "C minor" --duration 60 --seeds 1,2,3 --caption "..."
    uv run --project local/ACE-Step-1.5 python render/ace-gen.py --out local/ace-out --name genres --jobs render/ace-genres.json
        several jobs in one process: the cold start is 1-3 minutes, a 60 s take is 15-35 s on a 6 GB laptop GPU
jobs: [{"name": "techhouse", "caption": "...", "bpm": 126, "keyscale": "F minor", "duration": 60, "seeds": [1]}, ...]
Writes <out>/<name>-<bpm>bpm-s<seed>.wav and <out>/<name>-report.json (read by ace-batch-check.mjs). The first run downloads the models (~10 GB).
"""
import argparse
import json
import os
import sys
import time

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(os.environ.get("ACESTEP_DIR") or os.path.join(KIT, "local", "ACE-Step-1.5"))
sys.path.insert(0, ROOT)
os.environ.setdefault("ACESTEP_INIT_LLM", "false")
os.environ.setdefault("ACESTEP_DISABLE_TQDM", "1")
for v in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
    os.environ.pop(v, None)

ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(KIT, "local", "ace-out"))
ap.add_argument("--caption")
ap.add_argument("--jobs", help="JSON list of jobs; overrides --caption/--bpm/... per job")
ap.add_argument("--bpm", type=int, default=124)
ap.add_argument("--keyscale", default="")
ap.add_argument("--duration", type=int, default=60)
ap.add_argument("--seeds", default="1,2,3")
ap.add_argument("--steps", type=int, default=8)
ap.add_argument("--name", default="take", help="prefix of the report file (and of the takes without --jobs)")
args = ap.parse_args()
args.out = os.path.abspath(args.out)
if args.jobs:
    args.jobs = os.path.abspath(args.jobs)
if not args.caption and not args.jobs:
    ap.error("--caption or --jobs is required")

from loguru import logger  # noqa: E402
from acestep.handler import AceStepHandler  # noqa: E402
from acestep.inference import GenerationConfig, GenerationParams, generate_music  # noqa: E402

if not os.path.isdir(ROOT):
    sys.exit(f"ACE-Step not found at {ROOT}: clone it there or set ACESTEP_DIR (see the header of this file)")
os.chdir(ROOT)                                                                            # ACE-Step writes .cache/ into the current directory
os.makedirs(args.out, exist_ok=True)
t0 = time.time()
dit = AceStepHandler()
msg, ok = dit.initialize_service(
    project_root=ROOT, config_path="acestep-v15-turbo", device="auto",
    offload_to_cpu=True, offload_dit_to_cpu=True, quantization="int8_weight_only",
)
if not ok:
    logger.error(f"init failed: {msg}")
    sys.exit(1)
logger.info(f"DiT ready in {time.time() - t0:.0f}s: {msg}")

jobs = json.load(open(args.jobs, encoding="utf8")) if args.jobs else [{
    "name": args.name, "caption": args.caption, "bpm": args.bpm, "keyscale": args.keyscale, "duration": args.duration,
    "seeds": [int(s) for s in args.seeds.split(",") if s.strip()],
}]
report = []
for job in jobs:
    name, caption = job["name"], job["caption"]
    bpm, keyscale, duration = job.get("bpm", args.bpm), job.get("keyscale", args.keyscale), job.get("duration", args.duration)
    for seed in job.get("seeds", [1]):
        params = GenerationParams(
            task_type="text2music", thinking=False, caption=caption, lyrics="[Instrumental]", instrumental=True,
            bpm=bpm, keyscale=keyscale, timesignature="4", duration=duration,
            inference_steps=args.steps, guidance_scale=1.0, seed=seed,
        )
        config = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[seed], audio_format="wav")
        t1 = time.time()
        res = generate_music(dit, None, params=params, config=config, save_dir=args.out)
        dt = time.time() - t1
        entry = {"name": name, "seed": seed, "bpm": bpm, "keyscale": keyscale, "duration": duration, "caption": caption, "seconds": round(dt)}
        if not res.success:
            logger.error(f"{name} seed {seed} failed after {dt:.0f}s: {res.status_message}")
            report.append({**entry, "ok": False, "error": res.status_message})
            continue
        paths = []
        for a in res.audios:
            src = a.get("path")
            if src and os.path.exists(src):
                dst = os.path.join(args.out, f"{name}-{bpm}bpm-s{seed}.wav")
                if os.path.abspath(src) != os.path.abspath(dst):
                    os.replace(src, dst)
                paths.append(dst)
        logger.info(f"{name} seed {seed}: {dt:.0f}s -> {paths}")
        report.append({**entry, "ok": True, "files": paths})

with open(os.path.join(args.out, f"{args.name}-report.json"), "w", encoding="utf8") as f:
    json.dump(report, f, indent=2, ensure_ascii=False)
print(json.dumps(report, indent=2, ensure_ascii=False))
