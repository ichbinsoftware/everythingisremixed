// ==========================================
// 3D Holographic Visualizer Worker
// "The City Landscape"
// ==========================================
//
// Renders a 3D wireframe grid that responds to audio frequency data.
// Paired with Holograph class in mixer-visualizer.js (main thread bridge).
// Uses OffscreenCanvas for off-main-thread rendering.
//
// Performance optimizations:
// - Pre-allocated arrays (zero GC in render loop)
// - Cached projection constants (centerX, centerY)
// - Cached color strings (glowColor)
// - Fake glow effect (2-pass drawing vs expensive shadowBlur)
// - Conditional shadow (only when peaks exist)
// - Row recycling (popped row becomes next newRow)
// ==========================================

let canvas = null;
let ctx = null;
let width = 0;
let height = 0;
let colorMap = []; // Array of 256 RGB strings for amplitude-to-color mapping
let themeColorRgb = null; // RGB object for glow effect
let isLightMode = false; // Theme mode

// Grid Configuration
const GRID_ROWS = 40;  // History depth (how far back in time)
const GRID_COLS = 24;  // Frequency bands (Low Poly for style + performance)
const GRID_SPACING = 30; // 3D world units between grid points

// Cached projection constants (recalculated on resize)
let centerX = 0;
let centerY = 0;
const FOV = 300;         // Field of view (affects perspective distortion)
const VIEW_DISTANCE = 150; // Camera distance from grid origin

// Pre-allocated arrays (avoid GC pressure in render loop)
let newRow = new Array(GRID_COLS); // Reused for each new audio frame
let points = [];  // 2D array of projected {x, y} screen coordinates
let glowColor = ''; // Cached RGB string for glow effect

// State
let gridData = []; // 2D array [row][col] -> amplitude (0-255)

self.onmessage = function(e) {
  const { type, payload } = e.data;
  switch (type) {
    case 'init': init(payload); break;
    case 'resize': resize(payload); break;
    case 'draw': draw(payload); break;
    case 'theme':
      isLightMode = payload.isLight;
      if (ctx && width && height) {
        ctx.fillStyle = isLightMode ? '#e0e0e0' : '#0a0a0a';
        ctx.fillRect(0, 0, width, height);
      }
      break;
  }
};

function init({ canvas: c, themeColor: color, isLight }) {
  canvas = c;
  ctx = canvas.getContext('2d', { alpha: false });
  const baseColor = color || '#00ffcc';
  isLightMode = isLight || false;

  // Store RGB for glow effect
  themeColorRgb = hexToRgb(baseColor);

  // Cache glow color string (avoid string concat every frame)
  glowColor = `rgb(${themeColorRgb.r},${themeColorRgb.g},${themeColorRgb.b})`;

  // Generate gradient: Dim Base -> Track Color -> Bright White
  // Boosted dimness to 60% for visibility
  colorMap = generateGradient(baseColor);

  // Initialize grid with zeros
  gridData = Array(GRID_ROWS).fill(0).map(() => Array(GRID_COLS).fill(0));

  // Pre-allocate points array structure with reusable objects
  points = Array(GRID_ROWS).fill(null).map(() => 
    Array(GRID_COLS).fill(null).map(() => ({ x: 0, y: 0, visible: false }))
  );
}

function resize({ width: w, height: h }) {
  width = w;
  height = h;
  canvas.width = width;
  canvas.height = height;

  // Cache projection constants
  centerX = width / 2;
  centerY = height / 2 - 40;

  // Initial clear with correct background
  if (ctx) {
    ctx.fillStyle = isLightMode ? '#e0e0e0' : '#0a0a0a';
    ctx.fillRect(0, 0, width, height);
  }
}

function draw({ frequency }) {
  if (!ctx || !width || !height) return;

  // 1. Process Audio Data (reuse pre-allocated newRow)
  const bucketSize = Math.floor(frequency.length / GRID_COLS);
  let hasPeaks = false;

  for (let i = 0; i < GRID_COLS; i++) {
    let sum = 0;
    const start = i * bucketSize;
    for (let j = 0; j < bucketSize; j++) {
      sum += frequency[start + j];
    }
    const amp = Math.min(255, (sum / bucketSize) * 2.0);
    newRow[i] = amp;
    if (amp >= 160) hasPeaks = true;
  }

  // Shift grid data (reuse the popped row as newRow for next frame)
  const recycledRow = gridData.pop();
  gridData.unshift(newRow);
  newRow = recycledRow;

  // 2. Render 3D Frame
  ctx.fillStyle = isLightMode ? '#e0e0e0' : '#0a0a0a';
  ctx.fillRect(0, 0, width, height);

  // Update pre-allocated points array (In-place mutation)
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      project(c, r, gridData[r][c], points[r][c]);
    }
  }

  // BATCH RENDERING: 3 Layers
  const MID_THRESH = 60;
  const PEAK_THRESH = 160;

  // --- PASS 1: Base Grid (Dim Color) ---
  ctx.beginPath();
  ctx.strokeStyle = colorMap[40];
  ctx.lineWidth = 1;
  drawGridLines(ctx, points, gridData, 0);
  ctx.stroke();

  // --- PASS 2: Mids (Bright Color) ---
  ctx.beginPath();
  ctx.strokeStyle = colorMap[120];
  ctx.lineWidth = 1.5;
  drawGridLines(ctx, points, gridData, MID_THRESH);
  ctx.stroke();

  // --- PASS 3: Peaks (White) with Glow (only if peaks exist) ---
  if (hasPeaks) {
    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    drawGridLines(ctx, points, gridData, PEAK_THRESH);
    ctx.stroke();
    ctx.restore();
  }

  // --- PASS 4: "Now" Line at Front Edge (fake glow - no shadowBlur) ---
  drawNowLine(ctx, points);
}

function drawNowLine(ctx, points) {
  if (!points[0] || points[0].length === 0) return;

  const frontRow = points[0];

  // Fake glow: draw thick colored line first, then thin white on top
  // Much cheaper than shadowBlur

  // Layer 1: Thick glow color
  ctx.beginPath();
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = 6;
  for (let c = 0; c < GRID_COLS; c++) {
    const p = frontRow[c];
    if (!p.visible) continue;
    if (c === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // Layer 2: Thin white line on top
  ctx.beginPath();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  for (let c = 0; c < GRID_COLS; c++) {
    const p = frontRow[c];
    if (!p.visible) continue;
    if (c === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawGridLines(ctx, points, gridData, minAmp) {
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const p1 = points[r][c];
      if (!p1.visible) continue;
      
      const amp = gridData[r][c];
      
      // Draw Horizontal (to left)
      if (c > 0) {
        const prevAmp = gridData[r][c-1];
        // Only draw if this segment meets the amplitude threshold
        if (Math.max(amp, prevAmp) >= minAmp) {
            const p2 = points[r][c-1];
            if (p2.visible) {
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
            }
        }
      }

      // Draw Vertical (to back)
      if (r > 0) {
        const prevAmp = gridData[r-1][c];
        if (Math.max(amp, prevAmp) >= minAmp) {
            const p3 = points[r-1][c];
            if (p3.visible) {
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p3.x, p3.y);
            }
        }
      }
    }
  }
}

function project(c, r, amp, outPoint) {
  const x3d = (c - GRID_COLS / 2) * GRID_SPACING;
  const z3d = r * GRID_SPACING;
  // Lowered floor to Y=60 for more headroom
  const y3d = 60 - (amp * 0.7);

  const scale = FOV / (VIEW_DISTANCE + z3d);
  
  if (scale <= 0) {
      outPoint.visible = false;
      return;
  }

  outPoint.x = centerX + x3d * scale;
  outPoint.y = centerY + y3d * scale;
  outPoint.visible = true;
}

// ==========================================
// Gradient Generation
// ==========================================
function generateGradient(hexColor) {
  const map = new Array(256);
  const rgb = hexToRgb(hexColor);
  
  // Brightened dim color (60% brightness)
  const dim = {
    r: Math.floor(rgb.r * 0.6),
    g: Math.floor(rgb.g * 0.6),
    b: Math.floor(rgb.b * 0.6)
  };
  
  const white = { r: 255, g: 255, b: 255 };
  
  for (let i = 0; i < 256; i++) {
    let r, g, b;
    if (i < 100) {
      // Shorter transition to full color (0-100)
      const f = i / 100;
      r = Math.floor(dim.r + (rgb.r - dim.r) * f);
      g = Math.floor(dim.g + (rgb.g - dim.g) * f);
      b = Math.floor(dim.b + (rgb.b - dim.b) * f);
    } else {
      // Longer transition to white (100-255)
      const f = (i - 100) / 155;
      r = Math.floor(rgb.r + (white.r - rgb.r) * f);
      g = Math.floor(rgb.g + (white.g - rgb.g) * f);
      b = Math.floor(rgb.b + (white.b - rgb.b) * f);
    }
    map[i] = `rgb(${r},${g},${b})`;
  }
  return map;
}

function hexToRgb(hex) {
  return {
    r: parseInt(hex.substring(1, 3), 16),
    g: parseInt(hex.substring(3, 5), 16),
    b: parseInt(hex.substring(5, 7), 16)
  };
}
