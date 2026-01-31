#!/usr/bin/env python3
"""Extract dominant colors from track artwork images."""

import os
from collections import Counter
from PIL import Image

# Track directories
tracks = [
    ('1.Hydrogen', 'Hydrogen'),
    ('2.Lithium', 'Lithium'),
    ('3.Sodium', 'Sodium'),
    ('4.Potassium', 'Potassium'),
    ('5.Rubidium', 'Rubidium'),
    ('6.Caesium', 'Caesium'),
    ('7.Francium', 'Francium'),
]

base_path = '<path_to_src_directory>'  # Update this path accordingly

def get_dominant_color(image_path, n_colors=5):
    """Extract the dominant color from an image."""
    try:
        # Open image and convert to RGB
        img = Image.open(image_path)
        img = img.convert('RGB')

        # Resize for faster processing
        img = img.resize((150, 150))

        # Get all pixels
        pixels = list(img.getdata())

        # Count colors
        color_counter = Counter(pixels)

        # Get most common colors
        most_common = color_counter.most_common(n_colors)

        # Filter out very dark (nearly black) and very light (nearly white) colors
        # as they're often backgrounds
        filtered_colors = []
        for color, count in most_common:
            r, g, b = color
            brightness = (r + g + b) / 3
            # Skip if too dark or too bright
            if 20 < brightness < 235:
                filtered_colors.append((color, count))

        # If we filtered everything, just use the most common
        if not filtered_colors:
            filtered_colors = most_common[:1]

        dominant = filtered_colors[0][0]
        return dominant

    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return None

def rgb_to_hex(rgb):
    """Convert RGB tuple to hex string."""
    return '#{:02x}{:02x}{:02x}'.format(rgb[0], rgb[1], rgb[2])

# Process each track
results = []
for folder, name in tracks:
    # Try the main artwork file
    artwork_path = os.path.join(base_path, folder, 'artwork', f'{name}.png')

    if not os.path.exists(artwork_path):
        # Try 1000x1000 version
        artwork_path = os.path.join(base_path, folder, 'artwork', f'{name}-1000x1000.png')

    if os.path.exists(artwork_path):
        print(f"Processing {name}...")
        dominant_color = get_dominant_color(artwork_path)

        if dominant_color:
            hex_color = rgb_to_hex(dominant_color)
            results.append({
                'track': name,
                'rgb': dominant_color,
                'hex': hex_color
            })
            print(f"  {name}: RGB{dominant_color} → {hex_color}")
    else:
        print(f"⚠️  Artwork not found for {name}")

# Print summary
print("\n" + "="*60)
print("SUMMARY - Track Colors")
print("="*60)
for result in results:
    print(f"{result['track']:12} | {result['hex']:8} | RGB{result['rgb']}")

# Generate JavaScript object
print("\n" + "="*60)
print("JavaScript Object:")
print("="*60)
print("const TRACK_COLORS = {")
for result in results:
    track_id = result['track'].lower()
    print(f"  '{track_id}': '{result['hex']}',")
print("};")
