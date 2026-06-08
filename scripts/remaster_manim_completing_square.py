#!/usr/bin/env python3
"""Remaster the onboarding Manim completing-square video with app-safe padding.

The checked-in onboarding post is a rendered-only artifact; the original Manim
scene source is not present in the playground. This script keeps the accepted
animation and audio intact, then recreates the asset on a larger portrait canvas
with the same inset pattern used by the default mobile onboarding template:
42 px vertical and 28 px horizontal at the 394x770 Manim base size.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve()
PLAYGROUND_ROOT = SCRIPT_PATH.parents[1]
HIVEMIND_ROOT = PLAYGROUND_ROOT.parent
FINAL_VIDEO_DIR = HIVEMIND_ROOT / "FINAL DEMO VIDEOS"

UNPADDED_SOURCE = FINAL_VIDEO_DIR / "007-completing_square.mp4"
PADDED_MASTER = FINAL_VIDEO_DIR / "7-manim-completing-square-padded-1440x3120.mp4"
DEFAULT_INPUT = UNPADDED_SOURCE if UNPADDED_SOURCE.exists() else PADDED_MASTER
DEFAULT_OUTPUT = FINAL_VIDEO_DIR / "007-completing_square-padded-720x1560.mp4"
LEGACY_OUTPUT = FINAL_VIDEO_DIR / "7-manim-completing-square-padded-720x1560.mp4"

BASE_MANIM_WIDTH = 394
BASE_MANIM_HEIGHT = 770
BASE_SIDE_PADDING = 28
BASE_VERTICAL_PADDING = 42

TARGET_WIDTH = 720
TARGET_HEIGHT = 1560


def run(command: list[str]) -> None:
    print(" ".join(command))
    subprocess.run(command, check=True)


def even(value: float) -> int:
    rounded = int(round(value))
    return rounded if rounded % 2 == 0 else rounded + 1


def build_filter(target_width: int, target_height: int) -> str:
    side_padding = even(BASE_SIDE_PADDING * target_width / BASE_MANIM_WIDTH)
    min_top_bottom_padding = even(
        BASE_VERTICAL_PADDING * target_height / BASE_MANIM_HEIGHT
    )
    inner_width = even(target_width - side_padding * 2)
    inner_height = even(target_height - min_top_bottom_padding * 2)

    return (
        f"scale={inner_width}:{inner_height}:force_original_aspect_ratio=decrease,"
        f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=#0e0e14,"
        "setsar=1"
    )


def build_scale_filter(target_width: int, target_height: int) -> str:
    return f"scale={target_width}:{target_height}:flags=lanczos,setsar=1"


def source_already_padded(input_path: Path) -> bool:
    return "-padded-" in input_path.name


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a padded remaster of the completing-square Manim onboarding video.",
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--width", type=int, default=TARGET_WIDTH)
    parser.add_argument("--height", type=int, default=TARGET_HEIGHT)
    parser.add_argument(
        "--crf",
        type=int,
        default=18,
        help="x264 CRF. Lower is larger/higher quality; 18 is visually high quality.",
    )
    parser.add_argument(
        "--also-write-legacy-name",
        action="store_true",
        help=f"Also write {LEGACY_OUTPUT.name}, used by the standalone publish script.",
    )
    return parser.parse_args()


def render(input_path: Path, output_path: Path, width: int, height: int, crf: int) -> None:
    if width % 2 or height % 2:
        raise SystemExit("width and height must be even for libx264")
    if not input_path.exists():
        raise SystemExit(f"input video not found: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    video_filter = (
        build_scale_filter(width, height)
        if source_already_padded(input_path)
        else build_filter(width, height)
    )
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-vf",
            video_filter,
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            str(crf),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    )


def main() -> None:
    args = parse_args()
    input_path = args.input.resolve()
    output_path = args.output.resolve()
    render(input_path, output_path, args.width, args.height, args.crf)
    if args.also_write_legacy_name:
        render(input_path, LEGACY_OUTPUT, args.width, args.height, args.crf)


if __name__ == "__main__":
    main()
