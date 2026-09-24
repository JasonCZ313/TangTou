"""将躺投主 Logo 裁切并导出扩展图标与品牌图。"""
from pathlib import Path

from PIL import Image

src = Path(r"C:\Users\ROG\.cursor\projects\m\assets\tangtou-logo-master.png")
icons = Path(r"m:\项目\躺投\public\icons")
brand = Path(r"m:\项目\躺投\public\brand")
icons.mkdir(parents=True, exist_ok=True)
brand.mkdir(parents=True, exist_ok=True)

img = Image.open(src).convert("RGBA")
width, height = img.size

# 裁切上方圆角图标主体（略去下方「躺投」文字），保证小尺寸仍清晰
crop_height = int(height * 0.62)
side = min(width, crop_height)
left = (width - side) // 2
top = max(0, (crop_height - side) // 2)
icon_full = img.crop((left, top, left + side, top + side))

for size in (16, 48, 128, 256, 512):
    resized = icon_full.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(icons / f"icon-{size}.png", optimize=True)

img.save(brand / "tangtou-logo-master.png", optimize=True)
img.resize((256, int(256 * height / width)), Image.Resampling.LANCZOS).save(
    brand / "logo-full.png",
    optimize=True,
)
img.resize((128, int(128 * height / width)), Image.Resampling.LANCZOS).save(
    brand / "logo-header.png",
    optimize=True,
)
icon_full.resize((96, 96), Image.Resampling.LANCZOS).save(
    brand / "logo-mark.png",
    optimize=True,
)

print("icons", sorted(path.name for path in icons.glob("*.png")))
print("brand", sorted(path.name for path in brand.glob("*")))
print("master", width, height, "crop", side)
