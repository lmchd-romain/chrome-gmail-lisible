"""Génère les icônes de l'extension (enveloppe + lignes de texte).

Usage : python3 tools/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
S = 1024  # dessin en grand, puis réduction (bords lisses)

BG_TOP = (52, 120, 246)
BG_BOTTOM = (25, 87, 208)
WHITE = (255, 255, 255)
FLAP = (205, 222, 252)


def draw_master() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Fond : carré arrondi en dégradé vertical.
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / (S - 1)
        color = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)) + (255,)
        gd.line([(0, y), (S, y)], fill=color)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # Enveloppe.
    left, right = int(S * 0.17), int(S * 0.83)
    top, bottom = int(S * 0.26), int(S * 0.74)
    d.rounded_rectangle([left, top, right, bottom], radius=int(S * 0.06), fill=WHITE)

    # Rabat (V) en bleu clair.
    mid = (left + right) // 2
    flap_bottom = int(S * 0.50)
    w = int(S * 0.045)
    d.line([(left + w, top + w), (mid, flap_bottom)], fill=FLAP, width=w, joint="curve")
    d.line([(mid, flap_bottom), (right - w, top + w)], fill=FLAP, width=w, joint="curve")

    # Lignes de texte bien espacées (lisibilité).
    line_h = int(S * 0.04)
    x0 = left + int(S * 0.09)
    for i, frac in enumerate((0.52, 0.40)):
        y = int(S * 0.585) + i * int(S * 0.075)
        d.rounded_rectangle(
            [x0, y, x0 + int(S * frac), y + line_h], radius=line_h // 2, fill=BG_BOTTOM
        )
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = draw_master()
    for size in (16, 32, 48, 128):
        master.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
    print("Icônes écrites dans", OUT)


if __name__ == "__main__":
    main()
