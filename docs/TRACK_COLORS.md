# Track Artwork Dominant Colors

Each track has a primary color extracted from its artwork, used for theming and branding throughout the application.

## Color Palette

| Track | Color | Hex | RGB | Description |
|-------|-------|-----|-----|-------------|
| **Hydrogen** | Cyan/Turquoise | `#25daf0` | RGB(37, 218, 240) | Bright, energetic |
| **Lithium** | Red/Crimson | `#cf2739` | RGB(207, 39, 57) | Bold, intense |
| **Sodium** | Yellow/Gold | `#f7ca47` | RGB(247, 202, 71) | Warm, vibrant |
| **Potassium** | Purple/Violet | `#8f01ff` | RGB(143, 1, 255) | Electric, vivid |
| **Rubidium** | Magenta/Pink | `#c71585` | RGB(199, 21, 133) | Deep, rich |
| **Caesium** | Lavender/Light Purple | `#afa0ef` | RGB(175, 160, 239) | Soft, pastel |
| **Francium** | Gray/Silver | `#c1c1c1` | RGB(193, 193, 193) | Neutral, elegant |

## Files & Tools

### Source Files

| File | Description |
|------|-------------|
| `src/scripts/extract_colors.py` | Python script to extract dominant colors from artwork |
| `src/scripts/extract_colors.sh` | Shell script alternative using ImageMagick |

### Configuration Files

| File | Description |
|------|-------------|
| `src/workers/everything-is-remixed-worker.js` | Worker with `TRACKS` object containing colors |
| `src/workers/stems.json` | Stem config with per-stem colors |

## JavaScript Object

```javascript
const TRACK_COLORS = {
  'hydrogen': '#25daf0',   // Cyan
  'lithium': '#cf2739',    // Red
  'sodium': '#f7ca47',     // Yellow
  'potassium': '#8f01ff',  // Purple
  'rubidium': '#c71585',   // Magenta
  'caesium': '#afa0ef',    // Lavender
  'francium': '#c1c1c1',   // Gray
};
```

## CSS Custom Properties

```css
:root {
  --track-hydrogen: #25daf0;
  --track-lithium: #cf2739;
  --track-sodium: #f7ca47;
  --track-potassium: #8f01ff;
  --track-rubidium: #c71585;
  --track-caesium: #afa0ef;
  --track-francium: #c1c1c1;
}
```

## Color Extraction

### Python Script (extract_colors.py)

Uses PIL (Pillow) to analyze artwork images:

```python
def get_dominant_color(image_path, n_colors=5):
    """Extract the dominant color from an image."""
    img = Image.open(image_path).convert('RGB')
    img = img.resize((150, 150))  # Resize for faster processing
    pixels = list(img.getdata())
    color_counter = Counter(pixels)

    # Filter out near-black and near-white colors
    filtered = [(c, n) for c, n in color_counter.most_common(n_colors)
                if 20 < (c[0]+c[1]+c[2])/3 < 235]

    return filtered[0][0] if filtered else color_counter.most_common(1)[0][0]
```

**Requirements:**
```bash
pip install Pillow
```

**Usage:**
```bash
# Update base_path in script first
python3 src/scripts/extract_colors.py
```

### Shell Script (extract_colors.sh)

Uses ImageMagick for color extraction:

```bash
convert "$image" -resize 150x150 -colors 5 -format "%c" histogram:info:-
```

**Requirements:**
- ImageMagick installed (`brew install imagemagick`)

## Usage in Application

### Worker (TRACKS object)

The primary color is stored in the worker's `TRACKS` configuration:

```javascript
const TRACKS = {
  'hydrogen': { name: 'Hydrogen', bpm: 132, key: 'D Major', number: 1, symbol: 'H', color: '#25daf0' },
  // ...
};
```

### Dynamic CSS Variable

The worker injects the track color as a CSS variable:

```html
<style>
  :root { --track-color: ${track ? track.color : '#fff'}; }
</style>
```

### UI Elements Using Track Color

- **Status dot**: Glows with track color
- **Button borders**: Track color on hover
- **Share URL text**: Displayed in track color
- **Master channel**: Border and glow effect
- **Enter Studio button**: Background and shadow
- **Progress bar**: Fill color

## Color Analysis

### Brightness Categories

- **Bright/Vibrant**: Hydrogen (cyan), Sodium (yellow), Potassium (purple), Lithium (red)
- **Mid-tone**: Rubidium (magenta), Caesium (lavender)
- **Neutral**: Francium (gray)

### Contrast Considerations

The palette provides good variety for UI differentiation:
- High saturation colors (Hydrogen, Lithium, Potassium) work well on dark backgrounds
- Pastel colors (Caesium) may need darker text or backgrounds
- Neutral gray (Francium) provides universal compatibility

## Updating Colors

If artwork changes or colors need adjustment:

```bash
# 1. Update artwork images in track directories

# 2. Re-run extraction script
python3 src/scripts/extract_colors.py

# 3. Update TRACKS in worker
# Edit src/workers/everything-is-remixed-worker.js

# 4. Regenerate stem palettes (uses track colors as base)
python3 src/scripts/generate_stem_palettes.py

