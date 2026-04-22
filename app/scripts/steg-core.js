const W = 1920;
const H = 1080;
const MATRIX_K = 5;
const MATRIX_PLANE = 4;
const CHANNELS = 3;
const te = new TextEncoder();
const td = new TextDecoder();
const MAGIC = te.encode('STEGMP3\0');
const VERSION = 1;
const FIXED_HEADER_LEN = 8 + 1 + 1 + 2 + 4 + 4 + 4 + 32 + 2;
const MATRIX5_CAPACITY_BITS = capacityBitsForMode(W, H, MATRIX_K, MATRIX_PLANE);
const LSB_CAPACITY_BYTES = Math.floor(MATRIX5_CAPACITY_BITS / 8);
const webCrypto = globalThis.crypto?.subtle || null;
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H_ROWS = [0b1010101, 0b1100110, 0b1111000];

function u16be(n) { return new Uint8Array([(n >>> 8) & 0xff, n & 0xff]); }
function u32be(n) { return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]); }
function readU16be(buf, off) { return (buf[off] << 8) | buf[off + 1]; }
function readU32be(buf, off) { return (buf[off] * 2 ** 24) + (buf[off + 1] << 16) + (buf[off + 2] << 8) + buf[off + 3]; }
function concatBytes(...arrs) {
  const total = arrs.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrs) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}
function rotr(word, bits) {
  return (word >>> bits) | (word << (32 - bits));
}
function sha256Fallback(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const bitLen = input.length * 8;
  const paddedLen = (((input.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLen);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLen / 0x100000000);
  const low = bitLen >>> 0;
  view.setUint32(paddedLen - 8, high, false);
  view.setUint32(paddedLen - 4, low, false);

  const w = new Uint32Array(64);
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + (i * 4), false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < state.length; i += 1) outView.setUint32(i * 4, state[i], false);
  return out;
}
async function sha256(bytes) {
  if (webCrypto) return new Uint8Array(await webCrypto.digest('SHA-256', bytes));
  return sha256Fallback(bytes);
}
function hex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function humanBytes(n) {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let value = n;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'track';
}
function toDataUrl(bytes, mime = 'image/png') {
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}
function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
function capacityBitsForMode(width, height, k, matrixPlane) {
  const carriers = width * height * CHANNELS;
  const plainBits = carriers * (k - 1);
  const matrixBits = Math.floor(carriers / 7) * 3;
  return plainBits + matrixBits;
}
function enumerateCarriers() {
  const coords = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      coords.push([x, y, 0]);
      coords.push([x, y, 1]);
      coords.push([x, y, 2]);
    }
  }
  return coords;
}
function bytesToBits(bytes) {
  const bits = [];
  for (const b of bytes) {
    for (let shift = 7; shift >= 0; shift -= 1) bits.push((b >> shift) & 1);
  }
  return bits;
}
function bitsToBytes(bits) {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  let byteIndex = 0;
  let bitOffset = 0;
  for (const bit of bits) {
    out[byteIndex] |= bit << (7 - bitOffset);
    bitOffset += 1;
    if (bitOffset === 8) {
      bitOffset = 0;
      byteIndex += 1;
    }
  }
  return out;
}
function popcount(n) {
  let c = 0;
  let x = n >>> 0;
  while (x) {
    x &= x - 1;
    c += 1;
  }
  return c;
}
function syndrome7(bits7) {
  let s = 0;
  for (let i = 0; i < H_ROWS.length; i += 1) {
    s |= ((popcount(bits7 & H_ROWS[i]) & 1) << i);
  }
  return s;
}
function embedHammingGroup(planeBits7, payload3) {
  const s = syndrome7(planeBits7);
  const diff = s ^ payload3;
  if (diff === 0) return planeBits7;
  return planeBits7 ^ (1 << (diff - 1));
}
function extractHammingGroup(planeBits7) {
  return syndrome7(planeBits7);
}
function findPngEndOffset(pngBytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) {
    if (pngBytes[i] !== sig[i]) throw new Error('Not a PNG (bad signature).');
  }
  let off = 8;
  while (off + 12 <= pngBytes.length) {
    const len = readU32be(pngBytes, off);
    const type = String.fromCharCode(pngBytes[off + 4], pngBytes[off + 5], pngBytes[off + 6], pngBytes[off + 7]);
    const chunkTotal = 12 + len;
    if (off + chunkTotal > pngBytes.length) throw new Error('Corrupt PNG (chunk overrun).');
    if (type === 'IEND') return off + chunkTotal;
    off += chunkTotal;
  }
  throw new Error('Could not find IEND chunk.');
}
function fitImageToCanvas(image, canvas, mode = 'contain') {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const scale = mode === 'cover' ? Math.max(W / image.width, H / image.height) : Math.min(W / image.width, H / image.height);
  const drawW = Math.round(image.width * scale);
  const drawH = Math.round(image.height * scale);
  const dx = Math.floor((W - drawW) / 2);
  const dy = Math.floor((H - drawH) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, dx, dy, drawW, drawH);
}
async function drawCoverToCanvas(file, canvas, mode = 'contain') {
  const bmp = await createImageBitmap(file);
  try {
    fitImageToCanvas(bmp, canvas, mode);
  } finally {
    bmp.close?.();
  }
}
async function buildPayload(mp3Bytes, mp3Name, capacityBytes) {
  const nameBytes = te.encode(mp3Name || 'hidden.mp3');
  const mp3Hash = await sha256(mp3Bytes);
  const headerLen = FIXED_HEADER_LEN + nameBytes.length;
  const lsbMp3Len = Math.min(mp3Bytes.length, Math.max(0, capacityBytes - headerLen));
  const trailLen = mp3Bytes.length - lsbMp3Len;
  const header = concatBytes(
    MAGIC,
    new Uint8Array([VERSION]),
    new Uint8Array([0]),
    u16be(headerLen),
    u32be(mp3Bytes.length >>> 0),
    u32be(lsbMp3Len >>> 0),
    u32be(trailLen >>> 0),
    mp3Hash,
    u16be(nameBytes.length),
    nameBytes,
  );
  return {
    payload: concatBytes(header, mp3Bytes.slice(0, lsbMp3Len)),
    trailing: mp3Bytes.slice(lsbMp3Len),
    lsbMp3Len,
    trailLen,
    mp3Hash,
  };
}
function embedPlanesIntoImageData(imageData, payloadBytes, k, matrixPlane) {
  const data = imageData.data;
  const coords = enumerateCarriers();
  const values = new Uint8Array(coords.length);
  for (let i = 0; i < coords.length; i += 1) {
    const [x, y, ch] = coords[i];
    values[i] = data[(y * W * 4) + (x * 4) + ch];
  }
  const bits = bytesToBits(payloadBytes);
  let bitCursor = 0;
  for (let plane = 0; plane < k; plane += 1) {
    const maskSet = 1 << plane;
    const maskClr = 0xFF ^ maskSet;
    if (plane === matrixPlane) {
      for (let i = 0; i + 7 <= values.length && bitCursor < bits.length; i += 7) {
        let g = 0;
        for (let j = 0; j < 7; j += 1) g |= (((values[i + j] >> plane) & 1) << j);
        const take = Math.min(3, bits.length - bitCursor);
        let m = 0;
        for (let j = 0; j < take; j += 1) m |= bits[bitCursor + j] << j;
        bitCursor += take;
        const g2 = embedHammingGroup(g, m);
        const diff = g ^ g2;
        if (diff) {
          for (let j = 0; j < 7; j += 1) {
            if ((diff >> j) & 1) {
              values[i + j] = (values[i + j] & maskClr) | ((((values[i + j] >> plane) & 1) ^ 1) << plane);
              break;
            }
          }
        }
      }
    } else {
      for (let i = 0; i < values.length && bitCursor < bits.length; i += 1) {
        values[i] = (values[i] & maskClr) | (bits[bitCursor] << plane);
        bitCursor += 1;
      }
    }
    if (bitCursor >= bits.length) break;
  }
  for (let i = 0; i < coords.length; i += 1) {
    const [x, y, ch] = coords[i];
    data[(y * W * 4) + (x * 4) + ch] = values[i];
  }
  return bitCursor;
}
function extractPlanesFromImageData(imageData, nBits, k, matrixPlane) {
  const data = imageData.data;
  const coords = enumerateCarriers();
  const values = new Uint8Array(coords.length);
  for (let i = 0; i < coords.length; i += 1) {
    const [x, y, ch] = coords[i];
    values[i] = data[(y * W * 4) + (x * 4) + ch];
  }
  const bits = [];
  for (let plane = 0; plane < k && bits.length < nBits; plane += 1) {
    if (plane === matrixPlane) {
      for (let i = 0; i + 7 <= values.length && bits.length < nBits; i += 7) {
        let g = 0;
        for (let j = 0; j < 7; j += 1) g |= (((values[i + j] >> plane) & 1) << j);
        const m = extractHammingGroup(g);
        for (let j = 0; j < 3 && bits.length < nBits; j += 1) bits.push((m >> j) & 1);
      }
    } else {
      for (let i = 0; i < values.length && bits.length < nBits; i += 1) bits.push((values[i] >> plane) & 1);
    }
  }
  return bitsToBytes(bits);
}
async function encodeSteg({ coverCanvas, mp3Bytes, mp3Name }) {
  const ctx = coverCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, W, H);
  const payloadInfo = await buildPayload(mp3Bytes, mp3Name, LSB_CAPACITY_BYTES);
  const writtenBits = embedPlanesIntoImageData(imageData, payloadInfo.payload, MATRIX_K, MATRIX_PLANE);
  if (writtenBits < payloadInfo.payload.length * 8) throw new Error('Matrix-5 capacity was insufficient for payload.');
  ctx.putImageData(imageData, 0, 0);
  const pngBlob = await new Promise((resolve, reject) => coverCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Failed to encode PNG.')), 'image/png'));
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
  return {
    stegBytes: payloadInfo.trailing.length ? concatBytes(pngBytes, payloadInfo.trailing) : pngBytes,
    shaHex: hex(payloadInfo.mp3Hash),
    mp3Len: mp3Bytes.length,
    lsbMp3Len: payloadInfo.lsbMp3Len,
    trailLen: payloadInfo.trailLen,
  };
}
async function decodeStegFromBytes(allBytes, canvas) {
  const endOff = findPngEndOffset(allBytes);
  const pngOnly = allBytes.slice(0, endOff);
  const trailing = allBytes.slice(endOff);
  const bitmap = await createImageBitmap(new Blob([pngOnly], { type: 'image/png' }));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try {
    if (bitmap.width !== W || bitmap.height !== H) throw new Error(`Encoded PNG must be ${W}x${H}.`);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close?.();
  }
  const imageData = ctx.getImageData(0, 0, W, H);
  const minHdr = extractPlanesFromImageData(imageData, FIXED_HEADER_LEN * 8, MATRIX_K, MATRIX_PLANE).slice(0, FIXED_HEADER_LEN);
  for (let i = 0; i < 8; i += 1) if (minHdr[i] !== MAGIC[i]) throw new Error('Magic mismatch. Not a StegMP3 image.');
  const headerLen = readU16be(minHdr, 10);
  const header = extractPlanesFromImageData(imageData, headerLen * 8, MATRIX_K, MATRIX_PLANE).slice(0, headerLen);
  const mp3Len = readU32be(header, 12);
  const lsbMp3Len = readU32be(header, 16);
  const trailLen = readU32be(header, 20);
  const storedSha = header.slice(24, 56);
  const nameLen = readU16be(header, 56);
  const name = td.decode(header.slice(FIXED_HEADER_LEN, FIXED_HEADER_LEN + nameLen)) || 'recovered.mp3';
  const segmentLen = headerLen + lsbMp3Len;
  const segment = extractPlanesFromImageData(imageData, segmentLen * 8, MATRIX_K, MATRIX_PLANE).slice(0, segmentLen);
  const audioBytes = concatBytes(segment.slice(headerLen), trailing.slice(0, trailLen));
  const gotSha = await sha256(audioBytes);
  if (hex(gotSha) !== hex(storedSha)) throw new Error('SHA-256 verification failed. The PNG was modified or corrupted.');
  return { pngBytes: pngOnly, audioBytes, mp3Len, lsbMp3Len, trailLen, shaHex: hex(storedSha), name };
}
function parseSynchsafe(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
}
function decodeTextFrame(frame) {
  const encoding = frame[0];
  const body = frame.slice(1);
  if (encoding === 1 || encoding === 2) {
    return new TextDecoder('utf-16').decode(body).replace(/\0/g, '').trim();
  }
  return new TextDecoder('iso-8859-1').decode(body).replace(/\0/g, '').trim();
}
function parseId3Tags(bytes) {
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return {};
  const major = bytes[3];
  const size = parseSynchsafe(bytes, 6);
  const tags = {};
  let offset = 10;
  const end = Math.min(bytes.length, 10 + size);
  while (offset + 10 <= end) {
    const id = new TextDecoder().decode(bytes.slice(offset, offset + 4));
    if (!id.trim()) break;
    const frameSize = major === 4 ? parseSynchsafe(bytes, offset + 4) : readU32be(bytes, offset + 4);
    const frameData = bytes.slice(offset + 10, offset + 10 + frameSize);
    if (id[0] === 'T' && frameData.length) tags[id] = decodeTextFrame(frameData);
    offset += 10 + frameSize;
  }
  return {
    title: tags.TIT2 || '',
    artist: tags.TPE1 || '',
    album: tags.TALB || '',
    albumArtist: tags.TPE2 || '',
    genre: tags.TCON || '',
    year: tags.TDRC || tags.TYER || '',
    trackNumber: tags.TRCK || '',
  };
}

export {
  W,
  H,
  LSB_CAPACITY_BYTES,
  drawCoverToCanvas,
  encodeSteg,
  decodeStegFromBytes,
  parseId3Tags,
  parseCsvList,
  slugify,
  formatTime,
  humanBytes,
  toDataUrl,
  sha256,
  hex,
};
