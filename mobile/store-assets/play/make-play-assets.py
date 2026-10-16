# Builds the Google Play listing graphics from the iOS screenshots + brand mark.
# Play caps screenshots at a 2:1 aspect ratio, so the 1284x2778 iOS shots are
# cropped (bottom bezel only) to 1284x2568.
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import glob, os
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "..", "assets")
for i, src in enumerate(sorted(glob.glob(os.path.join(HERE, "raw", "ios-shot-*.png"))), 1):
    Image.open(src).convert("RGB").crop((0, 0, 1284, 2568)).save(os.path.join(HERE, f"phone-{i}.png"), optimize=True)
Image.open(os.path.join(ASSETS, "icon.png")).convert("RGB").resize((512, 512), Image.LANCZOS).save(os.path.join(HERE, "icon-512.png"), optimize=True)

W, H = 1024, 500
bg = Image.new("RGB", (W, H), (250, 250, 244)); d = ImageDraw.Draw(bg)
d.ellipse((-160, -200, 420, 380), fill=(214, 240, 219)); d.ellipse((700, 220, 1200, 700), fill=(222, 243, 226))
fg = bg.filter(ImageFilter.GaussianBlur(90))
mark = Image.open(os.path.join(ASSETS, "brand", "pepworld-mark.png")).convert("RGBA"); mark.thumbnail((250, 250), Image.LANCZOS)
fg.paste(mark, (90, (H - mark.height) // 2), mark)
def avenir(size, style):
    for idx in range(16):
        try:
            f = ImageFont.truetype("/System/Library/Fonts/Avenir Next.ttc", size, index=idx)
            if f.getname()[1] == style: return f
        except OSError: break
    raise SystemExit(f"Avenir Next {style} not found")
bold, med = avenir(76, "Bold"), avenir(30, "Medium")
dr = ImageDraw.Draw(fg); x = 400
dr.text((x, 150), "Every store you", font=bold, fill=(20, 20, 18))
dr.text((x, 235), "love, ", font=bold, fill=(20, 20, 18))
dr.text((x + dr.textlength("love, ", font=bold), 235), "one app.", font=bold, fill=(34, 166, 74))
dr.text((x, 345), "Shop · Track orders · Chat with sellers", font=med, fill=(90, 90, 84))
fg.save(os.path.join(HERE, "feature-1024x500.png"), optimize=True)
