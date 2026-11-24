export function decodeBatteryResponse(view, kind) {
  if (view.byteLength < 2) return null;
  const response = view.getUint8(0);
  const payloadLength = view.getUint8(1);

  if (kind === 'status' && response === 8 && payloadLength >= 2 && view.byteLength >= 4) {
    const percent = view.getUint8(2);
    if (percent > 100) return null;
    return { percent, estimated: false };
  }

  if (kind === 'voltage' && response === 0 && payloadLength >= 4 && view.byteLength >= 6) {
    const millivolts = view.getUint32(2, true);
    const percent = Math.max(0, Math.min(100, Math.round((millivolts - 3300) / 9)));
    return { percent, estimated: true };
  }

  return null;
}
