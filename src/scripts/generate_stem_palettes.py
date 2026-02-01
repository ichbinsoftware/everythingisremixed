#!/usr/bin/env python3
"""
Generate harmonious color palettes for each track's stems.
Uses the primary track color for VOX LEAD and generates complementary colors for other stems.
"""

import colorsys
import json

# Track primary colors (from artwork)
TRACK_COLORS = {
    'hydrogen': '#25daf0',   # Cyan
    'lithium': '#cf2739',    # Red
    'sodium': '#f7ca47',     # Yellow
    'potassium': '#8f01ff',  # Purple
    'rubidium': '#c71585',   # Magenta
    'caesium': '#afa0ef',    # Lavender
    'francium': '#c1c1c1',   # Gray
}

# Number of stems per track (approximate, we'll generate enough colors)
TRACK_STEM_COUNTS = {
    'hydrogen': 12,
    'lithium': 38,
    'sodium': 28,
    'potassium': 19,
    'rubidium': 9,
    'caesium': 16,
    'francium': 26,
}

def hex_to_rgb(hex_color):
    """Convert hex to RGB (0-255)."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def rgb_to_hex(rgb):
    """Convert RGB (0-255) to hex."""
    return '#{:02x}{:02x}{:02x}'.format(int(rgb[0]), int(rgb[1]), int(rgb[2]))

def rgb_to_hsl(rgb):
    """Convert RGB (0-255) to HSL (0-1)."""
    r, g, b = [x / 255.0 for x in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return (h, s, l)

def hsl_to_rgb(hsl):
    """Convert HSL (0-1) to RGB (0-255)."""
    h, s, l = hsl
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return (r * 255, g * 255, b * 255)

def adjust_color(base_color_hex, hue_shift=0, saturation_factor=1.0, lightness_factor=1.0):
    """
    Adjust a color by shifting hue and scaling saturation/lightness.
    hue_shift: degrees (0-360)
    saturation_factor: multiplier (0-1+)
    lightness_factor: multiplier (0-1+)
    """
    rgb = hex_to_rgb(base_color_hex)
    h, s, l = rgb_to_hsl(rgb)

    # Shift hue
    h = (h + hue_shift / 360.0) % 1.0

    # Adjust saturation and lightness
    s = min(1.0, s * saturation_factor)
    l = min(1.0, max(0.0, l * lightness_factor))

    rgb_new = hsl_to_rgb((h, s, l))
    return rgb_to_hex(rgb_new)

def generate_palette(base_color_hex, num_colors, scheme='analogous'):
    """
    Generate a color palette based on color theory.

    Schemes:
    - 'analogous': Colors adjacent on the color wheel
    - 'complementary': Colors opposite on the color wheel
    - 'triadic': Colors evenly spaced (120°) on the color wheel
    - 'tetradic': Colors forming a square (90°) on the color wheel
    - 'split-complementary': Base + two colors adjacent to complement
    - 'monochromatic': Variations of the base color
    """
    palette = [base_color_hex]  # Start with base color

    if scheme == 'analogous':
        # Colors 30° apart on color wheel
        angles = [30, -30, 60, -60, 90, -90, 120, -120]
        for angle in angles[:num_colors-1]:
            palette.append(adjust_color(base_color_hex, hue_shift=angle))

    elif scheme == 'complementary':
        # Opposite + variations
        palette.append(adjust_color(base_color_hex, hue_shift=180))
        # Add variations
        for i in range(2, num_colors):
            angle = 180 + ((i-1) * 30)
            palette.append(adjust_color(base_color_hex, hue_shift=angle))

    elif scheme == 'triadic':
        # 120° spacing
        palette.append(adjust_color(base_color_hex, hue_shift=120))
        palette.append(adjust_color(base_color_hex, hue_shift=240))
        # Fill with variations
        for i in range(3, num_colors):
            angle = (i * 40) % 360
            palette.append(adjust_color(base_color_hex, hue_shift=angle))

    elif scheme == 'tetradic':
        # 90° spacing (square)
        palette.append(adjust_color(base_color_hex, hue_shift=90))
        palette.append(adjust_color(base_color_hex, hue_shift=180))
        palette.append(adjust_color(base_color_hex, hue_shift=270))
        # Fill with variations
        for i in range(4, num_colors):
            angle = (i * 45) % 360
            palette.append(adjust_color(base_color_hex, hue_shift=angle))

    elif scheme == 'split-complementary':
        # Base + 150° and 210°
        palette.append(adjust_color(base_color_hex, hue_shift=150))
        palette.append(adjust_color(base_color_hex, hue_shift=210))
        # Fill with variations
        for i in range(3, num_colors):
            angle = (i * 30) % 360
            palette.append(adjust_color(base_color_hex, hue_shift=angle))

    elif scheme == 'monochromatic':
        # Variations of lightness and saturation
        for i in range(1, num_colors):
            lightness_factor = 0.6 + (i * 0.15)
            saturation_factor = 0.7 + (i * 0.1)
            palette.append(adjust_color(base_color_hex,
                                       lightness_factor=lightness_factor,
                                       saturation_factor=saturation_factor))

    return palette[:num_colors]

def generate_rich_palette(base_color_hex, num_colors):
    """
    Generate a rich, varied palette using multiple color theory schemes.
    This creates visually distinct colors that work well together.
    """
    palette = [base_color_hex]  # VOX LEAD gets the primary color

    # For a rich palette, use a combination of schemes
    # Triadic for main variation
    palette.append(adjust_color(base_color_hex, hue_shift=120))
    palette.append(adjust_color(base_color_hex, hue_shift=240))

    # Split complementary
    if num_colors > 3:
        palette.append(adjust_color(base_color_hex, hue_shift=150))
        palette.append(adjust_color(base_color_hex, hue_shift=210))

    # Analogous variations
    if num_colors > 5:
        palette.append(adjust_color(base_color_hex, hue_shift=30))
        palette.append(adjust_color(base_color_hex, hue_shift=-30))

    # Additional varied colors
    remaining = num_colors - len(palette)
    if remaining > 0:
        step = 360 // remaining
        for i in range(remaining):
            angle = (60 + i * step) % 360
            # Vary saturation and lightness for more variety
            sat_factor = 0.8 + (i % 3) * 0.1
            light_factor = 0.9 + (i % 4) * 0.05
            palette.append(adjust_color(base_color_hex,
                                       hue_shift=angle,
                                       saturation_factor=sat_factor,
                                       lightness_factor=light_factor))

    return palette[:num_colors]

# Generate palettes for each track
print("="*80)
print("STEM COLOR PALETTES - Everything is Free")
print("="*80)
print()

palettes = {}

for track, base_color in TRACK_COLORS.items():
    num_stems = TRACK_STEM_COUNTS[track]

    print(f"\n{track.upper()}")
    print(f"Base Color: {base_color}")
    print(f"Stems: {num_stems}")
    print("-" * 40)

    # Generate rich palette
    palette = generate_rich_palette(base_color, num_stems)

    palettes[track] = palette

    # Print palette
    for i, color in enumerate(palette):
        print(f"  {i+1:2}. {color}")

# Save as JSON
with open('stem_palettes.json', 'w') as f:
    json.dump(palettes, f, indent=2)

print("\n" + "="*80)
print("Palettes saved to stem_palettes.json")
print("="*80)
