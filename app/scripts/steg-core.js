const W = 1920;
const H = 1080;
const LSB_BITS = 4;
const CHANNELS = 3;
const LSB_CAPACITY_BYTES = Math.floor((W * H * CHANNELS * LSB_BITS) / 8);
const te = new TextEncoder();
const td = new TextDecoder();
const MAGIC = te.encode('STEGMP3\0');
const VERSION = 1;
const FIXED_HEADER_LEN = 8 + 1 + 1 + 2 + 4 + 4 + 4 + 32 + 2;
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

function u16be(n) {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
}
function u32be(n) {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
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
function embedLSBIntoImageData(imageData, payloadBytes) {
  const groupsPerByte = 8 / LSB_BITS;
  const neededGroups = payloadBytes.length * groupsPerByte;
  if (neededGroups > W * H * 3) throw new Error('Payload too large for cover image capacity.');
  const data = imageData.data;
  const clearMask = 0xff ^ ((1 << LSB_BITS) - 1);
  let byteIndex = 0;
  let groupIndex = 0;
  let written = 0;
  function nextGroup() {
    const shift = 8 - LSB_BITS - (groupIndex * LSB_BITS);
    const value = (payloadBytes[byteIndex] >>> shift) & ((1 << LSB_BITS) - 1);
    groupIndex += 1;
    if (groupIndex === groupsPerByte) {
      groupIndex = 0;
      byteIndex += 1;
    }
    return value;
  }
  for (let pixel = 0; pixel < W * H && written < neededGroups; pixel += 1) {
    const base = pixel * 4;
    for (let c = 0; c < 3 && written < neededGroups; c += 1) {
      data[base + c] = (data[base + c] & clearMask) | nextGroup();
      written += 1;
    }
  }
  return imageData;
}
function extractLSBFromImageData(imageData, nBytes) {
  const out = new Uint8Array(nBytes);
  const data = imageData.data;
  const groupsPerByte = 8 / LSB_BITS;
  const neededGroups = nBytes * groupsPerByte;
  const mask = (1 << LSB_BITS) - 1;
  let groupCount = 0;
  let currentByte = 0;
  let groupIndex = 0;
  function pushGroup(value) {
    const shift = 8 - LSB_BITS - (groupIndex * LSB_BITS);
    currentByte |= (value & mask) << shift;
    groupIndex += 1;
    if (groupIndex === groupsPerByte) {
      out[(groupCount / groupsPerByte) | 0] = currentByte;
      currentByte = 0;
      groupIndex = 0;
    }
  }
  for (let pixel = 0; pixel < W * H && groupCount < neededGroups; pixel += 1) {
    const base = pixel * 4;
    for (let c = 0; c < 3 && groupCount < neededGroups; c += 1) {
      pushGroup(data[base + c] & mask);
      groupCount += 1;
    }
  }
  return out;
}
async function drawCoverToCanvas(file, canvas, mode = 'contain') {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const bmp = await createImageBitmap(file);
  try {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const scale = mode === 'cover' ? Math.max(W / bmp.width, H / bmp.height) : Math.min(W / bmp.width, H / bmp.height);
    const drawW = Math.round(bmp.width * scale);
    const drawH = Math.round(bmp.height * scale);
    const dx = Math.floor((W - drawW) / 2);
    const dy = Math.floor((H - drawH) / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, dx, dy, drawW, drawH);
  } finally {
    bmp.close?.();
  }
}
async function encodeSteg({ coverCanvas, mp3Bytes, mp3Name }) {
  const ctx = coverCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, W, H);
  const nameBytes = te.encode(mp3Name || 'hidden.mp3');
  const mp3Hash = await sha256(mp3Bytes);
  const headerLen = FIXED_HEADER_LEN + nameBytes.length;
  const lsbMp3Len = Math.min(mp3Bytes.length, LSB_CAPACITY_BYTES - headerLen);
  const trailLen = mp3Bytes.length - lsbMp3Len;
  const header = concatBytes(MAGIC, new Uint8Array([VERSION]), new Uint8Array([0]), u16be(headerLen), u32be(mp3Bytes.length >>> 0), u32be(lsbMp3Len >>> 0), u32be(trailLen >>> 0), mp3Hash, u16be(nameBytes.length), nameBytes);
  const payload = concatBytes(header, mp3Bytes.slice(0, lsbMp3Len));
  embedLSBIntoImageData(imageData, payload);
  ctx.putImageData(imageData, 0, 0);
  const pngBlob = await new Promise((resolve, reject) => coverCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Failed to encode PNG.')), 'image/png'));
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
  const trailing = mp3Bytes.slice(lsbMp3Len);
  return {
    stegBytes: trailing.length ? concatBytes(pngBytes, trailing) : pngBytes,
    shaHex: hex(mp3Hash),
    mp3Len: mp3Bytes.length,
    lsbMp3Len,
    trailLen,
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
  const minHdr = extractLSBFromImageData(imageData, FIXED_HEADER_LEN);
  for (let i = 0; i < 8; i += 1) if (minHdr[i] !== MAGIC[i]) throw new Error('Magic mismatch. Not a StegMP3 image.');
  const headerLen = readU16be(minHdr, 10);
  const header = extractLSBFromImageData(imageData, headerLen);
  const mp3Len = readU32be(header, 12);
  const lsbMp3Len = readU32be(header, 16);
  const trailLen = readU32be(header, 20);
  const storedSha = header.slice(24, 56);
  const nameLen = readU16be(header, 56);
  const name = td.decode(header.slice(FIXED_HEADER_LEN, FIXED_HEADER_LEN + nameLen)) || 'recovered.mp3';
  const lsbAll = extractLSBFromImageData(imageData, headerLen + lsbMp3Len);
  const audioBytes = concatBytes(lsbAll.slice(headerLen), trailing.slice(0, trailLen));
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