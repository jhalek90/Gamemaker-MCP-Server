/**
 * A minimal PNG encoder.
 *
 * Only what sprites need: 8-bit RGBA, no interlacing, one IDAT. Node's zlib
 * does the compression, so this is chunk framing and CRC — a few dozen lines
 * rather than a dependency.
 */

import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Standard PNG CRC-32, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Encode RGBA pixels as a PNG.
 *
 * `pixels` is row-major, four bytes per pixel. Every scanline gets filter
 * type 0 (None); the images sprites use are small and mostly flat, so the
 * better filters buy little and cost clarity.
 */
export function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  if (pixels.length !== width * height * 4) {
    throw new RangeError(
      `Expected ${width * height * 4} bytes for ${width}x${height} RGBA, got ${pixels.length}`,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter method: adaptive
  header[12] = 0; // interlace: none

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface PngInfo {
  width: number;
  height: number;
}

/** Read dimensions from a PNG's header, for validating supplied images. */
export function readPngInfo(data: Buffer): PngInfo {
  if (data.length < 24 || !data.subarray(0, 8).equals(SIGNATURE)) {
    throw new TypeError('Not a PNG file');
  }
  if (data.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new TypeError('PNG is missing its IHDR chunk');
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
