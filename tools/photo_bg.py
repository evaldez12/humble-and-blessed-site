"""Cut every product out of its photo and set it on the brand photo background (#000000).
Reads assets/products/<name>.jpg, writes assets/products/clean/<name>.jpg (square, 1600 px max, soft shadow).
Run from the site folder:  docpython tools/photo_bg.py [name ...]   (needs rembg, opencv-python, pillow, numpy)"""
import sys, pathlib
import numpy as np, cv2
from PIL import Image, ImageFilter
from rembg import remove, new_session

# white-background studio shots where the product itself is white: a segmentation model drops the
# garment, so instead flood-fill the backdrop from the edges and recolour only that
WHITE_BG = set()   # names of white products shot on white; add them here

def tint_white(im):
    """White product on a white backdrop with no usable edge: shift every near-white pixel toward
    ivory, keeping shading, so the whole shot sits on the brand colour. Flagged in LAUNCH.md."""
    rgb = np.array(im.convert("RGB")).astype(np.float32)
    lo = rgb.min(axis=2, keepdims=True)
    k = np.clip((lo - 205) / 40, 0, 1)                      # 0 = coloured/dark pixel, 1 = white
    ivory = np.array(IVORY, np.float32) * (rgb.max(axis=2, keepdims=True) / 255)
    out = rgb * (1 - k) + ivory * k
    return Image.fromarray(out.astype(np.uint8)).convert("RGBA")

def cut_white_bg(im):
    rgb = np.array(im.convert("RGB")); h, w = rgb.shape[:2]
    mask = np.zeros((h + 2, w + 2), np.uint8); flags = 4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8)
    work = rgb.copy()
    for seed in [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3), (w // 2, 2), (w // 2, h - 3), (2, h // 2), (w - 3, h // 2)]:
        cv2.floodFill(work, mask, seed, 0, (14, 14, 14), (14, 14, 14), flags)
    bg = mask[1:-1, 1:-1]
    alpha = 255 - cv2.GaussianBlur(bg, (0, 0), 1.2)
    out = im.convert("RGBA"); out.putalpha(Image.fromarray(alpha)); return out

def keep_main_parts(cut, min_frac=0.03):
    # drop stray scraps (bits of side text, stickers) but keep multi-item shots like tee + shorts
    a = np.array(cut.split()[3]); n, lab, stats, _ = cv2.connectedComponentsWithStats((a > 20).astype(np.uint8))
    if n <= 2: return cut
    areas = stats[1:, cv2.CC_STAT_AREA]; keep = np.zeros_like(a, bool)
    for i, area in enumerate(areas, start=1):
        if area >= areas.max() * min_frac: keep |= lab == i
    a[~keep] = 0; cut.putalpha(Image.fromarray(a)); return cut

IVORY = (0, 0, 0)
SRC = pathlib.Path("assets/products"); OUT = SRC / "clean"; OUT.mkdir(exist_ok=True)
session = new_session("isnet-general-use")   # sharper edges on apparel than the default u2net
names = sys.argv[1:] or [p.stem for p in SRC.glob("*.jpg")]
for n in names:
    im = Image.open(SRC / f"{n}.jpg").convert("RGBA")
    if n in WHITE_BG:
        tinted = tint_white(im).convert("RGB")
        side = max(tinted.size); canvas = Image.new("RGB", (side, side), IVORY)
        canvas.paste(tinted, ((side - tinted.width) // 2, (side - tinted.height) // 2))
        if side > 1600: canvas = canvas.resize((1600, 1600), Image.LANCZOS)
        canvas.save(OUT / f"{n}.jpg", quality=88, optimize=True, progressive=True); print(n, "-> tinted", canvas.size); continue
    else:
        cut = remove(im, session=session, alpha_matting=True, alpha_matting_foreground_threshold=240,
                     alpha_matting_background_threshold=10, alpha_matting_erode_size=8)
        cut = keep_main_parts(cut)
    # trim to the subject, then centre it on a square ivory canvas with even padding
    bbox = cut.getbbox()
    cut = cut.crop(bbox)
    side = int(max(cut.size) * 1.18)
    canvas = Image.new("RGBA", (side, side), IVORY + (255,))
    # soft contact shadow so the product sits on the surface instead of floating
    shadow = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sh = Image.new("RGBA", cut.size, (40, 35, 25, 70)); sh.putalpha(cut.split()[3].point(lambda a: int(a * 0.35)))
    shadow.paste(sh, ((side - cut.width) // 2, (side - cut.height) // 2 + int(side * 0.02)), sh)
    shadow = shadow.filter(ImageFilter.GaussianBlur(side * 0.02))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(cut, ((side - cut.width) // 2, (side - cut.height) // 2))
    canvas = canvas.convert("RGB")
    if side > 1600: canvas = canvas.resize((1600, 1600), Image.LANCZOS)
    canvas.save(OUT / f"{n}.jpg", quality=88, optimize=True, progressive=True)
    print(n, "->", canvas.size, "subject", cut.size)
