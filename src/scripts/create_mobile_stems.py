#!/usr/bin/env python3
"""
Create mobile-optimized versions of M4A stem files.

This script processes M4A files using stem-specific optimization settings from stems.json:
- Stems with mono=true: 16,000 Hz, 48 kbps, mono
- Stems with downSample=true: 16,000 Hz, 48 kbps, stereo
- Other stems: 16,000 Hz, 48 kbps, stereo (aggressive optimization for mobile)

Output files are saved with "_mobile" appended to the filename.
Example: "7.Francium_Stem_VOX LEAD.m4a" → "7.Francium_Stem_VOX LEAD_mobile.m4a"

Uses macOS built-in afconvert tool (no external dependencies required).

Usage:
    python3 create_mobile_stems.py /path/to/stems/folder [stems.json path]
    eg  python3 create_mobile_stems.py ../1.Hydrogen

    If stems.json path is not provided, will look for it in:
    - /path/to/stems/folder/stems.json
    - ./stems.json (current directory)
    - ../workers/stems.json (relative to script)
"""

import sys
import subprocess
import json
from pathlib import Path


def process_m4a_file(input_path, output_path, sample_rate=16000, bitrate=48000, mono=False):
    """
    Convert M4A file to mobile-optimized version using macOS afconvert.

    Args:
        input_path: Path to input M4A file
        output_path: Path to output M4A file
        sample_rate: Target sample rate in Hz (default: 16000)
        bitrate: Target bitrate in bits per second (default: 48000)
        mono: Convert to mono if True (default: False)

    Returns:
        Tuple of (success: bool, actual_mono: bool) - actual_mono indicates if mono conversion succeeded
    """
    # If mono requested, try mono conversion first with ffmpeg-style approach via sox/afconvert tricks
    # Since afconvert doesn't have simple mono flags, we'll use a two-pass approach:
    # 1. Try with stereo first (always works)
    # 2. If mono needed, use afconvert with channel mixer strategy

    try:
        if mono:
            # Try mono conversion with mixing strategy
            cmd = [
                "afconvert",
                "-f", "m4af",              # M4A file format
                "-d", "aac",               # AAC data format
                "-b", str(bitrate),        # Bitrate in bits per second
                "-r", str(sample_rate),    # Sample rate
                "-s", "3",                 # Mixing strategy: 3 = mix to mono
                str(input_path),
                str(output_path)
            ]

            # Run afconvert
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True
            )
            return True, True  # Success with mono

        else:
            # Standard stereo conversion
            cmd = [
                "afconvert",
                "-f", "m4af",              # M4A file format
                "-d", "aac",               # AAC data format
                "-b", str(bitrate),        # Bitrate in bits per second
                "-r", str(sample_rate),    # Sample rate
                str(input_path),
                str(output_path)
            ]

            # Run afconvert
            subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True
            )
            return True, False  # Success with stereo

    except subprocess.CalledProcessError as e:
        # If mono conversion failed, try stereo fallback
        if mono:
            print(f"  ⚠ Mono conversion failed, trying stereo fallback...")
            try:
                cmd = [
                    "afconvert",
                    "-f", "m4af",
                    "-d", "aac",
                    "-b", str(bitrate),
                    "-r", str(sample_rate),
                    str(input_path),
                    str(output_path)
                ]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
                return True, False  # Success with stereo fallback
            except subprocess.CalledProcessError as e2:
                error_msg = e2.stderr.decode() if e2.stderr else str(e2)
                print(f"  ✗ Error processing file: {error_msg}")
                return False, False
        else:
            error_msg = e.stderr.decode() if e.stderr else str(e)
            print(f"  ✗ Error processing file: {error_msg}")
            return False, False
    except Exception as e:
        print(f"  ✗ Unexpected error: {str(e)}")
        return False, False


def load_stems_config(folder_path, stems_json_path=None):
    """
    Load stems.json configuration file.

    Args:
        folder_path: Path to folder containing M4A files
        stems_json_path: Optional explicit path to stems.json

    Returns:
        Dictionary mapping filename to stem config, or None if not found
    """
    # Try to find stems.json
    search_paths = []

    if stems_json_path:
        search_paths.append(Path(stems_json_path))

    search_paths.extend([
        Path(folder_path) / "stems.json",
        Path.cwd() / "stems.json",
        Path(__file__).parent.parent / "workers" / "stems.json",
    ])

    for path in search_paths:
        if path.exists():
            try:
                with open(path, 'r') as f:
                    data = json.load(f)
                    print(f"✓ Loaded stems configuration from: {path}\n")

                    # Build filename → config mapping
                    stem_map = {}
                    for track_stems in data.values():
                        for stem in track_stems:
                            stem_map[stem['filename']] = stem

                    return stem_map
            except Exception as e:
                print(f"Warning: Found stems.json but couldn't parse it: {e}")
                continue

    print("Warning: stems.json not found. Using default settings for all files.\n")
    return None


def create_mobile_stems(folder_path, stems_json_path=None):
    """
    Process all M4A files in the given folder using stems.json metadata.

    Args:
        folder_path: Path to folder containing M4A files
        stems_json_path: Optional path to stems.json file
    """
    folder = Path(folder_path)

    if not folder.exists():
        print(f"Error: Folder not found: {folder_path}")
        sys.exit(1)

    if not folder.is_dir():
        print(f"Error: Path is not a directory: {folder_path}")
        sys.exit(1)

    # Load stems configuration
    stem_configs = load_stems_config(folder_path, stems_json_path)

    # Find all M4A files
    m4a_files = list(folder.glob("*.m4a"))

    if not m4a_files:
        print(f"No M4A files found in {folder_path}")
        sys.exit(0)

    print(f"Found {len(m4a_files)} M4A file(s) in {folder_path}\n")

    # Check if afconvert is available (should be on all macOS systems)
    try:
        subprocess.run(
            ["afconvert", "-h"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False  # afconvert -h returns non-zero, so don't check
        )
    except FileNotFoundError:
        print("Error: afconvert not found. This script requires macOS.")
        sys.exit(1)

    # Process each file
    success_count = 0
    failed_count = 0

    for input_file in m4a_files:
        # Skip files that already have _mobile suffix
        if "_mobile" in input_file.stem:
            print(f"⊘ Skipping (already mobile): {input_file.name}")
            continue

        # Create output filename with _mobile suffix
        output_file = input_file.parent / f"{input_file.stem}_mobile{input_file.suffix}"

        # Get stem configuration for this file
        stem_config = stem_configs.get(input_file.name) if stem_configs else None

        # Determine settings based on stem config
        if stem_config:
            # Use aggressive mobile optimization: 16kHz, 48kbps for all
            sample_rate = 16000
            bitrate = 48000
            mono = stem_config.get('mono', False)

            settings_str = f"16kHz, 48kbps"
            if mono:
                settings_str += ", mono"
            else:
                settings_str += ", stereo"
        else:
            # Default fallback if no config found
            sample_rate = 16000
            bitrate = 48000
            mono = False
            settings_str = "16kHz, 48kbps, stereo (default)"

        print(f"Processing: {input_file.name}")
        print(f"  Settings: {settings_str}")
        print(f"  → {output_file.name}")

        # Process the file
        success, actual_mono = process_m4a_file(input_file, output_file, sample_rate, bitrate, mono)

        if success:
            # Get file sizes for comparison
            input_size = input_file.stat().st_size / (1024 * 1024)  # MB
            output_size = output_file.stat().st_size / (1024 * 1024)  # MB
            reduction = ((input_size - output_size) / input_size) * 100

            print(f"  ✓ Success! {input_size:.2f} MB → {output_size:.2f} MB ({reduction:.1f}% reduction)")
            if mono and not actual_mono:
                print(f"  ℹ Note: Used stereo (mono conversion not supported by afconvert)")
            print()
            success_count += 1
        else:
            failed_count += 1
            print()

    # Summary
    print("=" * 60)
    print(f"Processing complete!")
    print(f"  Successful: {success_count}")
    print(f"  Failed: {failed_count}")
    print(f"  Skipped: {len(m4a_files) - success_count - failed_count}")


def main():
    """Main entry point for the script."""
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print("Usage: python3 create_mobile_stems.py <folder_path> [stems.json path]")
        print("\nExamples:")
        print("  python3 create_mobile_stems.py /path/to/stems")
        print("  python3 create_mobile_stems.py /path/to/stems ./stems.json")
        print("\nSettings applied based on stems.json metadata:")
        print("  • Stems with mono=true: 16kHz, 48kbps, mono (~50% smaller)")
        print("  • All other stems: 16kHz, 48kbps, stereo")
        sys.exit(1)

    folder_path = sys.argv[1]
    stems_json_path = sys.argv[2] if len(sys.argv) == 3 else None
    create_mobile_stems(folder_path, stems_json_path)


if __name__ == "__main__":
    main()
