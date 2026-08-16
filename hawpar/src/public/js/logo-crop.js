/**
 * Client-side logo auto-fit: trims transparent/near-white margins from an
 * uploaded image and pads it into a square canvas so it always renders
 * consistently in the topbar/sidebar regardless of the source image's shape.
 *
 * Deliberately done in the browser with Canvas rather than a server-side
 * image library (e.g. sharp) — this app has no native dependencies and is
 * deployed to a lightweight App Service plan, so keeping image processing
 * client-side avoids adding native-module build/deploy complexity for a
 * cosmetic feature.
 */

const OUTPUT_SIZE = 320;
const BACKGROUND_LUMINANCE_THRESHOLD = 250; // near-white pixels count as "background"
const ALPHA_THRESHOLD = 8; // near-transparent pixels count as "background"

/** @param {File} file @returns {Promise<HTMLImageElement>} */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

/** Finds the bounding box of non-background pixels so we can crop out empty margins. */
function findContentBounds(imageData) {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      const luminance = (data[index] + data[index + 1] + data[index + 2]) / 3;
      const isBackground = alpha < ALPHA_THRESHOLD || (alpha > 0 && luminance > BACKGROUND_LUMINANCE_THRESHOLD);
      if (isBackground) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null; // fully blank image — nothing to crop
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Auto-crops whitespace/transparent margins from `file` and pads the result
 * into a square PNG data URL, ready to store in `branding.logoDataUrl`.
 * @param {File} file
 * @param {number} [maxBytes] Reject (throw) if the encoded result exceeds this size.
 * @returns {Promise<{dataUrl: string, width: number, height: number}>}
 */
export async function autoCropLogo(file, maxBytes = 300_000) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (PNG, JPEG, WebP or SVG).');
  }

  const image = await loadImage(file);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth || image.width;
  sourceCanvas.height = image.naturalHeight || image.height;
  const sourceCtx = sourceCanvas.getContext('2d');
  sourceCtx.drawImage(image, 0, 0);

  let bounds;
  try {
    bounds = findContentBounds(sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height));
  } catch {
    // SVGs and cross-origin sources can taint the canvas — fall back to using
    // the whole image untouched rather than failing the upload outright.
    bounds = null;
  }
  bounds ??= { x: 0, y: 0, width: sourceCanvas.width, height: sourceCanvas.height };

  // Fit the cropped content into the output square with a small margin so the
  // logo never touches the edge of its badge in the topbar/sidebar.
  const padding = 0.08;
  const scale = ((1 - padding * 2) * OUTPUT_SIZE) / Math.max(bounds.width, bounds.height);
  const drawWidth = bounds.width * scale;
  const drawHeight = bounds.height * scale;

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = OUTPUT_SIZE;
  outputCanvas.height = OUTPUT_SIZE;
  const outputCtx = outputCanvas.getContext('2d');
  outputCtx.imageSmoothingQuality = 'high';
  outputCtx.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    (OUTPUT_SIZE - drawWidth) / 2,
    (OUTPUT_SIZE - drawHeight) / 2,
    drawWidth,
    drawHeight
  );

  const dataUrl = outputCanvas.toDataURL('image/png');
  if (dataUrl.length > maxBytes) {
    throw new Error('The cropped logo is still too large. Try a simpler or smaller source image.');
  }

  return { dataUrl, width: OUTPUT_SIZE, height: OUTPUT_SIZE };
}
