#!/usr/bin/env python3
"""
Convert screenshots taken on a real iPhone into the exact pixel sizes App Store
Connect accepts.

App Store Connect rejects anything that is not precisely one of its listed
sizes, and no shipping iPhone writes those numbers — an iPhone 15 Pro shoots
1179x2556, and the 6.5" slot wants 1242x2688. Aspect ratios differ by well
under a percent, so images are scaled to fit and padded with the app background
rather than stretched; on this UI the padding is invisible.

    python3 scripts/appstore-screenshots.py shots/*.PNG
    python3 scripts/appstore-screenshots.py --size 6.9 shots/*.PNG

Output lands in shots/appstore/ with the same file names.
"""

import argparse
import os
import sys

from PIL import Image

# The app background, so any padding disappears into the UI.
BG = (10, 11, 14)

SIZES = {
    "6.5": (1242, 2688),   # iPhone 11 Pro Max / XS Max slot
    "6.9": (1290, 2796),   # iPhone 16 Pro Max slot
    "6.7": (1290, 2796),   # same pixels as 6.9
}


def convert(path: str, target: tuple[int, int], outdir: str) -> str:
    im = Image.open(path).convert("RGB")
    tw, th = target

    # Scale to fit inside the target, preserving aspect.
    scale = min(tw / im.width, th / im.height)
    new = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)

    canvas = Image.new("RGB", target, BG)
    canvas.paste(new, ((tw - new.width) // 2, (th - new.height) // 2))

    os.makedirs(outdir, exist_ok=True)
    name = os.path.splitext(os.path.basename(path))[0] + ".png"
    out = os.path.join(outdir, name)
    canvas.save(out)
    return f"{os.path.basename(path)}  {im.width}x{im.height} -> {tw}x{th}  {out}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--size", default="6.5", choices=sorted(SIZES))
    ap.add_argument("--out", default=None, help="output directory")
    args = ap.parse_args()

    target = SIZES[args.size]
    outdir = args.out or os.path.join(os.path.dirname(args.images[0]) or ".", "appstore")

    for path in args.images:
        try:
            print(convert(path, target, outdir))
        except Exception as error:  # a stray non-image in a glob should not stop the batch
            print(f"skipped {path}: {error}", file=sys.stderr)


if __name__ == "__main__":
    main()
