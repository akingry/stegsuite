const W = 1920;
const H = 1080;
const LSB_BITS = 4;

function pixelForAudioByteOffset(headerLen, lsbMp3Len, audioByteOffset) {
  const embeddedOffset = Math.min(audioByteOffset, lsbMp3Len);
  const payloadByteOffset = headerLen + embeddedOffset;
  const groupOffset = payloadByteOffset * (8 / LSB_BITS);
  const pixel = Math.min((W * H) - 1, Math.floor(groupOffset / 3));
  return { pixel, x: pixel % W, y: Math.floor(pixel / W) };
}

function directPosition(headerLen, lsbMp3Len, mp3Len, t) {
  const audioByteOffset = Math.min(mp3Len, Math.round(Math.max(0, Math.min(1, t)) * Math.max(1, mp3Len)));
  return pixelForAudioByteOffset(headerLen, lsbMp3Len, audioByteOffset);
}

const cases = [
  { name: 'fully embedded short', headerLen: 80, lsbMp3Len: 4_000_000, mp3Len: 4_000_000 },
  { name: 'mixed embedded+trailing', headerLen: 80, lsbMp3Len: 1_000_000, mp3Len: 4_000_000 },
  { name: 'small embedded large trailing', headerLen: 120, lsbMp3Len: 250_000, mp3Len: 5_000_000 },
];

for (const test of cases) {
  let monotonic = true;
  let prev = directPosition(test.headerLen, test.lsbMp3Len, test.mp3Len, 0);
  for (let i = 1; i <= 1000; i += 1) {
    const cur = directPosition(test.headerLen, test.lsbMp3Len, test.mp3Len, i / 1000);
    if (cur.pixel < prev.pixel) monotonic = false;
    prev = cur;
  }
  console.log(`CASE: ${test.name} monotonic=${monotonic}`);
  console.table([0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1].map((t) => ({ t, ...directPosition(test.headerLen, test.lsbMp3Len, test.mp3Len, t) })));
}
