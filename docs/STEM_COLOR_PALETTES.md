# Stem Color Palette System

## Overview

Each track in "Everything is Free" has a harmonious color palette for its stems, derived from the track's primary artwork color using color theory principles.

## Design Philosophy

### Color Assignment Strategy

1. **VOX LEAD** (Lead Vocals) receives the **primary track color** (extracted from artwork)
2. All other stems receive **complementary colors** generated using:
   - **Triadic** color harmony (120° on color wheel)
   - **Split-complementary** variations (150°, 210°)
   - **Analogous** relationships (30° spacing)
   - Saturation and lightness variations for richness

### Color Theory Applied

The palette generation uses **HSL color space** manipulation to create:
- **Visual variety**: Each stem is easily distinguishable
- **Harmonic unity**: Colors work together aesthetically
- **Functional clarity**: VOX LEAD stands out with the signature track color

## Track Palettes

| Track | Primary Color | Stems | Description |
|-------|--------------|-------|-------------|
| **Hydrogen** | `#25daf0` (Cyan) | 12 | Cyan → Magenta → Yellow → Purple |
| **Lithium** | `#cf2739` (Red) | 38 | Red → Green → Blue → Purple spectrum |
| **Sodium** | `#f7ca47` (Yellow) | 28 | Yellow → Cyan → Magenta → Orange |
| **Potassium** | `#8f01ff` (Purple) | 19 | Purple → Orange → Green → Cyan |
| **Rubidium** | `#c71585` (Magenta) | 9 | Magenta → Green → Cyan → Orange |
| **Caesium** | `#afa0ef` (Lavender) | 16 | Lavender → Peach → Mint → Pink |
| **Francium** | `#c1c1c1` (Gray) | 26 | Desaturated warm/cool grays |

## Files & Tools

### Source Files

| File | Description |
|------|-------------|
| `src/scripts/generate_stem_palettes.py` | Python script to generate color palettes |
| `src/stem_palettes.json` | Generated palette data (JSON) |
| `src/workers/stems.json` | Stem configuration with embedded colors |


### Palette Generation Algorithm

The `generate_stem_palettes.py` script implements:

```python
def generate_rich_palette(base_color_hex, num_colors):
    """
    1. Start with base color (for VOX LEAD)
    2. Generate triadic colors (120° spacing)
    3. Add split-complementary colors (150°, 210°)
    4. Add analogous variations (30° spacing)
    5. Fill remaining with varied hue rotations + saturation/lightness adjustments
    """
```

### Color Space: HSL (Hue, Saturation, Lightness)

- **Hue rotation**: Creates complementary relationships
- **Saturation variation**: 0.7-1.0 range for vibrancy
- **Lightness variation**: 0.6-1.0 range for visibility

### Key Functions

```python
def hex_to_rgb(hex_color)     # Convert hex to RGB (0-255)
def rgb_to_hex(rgb)           # Convert RGB to hex
def rgb_to_hsl(rgb)           # Convert RGB to HSL (0-1)
def hsl_to_rgb(hsl)           # Convert HSL to RGB

def adjust_color(base_color_hex, hue_shift=0, saturation_factor=1.0, lightness_factor=1.0)
    # Adjust color by shifting hue and scaling saturation/lightness

def generate_palette(base_color_hex, num_colors, scheme='analogous')
    # Generate palette using specific color theory scheme

def generate_rich_palette(base_color_hex, num_colors)
    # Generate rich, varied palette using multiple schemes
```

## Regenerating Palettes

### Step-by-Step Process

```bash
# 1. Navigate to repository root
cd /path/to/evr

# 2. Edit track colors or algorithm (optional)
vim src/scripts/generate_stem_palettes.py

# 3. Generate new palettes
python3 src/scripts/generate_stem_palettes.py

# 4. Review output
cat stem_palettes.json

# 5. Move to src directory
mv stem_palettes.json src/

# 6. Manually update colors in stems.json
# (Copy colors from stem_palettes.json to src/workers/stems.json)

# 7. Preview visually
open src/stem-palettes.html
```

### Output Format

The script generates `stem_palettes.json`:

```json
{
  "hydrogen": ["#25daf0", "#f024d9", "#daf024", ...],
  "lithium": ["#cf2739", "#39cf27", "#2739cf", ...],
  ...
}
```

## Usage in Mixer

### Channel Strip Colors

Each stem's color is applied to:
- Channel name highlight (when active)
- Waveform visualization
- Pan slider thumb
- FX panel accents
- Mute/Solo button states

### Visual Hierarchy

1. **VOX LEAD** - Most prominent with primary track color
2. **Background Vocals** - Related but distinct hues
3. **Drums/Percussion** - Contrasting colors for clarity
4. **Synths/Keys** - Complementary tones
5. **FX/Atmosphere** - Varied palette colors

## Color Theory Reference

### Complementary Colors
- Opposite on color wheel (180° apart)
- Maximum contrast
- Example: Red ↔ Green, Blue ↔ Orange

### Triadic Colors
- Evenly spaced (120° apart)
- Balanced, vibrant
- Example: Red → Yellow → Blue

### Analogous Colors
- Adjacent on wheel (30° apart)
- Harmonious, related
- Example: Blue → Cyan → Green

### Split-Complementary
- Base + two colors adjacent to complement
- Softer than full complementary
- Example: Blue + Yellow-orange + Red-orange

## Benefits

- **Visual Identification**: Each stem is instantly recognizable by color
- **Track Identity**: Primary color creates cohesive track branding
- **Aesthetic Unity**: Color-theoretic harmony ensures beauty
- **Functional Clarity**: VOX LEAD stands out in every track
- **Accessibility**: High contrast between adjacent stems
- **Scalability**: Works from 9 stems (Rubidium) to 38 stems (Lithium)
