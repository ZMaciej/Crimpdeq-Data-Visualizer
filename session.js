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
    this.windowSum = 0;
    this.sampleIntervals = [];
    this.sampleInterval = null;
    this.elapsed = 0;
    this.lastTimestamp = null;
    this.current = null;
    this.maximum = null;
    this.maximumTime = null;
    this.mean = null;
    this.maxMean = null;
    this.maxMeanStart = null;
    this.maxMeanEnd = null;
  }

  add(weight, timestamp) {
    if (!Number.isFinite(weight)) return;
    if (this.lastTimestamp !== null) {
      const delta = (timestamp - this.lastTimestamp) >>> 0;
      if (delta > 0x7fffffff) return;
      this.elapsed += delta / 1000000;
      if (delta > 0) this.updateSampleInterval(delta);
    }
    this.lastTimestamp = timestamp;
    this.current = weight;
    if (this.maximum === null || weight > this.maximum) {
      this.maximum = weight;
      this.maximumTime = this.elapsed;
    }
    const point = { time: this.elapsed, weight };
    this.samples.push(point);
    const lastWindowPoint = this.window[this.window.length - 1];
    if (lastWindowPoint && lastWindowPoint.time === point.time) {
      this.windowSum += weight - lastWindowPoint.weight;
      lastWindowPoint.weight = weight;
    } else {
      this.window.push({ ...point });
      this.windowSum += weight;
    }

    const cutoff = this.elapsed - 5;
    while (this.head < this.window.length && this.window[this.head].time <= cutoff) {
      this.windowSum -= this.window[this.head].weight;
      this.head++;
    }
    const vectorLength = this.sampleInterval === null
      ? null
      : Math.max(1, Math.round(5000000 / this.sampleInterval));
    this.mean = vectorLength === null ? 0 : this.windowSum / vectorLength;
    if (this.maxMean === null || this.mean >= this.maxMean) {
      this.maxMean = this.mean;
      this.maxMeanStart = this.elapsed - 5;
      this.maxMeanEnd = this.elapsed;
    }
    if (this.head > 1000) {
      this.window = this.window.slice(this.head);
      this.head = 0;
    }
  }

  updateSampleInterval(delta) {
    this.sampleIntervals.push(delta);
    if (this.sampleIntervals.length > 31) this.sampleIntervals.shift();
    const sorted = [...this.sampleIntervals].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    this.sampleInterval = sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }
}
