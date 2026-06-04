# Demo Feed Render Handoff

This folder contains the source artifacts for the elevated onboarding demo feed. Push these artifact folders when another machine needs to render the videos locally at a higher quality.

## Setup

From the repository root:

```bash
bun install
```

The generic renderer uses `@hyperframes/producer`. It first tries to import it from this repo. If this repo does not have the producer installed, set `HIVEMIND_HONO_DIR` to a sibling `hivemind-hono` checkout that already has dependencies installed:

```bash
export HIVEMIND_HONO_DIR=/path/to/hivemind-hono
```

No API keys are needed to render existing artifacts. API keys are only needed if you regenerate images, voices, avatars, or Grok clips.

## Source Folders

Use these folders as the render inputs:

```text
001 Rome's Military Anarchy
002 CRISPR Dual-RNA Targeting
004 The Tragedy of the Commons
005 Why Human Babies Are So Useless
006 Quantum Entanglement Is Not Telepathy
008 The Fermi Paradox
009 You Are Trapped Inside the Siege of Alesia - Roman POV
010 You Wake Up in Ancient Rome With Modern Knowledge
```

Each artifact folder should include its `index.html`, `hyperframes.json`, `meta.json`, `scenes.json`, and local `assets/` or `staticVideoAssets/` files.

Do not push `.thumbnails/`, `.DS_Store`, `.tmp-*`, old ZIP exports, or the `rendered/` output folder as part of the source handoff.

## High Quality Render Command

Use the generic renderer for any artifact folder:

```bash
bun scripts/render-demo-feed-artifact.mjs \
  --artifact "videos/Demo Feed Elevated/05-md-no-code-manim/008 The Fermi Paradox" \
  --output "videos/Demo Feed Elevated/05-md-no-code-manim/rendered/008-fermi-paradox-1080x1920.mp4" \
  --width 1080 \
  --height 1920 \
  --fps 30 \
  --chunk-size 120 \
  --concurrency 4 \
  --cover
```

The `--cover` flag injects cover-fit CSS into `index-cover.html` before rendering. Use it for vertical onboarding videos to avoid letterboxing.

## Current Render Notes

For local previews on this machine, the latest outputs were written to:

```text
videos/Demo Feed Elevated/05-md-no-code-manim/rendered/
```

Those MP4s are previews, not the handoff source. The handoff source is the artifact folder plus the renderer.

## Optional Regeneration

If a collaborator needs to regenerate media instead of only re-rendering existing source assets, they also need:

- a local `hivemind-hono` checkout,
- the relevant environment files with provider keys,
- the specific regeneration scripts under `scripts/`.

Do not commit env files or provider secrets.
