const sharp = require("sharp");

const MAX_DIM = 320;
const JPEG_QUALITY = 82;
/** Keep data URLs small enough for Render's ~512MB instance + JSON copies. */
const TARGET_MAX_CHARS = 120_000;

const TINY_PLACEHOLDER =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEBAVFRUVFRUQEBAQEBAQFRUWFhUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFhEBAQEAAAAAAAAAAAAAAAAAAAER/9oADAMBAAIQAxAAAAGoAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z";

function parseDataUrl(src) {
  const match = /^data:image\/([\w+.-]+);base64,([\s\S]+)$/i.exec(src);
  if (!match) return null;
  try {
    return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

async function compressDataUrl(src) {
  if (typeof src !== "string" || !src.startsWith("data:image/")) return null;
  if (src.length <= TARGET_MAX_CHARS) return src;

  const parsed = parseDataUrl(src);
  if (!parsed || !parsed.buffer.length) return TINY_PLACEHOLDER;

  try {
    const out = await sharp(parsed.buffer)
      .rotate()
      .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    const compressed = `data:image/jpeg;base64,${out.toString("base64")}`;
    if (compressed.length > TARGET_MAX_CHARS) {
      console.warn(`Compressed image still large (${compressed.length} chars), using smaller quality`);
      const smaller = await sharp(out).jpeg({ quality: 65, mozjpeg: true }).toBuffer();
      return `data:image/jpeg;base64,${smaller.toString("base64")}`;
    }
    return compressed;
  } catch (error) {
    console.error("Image compression failed:", error.message);
    return TINY_PLACEHOLDER;
  }
}

async function compressImageRecords(images) {
  if (!Array.isArray(images)) return false;
  let changed = false;
  for (const img of images) {
    if (!img || typeof img.src !== "string") continue;
    if (img.src.length <= TARGET_MAX_CHARS) continue;
    const before = img.src;
    const next = await compressDataUrl(before);
    if (next && next !== before) {
      img.src = next;
      changed = true;
      console.log(`Compressed image ${img.id}: ${before.length} → ${next.length} chars`);
    }
  }
  return changed;
}

module.exports = {
  compressDataUrl,
  compressImageRecords,
  TARGET_MAX_CHARS,
  TINY_PLACEHOLDER
};
