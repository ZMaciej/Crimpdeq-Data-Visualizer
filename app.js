import { decodeMeasurements, Session } from './session.js';

const SERVICE = '7e4e1701-1ea6-40c9-9dcc-13d34ffead57';
const DATA = '7e4e1702-1ea6-40c9-9dcc-13d34ffead57';
const CONTROL = '7e4e1703-1ea6-40c9-9dcc-13d34ffead57';
const $ = id => document.getElementById(id);
const connectButton = $('connect');
const startButton = $('start');
const canvas = $('chart');
let device = null;
let control = null;
let data = null;
let running = false;
let busy = false;
let session = new Session();
let frame = null;

function setNotice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('notice-error', error);
}

function updateControls() {
  const connected = Boolean(device?.gatt.connected && control);
  connectButton.disabled = busy || !navigator.bluetooth;
  connectButton.textContent = connected ? 'Disconnect' : 'Connect device';
  startButton.disabled = busy || !connected;
  startButton.innerHTML = running ? '<span aria-hidden="true">↻</span> Tare &amp; restart' : '<span aria-hidden="true">▶</span> Tare &amp; start';
  $('connection-status').classList.toggle('connected', connected);
  $('status-text').textContent = connected ? (device.name || 'Connected') : 'Not connected';
}

function formatTime(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function updateDisplay() {
  const format = value => value === null ? '—' : value.toFixed(1);
  $('current').textContent = format(session.current);
  $('maximum').textContent = format(session.maximum);
  $('mean').textContent = format(session.mean);
  $('max-mean').textContent = format(session.maxMean);
  $('elapsed').textContent = formatTime(session.elapsed);
  $('chart-empty').hidden = session.samples.length > 0;
  drawChart();
  frame = null;
}

function scheduleDisplay() {
  if (frame === null) frame = requestAnimationFrame(updateDisplay);
}

function drawChart() {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const width = bounds.width;
  const height = bounds.height;
  const left = 44;
  const right = 12;
  const top = 14;
  const bottom = 16;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const samples = session.samples;
  let low = 0;
  let high = 0;
  for (const point of samples) {
    low = Math.min(low, point.weight);
    high = Math.max(high, point.weight);
  }
  high = Math.max(5, Math.ceil(high / 5) * 5);
  low = Math.floor(low / 5) * 5;
  ctx.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  ctx.fillStyle = '#8c959f';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = top + plotHeight * i / 4;
    ctx.strokeStyle = '#eaeef2';
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.fillText(((high - (high - low) * i / 4)).toFixed(1), left - 8, y);
  }
  if (!samples.length) return;
  const duration = Math.max(session.elapsed, 1);
  const x = time => left + time / duration * plotWidth;
  const y = weight => top + (high - weight) / (high - low) * plotHeight;
  ctx.strokeStyle = '#0969da';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  samples.forEach((point, index) => {
    if (index === 0) ctx.moveTo(x(point.time), y(point.weight));
    else ctx.lineTo(x(point.time), y(point.weight));
  });
  ctx.stroke();
}

function onData(event) {
  if (!running) return;
  const view = event.target.value;
  if (view.byteLength && view.getUint8(0) === 4) {
    setNotice('Your device reports a low battery.', true);
    return;
  }
  for (const sample of decodeMeasurements(view)) session.add(sample.weight, sample.timestamp);
  scheduleDisplay();
}

function onDisconnected() {
  if (data) data.removeEventListener('characteristicvaluechanged', onData);
  if (device) device.removeEventListener('gattserverdisconnected', onDisconnected);
  device = null;
  data = null;
  control = null;
  running = false;
  updateControls();
  setNotice('Device disconnected. Connect again to start a new session.');
}

connectButton.addEventListener('click', async () => {
  if (device?.gatt.connected) {
    busy = true;
    updateControls();
    try {
      if (running) await control.writeValue(new Uint8Array([102]));
    } catch {
      // Disconnect even if the device no longer accepts commands.
    } finally {
      device?.gatt.disconnect();
      busy = false;
      updateControls();
    }
    return;
  }
  busy = true;
  updateControls();
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }, { namePrefix: 'Progressor' }, { namePrefix: 'Crimpdeq' }],
      optionalServices: [SERVICE]
    });
    device.addEventListener('gattserverdisconnected', onDisconnected);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    data = await service.getCharacteristic(DATA);
    control = await service.getCharacteristic(CONTROL);
    data.addEventListener('characteristicvaluechanged', onData);
    await data.startNotifications();
    setNotice('Device connected. Unload the sensor, then select Tare & start.');
  } catch (error) {
    if (device?.gatt.connected) device.gatt.disconnect();
    onDisconnected();
    setNotice(error.name === 'NotFoundError' ? 'No device selected. Try connecting again.' : `Could not connect: ${error.message}`, error.name !== 'NotFoundError');
  } finally {
    busy = false;
    updateControls();
  }
});

startButton.addEventListener('click', async () => {
  busy = true;
  updateControls();
  const activeControl = control;
  let streaming = false;
  try {
    if (running) await activeControl.writeValue(new Uint8Array([102]));
    running = false;
    await activeControl.writeValue(new Uint8Array([101]));
    streaming = true;
    await activeControl.writeValue(new Uint8Array([100]));
    setNotice('Taring the sensor. Keep it unloaded…');
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (control !== activeControl || !device?.gatt.connected) throw new Error('Device disconnected.');
    session = new Session();
    scheduleDisplay();
    running = true;
    setNotice('Session running. Pull when you are ready.');
  } catch (error) {
    running = false;
    if (streaming && control === activeControl) {
      try { await activeControl.writeValue(new Uint8Array([102])); } catch {}
    }
    setNotice(`Could not start the session: ${error.message}`, true);
  } finally {
    busy = false;
    updateControls();
  }
});

window.addEventListener('resize', scheduleDisplay);
if (!navigator.bluetooth) {
  setNotice('Web Bluetooth is unavailable. Use Chrome or Edge on a supported device over HTTPS or localhost.', true);
}
updateControls();
scheduleDisplay();
