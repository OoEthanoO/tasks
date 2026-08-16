#!/usr/bin/env python3
"""
Draws the YanTasks app icon and every derived asset.

The mark is the weight table itself: a wheel whose wedges are sized by the
recommender's own weights — one fat slice for a task due today, progressively
thinner ones as due dates recede, and the hidden Rest slice in the same green
the schedule uses. Checked in so the icon can be retuned by editing numbers
rather than by opening a design tool.

    python3 assets/generate-icon.py
"""

from PIL import Image, ImageDraw

# The palette from app/globals.css, so the icon and the UI cannot drift apart.
BG = (10, 11, 14)
ACCENT = (124, 108, 255)
REST = (74, 222, 128)
TEXT = (231, 233, 238)

# Supersample, then downsample once at the end: Pillow's pieslice has no
# antialiasing of its own and the wedge seams show badly without this.
SS = 4
SIZE = 1024
W = SIZE * SS

# (weight, colour) — the same curve the app uses: due today 2, tomorrow 1,
# then 1/2, 1/3, and Rest holding a constant 1.
WEDGES = [
    (2.00, ACCENT),
    (1.00, (140, 126, 255)),
    (0.50, (96, 84, 200)),
    (0.33, (62, 55, 130)),
    (1.00, REST),
]

GAP_DEG = 2.5  # breathing room between wedges, in degrees


def draw_wheel(img: Image.Image, cx: float, cy: float, outer: float, ring: float) -> None:
    d = ImageDraw.Draw(img)
    total = sum(w for w, _ in WEDGES)

    angle = -90.0  # start at 12 o'clock
    for weight, colour in WEDGES:
        sweep = 360.0 * weight / total
        d.pieslice(
            [cx - outer, cy - outer, cx + outer, cy + outer],
            start=angle + GAP_DEG / 2,
            end=angle + sweep - GAP_DEG / 2,
            fill=colour + (255,),
        )
        angle += sweep

    # Punch the middle out to leave a ring. Transparent, so the same routine
    # works on both the opaque icon and the cut-out foreground layers.
    inner = outer - ring
    d.ellipse(
        [cx - inner, cy - inner, cx + inner, cy + inner],
        fill=(0, 0, 0, 0),
    )

    # The pointer: a marker at 12 o'clock, reading as the ball rest on a
    # roulette wheel. It has to survive being drawn at 40px on a home screen,
    # which is why it is this heavy — anything finer turns to mush.
    tip = cy - outer + ring * 1.02
    half = outer * 0.15
    top = cy - outer - ring * 0.16
    d.polygon([(cx, tip), (cx - half, top), (cx + half, top)], fill=TEXT + (255,))


def wheel_layer(margin_ratio: float) -> Image.Image:
    """The mark alone on transparency. `margin_ratio` is padding per side."""
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    outer = W * (0.5 - margin_ratio)
    draw_wheel(img, W / 2, W / 2, outer, outer * 0.56)
    return img


def finish(img: Image.Image, size: int = SIZE) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def flatten(layer: Image.Image) -> Image.Image:
    """Composite onto the app background — iOS icons may not be transparent."""
    base = Image.new("RGBA", layer.size, BG + (255,))
    base.alpha_composite(layer)
    return base.convert("RGB")


def monochrome(layer: Image.Image) -> Image.Image:
    """Android's themed-icon layer: one flat colour, shape carried by alpha."""
    solid = Image.new("RGBA", layer.size, TEXT + (255,))
    solid.putalpha(layer.getchannel("A"))
    return solid


def main() -> None:
    here = __file__.rsplit("/", 1)[0]

    # The home-screen icon: mark tight to the edge, on the app background.
    icon = wheel_layer(0.155)
    finish(flatten(icon)).save(f"{here}/icon.png")

    # Splash and Android foreground both sit inside a safe zone — Android crops
    # an adaptive icon to 66% of the canvas, so the mark has to be smaller.
    finish(wheel_layer(0.30)).save(f"{here}/splash-icon.png")
    android = wheel_layer(0.28)
    finish(android).save(f"{here}/android-icon-foreground.png")
    finish(monochrome(android)).save(f"{here}/android-icon-monochrome.png")

    bg = Image.new("RGB", (SIZE, SIZE), BG)
    bg.save(f"{here}/android-icon-background.png")

    finish(flatten(wheel_layer(0.10)), 196).save(f"{here}/favicon.png")

    print("wrote icon, splash-icon, android-icon-*, favicon")


if __name__ == "__main__":
    main()
