import { decodeBatteryResponse } from './battery.js';
import { decodeMeasurements, Session } from './session.js';

const SERVICE = '7e4e1701-1ea6-40c9-9dcc-13d34ffead57';
const DATA = '7e4e1702-1ea6-40c9-9dcc-13d34ffead57';
const CONTROL = '7e4e1703-1ea6-40c9-9dcc-13d34ffead57';
const COMMAND = { tare: 100, start: 101, stop: 102, batteryVoltage: 111, batteryStatus: 0x77 };
const $ = id => document.getElementById(id);
const connectButton = $('connect');
const tareButton = $('tare');
const startButton = $('start');
const stopButton = $('stop');
const batteryStatus = $('battery-status');
const canvas = $('chart');
let device = null;
let control = null;
let data = null;
let disconnectHandler = null;
let connectionGeneration = 0;
let running = false;
let busy = false;
let batteryTimer = null;
let batteryTimeout = null;
let batteryRequest = null;
let tareReadings = null;
let tareOffset = 0;
let tareDeviceId = null;
let session = new Session();
let frame = null;

function setNotice(message, error = false) {
  const notice = $('notice');
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle('notice-error', error);
}

function createWakeLockManager() {
  const isSupported = 'wakeLock' in navigator;
  const noSleep = window.NoSleep ? new window.NoSleep() : null;
  let active = false;
  let userActivated = false;
  let lock = null;
  let requesting = false;
  let fallbackEnabled = false;
  let fallbackRequest = null;
  let fallbackGeneration = 0;

  function enableFallback() {
    if (!noSleep || fallbackEnabled || fallbackRequest) return;
    const generation = ++fallbackGeneration;
    try {
      fallbackRequest = Promise.resolve(noSleep.enable())
        .then(() => {
          if (generation === fallbackGeneration) fallbackEnabled = true;
        })
        .catch(error => {
          if (generation === fallbackGeneration &&
            (userActivated || (error.name !== 'NotAllowedError' && error.name !== 'AbortError'))) {
            setNotice(`Could not enable background media: ${error.message}`, true);
          }
        })
        .finally(() => {
          if (generation === fallbackGeneration) fallbackRequest = null;
        });
    } catch (error) {
      if (userActivated || (error.name !== 'NotAllowedError' && error.name !== 'AbortError')) {
        setNotice(`Could not enable background media: ${error.message}`, true);
      }
    }
  }

  function disableFallback() {
    if (!noSleep || (!fallbackEnabled && !fallbackRequest)) return;
    fallbackGeneration++;
    fallbackEnabled = false;
    fallbackRequest = null;
    try {
      noSleep.disable();
    } catch (error) {
      setNotice(`Could not stop background media: ${error.message}`, true);
    }
  }

  async function releaseLock() {
    if (!lock) return;
    const activeLock = lock;
    lock = null;
    try {
      await activeLock.release();
    } catch (error) {
      if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') {
        setNotice(`Could not release screen wake lock: ${error.message}`, true);
      }
    }
  }

  async function requestLock() {
    if (!isSupported || !active || document.visibilityState !== 'visible' || lock || requesting) return;
    requesting = true;
    try {
      const requestedLock = await navigator.wakeLock.request('screen');
      if (!active || document.visibilityState !== 'visible') {
        await requestedLock.release();
        return;
      }
      lock = requestedLock;
      requestedLock.addEventListener('release', () => {
        if (lock !== requestedLock) return;
        lock = null;
        if (active && document.visibilityState === 'visible') {
          enableFallback();
          void requestLock();
        }
      });
    } catch (error) {
      if (userActivated) enableFallback();
      if (!noSleep && active) {
        setNotice(`Could not keep the screen awake: ${error.message}`, true);
      }
    } finally {
      requesting = false;
    }
  }

  function setActive(nextActive, fromUserGesture = false) {
    active = nextActive;
    if (fromUserGesture) userActivated = true;
    if (active && document.visibilityState === 'visible') {
      enableFallback();
      if (!isSupported && !noSleep) {
        setNotice('Screen wake prevention is not supported in this browser.', true);
      }
      void requestLock();
    } else {
      void releaseLock();
      disableFallback();
    }
  }

  return { setActive };
}

const wakeLockManager = createWakeLockManager();
if (document.visibilityState === 'visible') wakeLockManager.setActive(true);
document.addEventListener('touchstart', () => wakeLockManager.setActive(document.visibilityState === 'visible', true), { passive: true });
document.addEventListener('pointerdown', () => wakeLockManager.setActive(document.visibilityState === 'visible', true), { passive: true });
document.addEventListener('keydown', () => wakeLockManager.setActive(document.visibilityState === 'visible', true));
document.addEventListener('visibilitychange', () => wakeLockManager.setActive(document.visibilityState === 'visible'));

function updateControls() {
  const connected = Boolean(device?.gatt.connected && control);
  connectButton.disabled = busy || !navigator.bluetooth;
  connectButton.textContent = connected ? 'Disconnect' : 'Connect device';
  tareButton.disabled = busy || !connected || running;
  startButton.disabled = busy || !connected;
  startButton.textContent = running ? 'Restart' : 'Start';
  stopButton.disabled = busy || !connected || !running;
  $('connection-status').classList.toggle('connected', connected);
  $('status-text').textContent = connected ? (device.name || 'Connected') : 'Not connected';
  batteryStatus.hidden = !connected;
}

function formatTime(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function updateDisplay() {
  const format = value => value === null ? '—' : value.toFixed(2);
  $('current').textContent = format(session.current);
  $('maximum').textContent = format(session.maximum);
  $('mean').textContent = format(session.mean);
  $('max-mean').textContent = format(session.maxMean);
  $('elapsed').textContent = formatTime(session.elapsed);
  drawChart();
  frame = null;
}

function scheduleDisplay() {
  if (frame === null) frame = requestAnimationFrame(updateDisplay);
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
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
  const duration = Math.max(session.elapsed, 1);
  const x = time => left + Math.max(0, Math.min(1, time / duration)) * plotWidth;
  const samples = session.samples;
  const low = 0;
  let high = 0;
  for (const point of samples) {
    high = Math.max(high, point.weight);
  }
  high = Math.max(5, Math.ceil(high / 5) * 5);
  if (session.maxMeanStart !== null && session.maxMeanEnd !== null) {
    const rangeStart = x(session.maxMeanStart);
    const rangeEnd = x(session.maxMeanEnd);
    if (rangeEnd > rangeStart) {
      ctx.fillStyle = 'rgba(191, 135, 0, .16)';
      ctx.fillRect(rangeStart, top, rangeEnd - rangeStart, plotHeight);
      ctx.strokeStyle = '#bf8700';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(rangeStart, top);
      ctx.lineTo(rangeStart, top + plotHeight);
      ctx.moveTo(rangeEnd, top);
      ctx.lineTo(rangeEnd, top + plotHeight);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
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
    ctx.fillText(((high - (high - low) * i / 4)).toFixed(2), left - 8, y);
  }
  if (!samples.length) return;
  const y = weight => top + (high - Math.max(0, weight)) / (high - low) * plotHeight;
  ctx.strokeStyle = '#0969da';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  samples.forEach((point, index) => {
    if (index === 0) ctx.moveTo(x(point.time), y(point.weight));
    else ctx.lineTo(x(point.time), y(point.weight));
  });
  ctx.stroke();
  if (session.maximumTime !== null) {
    const peakX = x(session.maximumTime);
    const peakY = y(session.maximum);
    ctx.strokeStyle = '#cf222e';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(peakX, top);
    ctx.lineTo(peakX, top + plotHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#cf222e';
    ctx.beginPath();
    ctx.arc(peakX, peakY, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function clearBatteryRequest() {
  if (batteryTimeout !== null) clearTimeout(batteryTimeout);
  batteryTimeout = null;
  batteryRequest = null;
}

function stopBatteryRefresh() {
  if (batteryTimer !== null) clearInterval(batteryTimer);
  batteryTimer = null;
  clearBatteryRequest();
  batteryStatus.textContent = '';
  batteryStatus.hidden = true;
}

async function requestBattery(kindOverride = null) {
  if (!device?.gatt.connected || !control || busy || batteryRequest) return;
  const requestedDevice = device;
  const kind = kindOverride || (requestedDevice.name?.toLowerCase().startsWith('crimpdeq') ? 'status' : 'voltage');
  const request = { device: requestedDevice, kind };
  batteryRequest = request;
  try {
    const command = kind === 'status' ? COMMAND.batteryStatus : COMMAND.batteryVoltage;
    await control.writeValue(new Uint8Array([command]));
  } catch (error) {
    if (batteryRequest === request) {
      clearBatteryRequest();
      batteryStatus.textContent = 'Battery unavailable';
      setNotice(`Could not read battery: ${error.message}`, true);
    }
    return;
  }
  if (batteryRequest === request) {
    batteryTimeout = setTimeout(() => {
      if (batteryRequest === request) {
        clearBatteryRequest();
        batteryStatus.textContent = 'Battery unavailable';
        if (kind === 'status') requestBattery('voltage');
      }
    }, 3000);
  }
}

function startBatteryRefresh() {
  stopBatteryRefresh();
  if (!device?.gatt.connected) return;
  batteryStatus.hidden = false;
  batteryStatus.textContent = 'Battery --%';
  requestBattery();
  batteryTimer = setInterval(requestBattery, 10000);
}

function onData(event) {
  const view = event.target.value;
  if (!view.byteLength) return;
  if (view.byteLength && view.getUint8(0) === 4) {
    setNotice('Your device reports a low battery.', true);
    return;
  }
  if (batteryRequest) {
    const result = decodeBatteryResponse(view, batteryRequest.kind);
    if (result) {
      const estimate = result.estimated ? '~' : '';
      batteryStatus.textContent = `Battery ${estimate}${result.percent}%`;
      clearBatteryRequest();
    }
  }
  const measurements = decodeMeasurements(view);
  if (tareReadings) {
    for (const sample of measurements) tareReadings.push(sample.weight);
    return;
  }
  if (!running) return;
  for (const sample of measurements) session.add(sample.weight - tareOffset, sample.timestamp);
  scheduleDisplay();
}

function resetConnection(disconnectedDevice, handler) {
  if (handler) disconnectedDevice.removeEventListener('gattserverdisconnected', handler);
  if (disconnectedDevice !== device || handler !== disconnectHandler) return false;
  stopBatteryRefresh();
  if (data) data.removeEventListener('characteristicvaluechanged', onData);
  tareReadings = null;
  device = null;
  data = null;
  control = null;
  disconnectHandler = null;
  running = false;
  updateControls();
  return true;
}

function onDisconnected(disconnectedDevice, handler, generation) {
  if (!resetConnection(disconnectedDevice, handler)) return;
  if (generation === connectionGeneration) setNotice('Device disconnected. Connect again to start a new session.');
}

connectButton.addEventListener('click', async () => {
  if (device?.gatt.connected) {
    busy = true;
    updateControls();
    try {
      if (running) await control.writeValue(new Uint8Array([COMMAND.stop]));
    } catch {
      // Disconnect even if the device no longer accepts commands.
    } finally {
      device?.gatt.disconnect();
      busy = false;
      updateControls();
    }
    return;
  }
  if (device && !device.gatt.connected) resetConnection(device, disconnectHandler);
  const generation = ++connectionGeneration;
  let connectingDevice = null;
  let handler = null;
  busy = true;
  updateControls();
  try {
    connectingDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }, { namePrefix: 'Progressor' }, { namePrefix: 'Crimpdeq' }],
      optionalServices: [SERVICE]
    });
    if (tareDeviceId !== connectingDevice.id) {
      tareDeviceId = connectingDevice.id;
      tareOffset = 0;
    }
    device = connectingDevice;
    handler = () => onDisconnected(connectingDevice, handler, generation);
    disconnectHandler = handler;
    connectingDevice.addEventListener('gattserverdisconnected', handler);
    const server = await connectingDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    data = await service.getCharacteristic(DATA);
    control = await service.getCharacteristic(CONTROL);
    data.addEventListener('characteristicvaluechanged', onData);
    await data.startNotifications();
    setNotice('');
  } catch (error) {
    if (connectingDevice?.gatt.connected) connectingDevice.gatt.disconnect();
    if (connectingDevice) resetConnection(connectingDevice, handler);
    setNotice(error.name === 'NotFoundError' ? 'No device selected. Try connecting again.' : `Could not connect: ${error.message}`, error.name !== 'NotFoundError');
  } finally {
    busy = false;
    updateControls();
    if (device?.gatt.connected && control) startBatteryRefresh();
  }
});

tareButton.addEventListener('click', async () => {
  const activeControl = control;
  if (!activeControl || busy || running) return;
  busy = true;
  updateControls();
  const readings = [];
  tareReadings = readings;
  let startedForTare = false;
  try {
    setNotice('');
    tareButton.classList.add('tare-progress');
    tareButton.setAttribute('aria-busy', 'true');
    startedForTare = true;
    await activeControl.writeValue(new Uint8Array([COMMAND.start]));
    await delay(500);
    if (control !== activeControl || !device?.gatt.connected) throw new Error('Device disconnected.');
    await activeControl.writeValue(new Uint8Array([COMMAND.stop]));
    startedForTare = false;
    if (!readings.length) throw new Error('No measurements received during tare.');
    const average = readings.reduce((sum, weight) => sum + weight, 0) / readings.length;
    const latest = readings[readings.length - 1];
    await activeControl.writeValue(new Uint8Array([COMMAND.tare]));
    // Shift the hardware zero from the final reading to the half-second average.
    tareOffset = average - latest;
    tareDeviceId = device.id;
    if (control !== activeControl || !device?.gatt.connected) throw new Error('Device disconnected.');
    setNotice('');
  } catch (error) {
    if (startedForTare && control === activeControl) {
      try { await activeControl.writeValue(new Uint8Array([COMMAND.stop])); } catch {}
    }
    setNotice(`Could not tare the sensor: ${error.message}`, true);
  } finally {
    tareReadings = null;
    tareButton.classList.remove('tare-progress');
    tareButton.removeAttribute('aria-busy');
    busy = false;
    updateControls();
  }
});

startButton.addEventListener('click', async () => {
  const activeControl = control;
  if (!activeControl) return;
  busy = true;
  updateControls();
  let streaming = false;
  try {
    if (running) await activeControl.writeValue(new Uint8Array([COMMAND.stop]));
    running = false;
    if (control !== activeControl || !device?.gatt.connected) throw new Error('Device disconnected.');
    session = new Session();
    scheduleDisplay();
    running = true;
    streaming = true;
    await activeControl.writeValue(new Uint8Array([COMMAND.start]));
    setNotice('');
  } catch (error) {
    running = false;
    if (streaming && control === activeControl) {
      try { await activeControl.writeValue(new Uint8Array([COMMAND.stop])); } catch {}
    }
    setNotice(`Could not start the session: ${error.message}`, true);
  } finally {
    busy = false;
    updateControls();
  }
});

stopButton.addEventListener('click', async () => {
  const activeControl = control;
  if (!activeControl || !running) return;
  busy = true;
  updateControls();
  try {
    await activeControl.writeValue(new Uint8Array([COMMAND.stop]));
    if (control !== activeControl || !device?.gatt.connected) throw new Error('Device disconnected.');
    running = false;
    setNotice('');
  } catch (error) {
    setNotice(`Could not stop the session: ${error.message}`, true);
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
