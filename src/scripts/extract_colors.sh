#!/bin/bash
# Extract dominant colors from track artwork using ImageMagick

echo "Extracting dominant colors from track artwork..."
echo "=========================================="

BASE_PATH="<path_to_src_directory>"  # Update this path accordingly

# Function to get dominant color
get_dominant_color() {
    local image_path="$1"
    local track_name="$2"

    if [ ! -f "$image_path" ]; then
        echo "⚠️  File not found: $image_path"
        return
    fi

    # Use ImageMagick to:
    # 1. Resize to 100x100 for faster processing
    # 2. Get color histogram
    # 3. Sort by frequency
    # 4. Get the most common color (excluding very dark/light)

    # Get top 10 colors
    colors=$(convert "$image_path" -resize 100x100 -colors 10 -depth 8 -format "%c" histogram:info:- | \
             grep -v "^ *[0-9]*: *(0,0,0)" | \
             grep -v "^ *[0-9]*: *(255,255,255)" | \
             head -1)

    # Extract RGB values
    rgb=$(echo "$colors" | grep -oE '\([0-9]+,[0-9]+,[0-9]+\)' | head -1)

    if [ -z "$rgb" ]; then
        echo "⚠️  Could not extract color for $track_name"
        return
    fi

    # Parse RGB
    r=$(echo "$rgb" | cut -d'(' -f2 | cut -d',' -f1)
    g=$(echo "$rgb" | cut -d',' -f2)
    b=$(echo "$rgb" | cut -d',' -f3 | cut -d')' -f1)

    # Convert to hex
    hex=$(printf "#%02x%02x%02x" $r $g $b)

    echo "$track_name | RGB($r, $g, $b) | $hex"
    echo "$track_name:$hex" >> /tmp/track_colors.txt
}

# Clear temp file
rm -f /tmp/track_colors.txt

# Process each track
get_dominant_color "$BASE_PATH/1.Hydrogen/artwork/Hydrogen-1000x1000.png" "Hydrogen"
get_dominant_color "$BASE_PATH/2.Lithium/artwork/Lithium-1000x1000.png" "Lithium"
get_dominant_color "$BASE_PATH/3.Sodium/artwork/Sodium-1000x1000.png" "Sodium"
get_dominant_color "$BASE_PATH/4.Potassium/artwork/Potassium-1000x1000.png" "Potassium"
get_dominant_color "$BASE_PATH/5.Rubidium/artwork/Rubidium-1000x1000.png" "Rubidium"
get_dominant_color "$BASE_PATH/6.Caesium/artwork/Caesium-1000x1000.png" "Caesium"
get_dominant_color "$BASE_PATH/7.Francium/artwork/Francium-1000x1000.png" "Francium"

echo ""
echo "=========================================="
echo "JavaScript Object:"
echo "=========================================="
echo "const TRACK_COLORS = {"

while IFS=: read -r track hex; do
    track_lower=$(echo "$track" | tr '[:upper:]' '[:lower:]')
    echo "  '$track_lower': '$hex',"
done < /tmp/track_colors.txt

echo "};"

rm -f /tmp/track_colors.txt
