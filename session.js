export function decodeMeasurements(view) {
  if (view.byteLength < 2 || view.getUint8(0) !== 1) return [];
  const end = Math.min(view.byteLength, 2 + view.getUint8(1));
  const samples = [];
  for (let offset = 2; offset + 8 <= end; offset += 8) {
    const weight = view.getFloat32(offset, true);
    if (Number.isFinite(weight)) {
      samples.push({ weight, timestamp: view.getUint32(offset + 4, true) });
    }
  }
  return samples;
}

export class Session {
  constructor() {
    this.samples = [];
    this.window = [];
    this.head = 0;
    this.area = 0;
    this.elapsed = 0;
    this.lastTimestamp = null;
    this.current = null;
    this.maximum = null;
    this.mean = null;
    this.maxMean = null;
  }

  add(weight, timestamp) {
    if (!Number.isFinite(weight)) return;
    if (this.lastTimestamp !== null) {
      const delta = (timestamp - this.lastTimestamp) >>> 0;
      if (delta > 0x7fffffff) return;
      this.elapsed += delta / 1000000;
      this.area += this.current * (delta / 1000000);
    }
    this.lastTimestamp = timestamp;
    this.current = weight;
    this.maximum = this.maximum === null ? weight : Math.max(this.maximum, weight);
    const point = { time: this.elapsed, weight };
    this.samples.push(point);
    this.window.push({ ...point });

    const cutoff = this.elapsed - 5;
    while (this.head + 1 < this.window.length && this.window[this.head + 1].time <= cutoff) {
      const first = this.window[this.head];
      this.area -= first.weight * (this.window[this.head + 1].time - first.time);
      this.head++;
    }
    if (cutoff >= 0) {
      const first = this.window[this.head];
      this.area -= first.weight * (cutoff - first.time);
      first.time = cutoff;
      this.mean = this.area / 5;
      this.maxMean = this.maxMean === null ? this.mean : Math.max(this.maxMean, this.mean);
    }
    if (this.head > 1000) {
      this.window = this.window.slice(this.head);
      this.head = 0;
    }
  }
}
