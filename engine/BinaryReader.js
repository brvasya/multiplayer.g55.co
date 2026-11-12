// Little-endian, bounds-checked reader for PC Source model/texture files.
export class BinaryReader {
  constructor(buffer, label = "Source file") {
    this.view = ArrayBuffer.isView(buffer)
      ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new DataView(buffer);
    this.length = this.view.byteLength;
    this.label = label;
  }
  check(offset, length = 1) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.length) {
      throw new Error(`${this.label}: invalid/truncated data at ${offset} (${length} bytes).`);
    }
    return offset;
  }
  table(offset, count, stride) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${this.label}: invalid record count.`);
    this.check(offset, count * stride);
    return count;
  }
  u8(o) { return this.view.getUint8(this.check(o)); }
  u16(o) { return this.view.getUint16(this.check(o, 2), true); }
  i16(o) { return this.view.getInt16(this.check(o, 2), true); }
  i32(o) { return this.view.getInt32(this.check(o, 4), true); }
  u32(o) { return this.view.getUint32(this.check(o, 4), true); }
  f32(o) {
    const value = this.view.getFloat32(this.check(o, 4), true);
    if (!Number.isFinite(value)) throw new Error(`${this.label}: non-finite value at ${o}.`);
    return value;
  }
  floats(o, count) { return Array.from({ length: count }, (_, i) => this.f32(o + i * 4)); }
  string(o, maxLength = 4096) {
    this.check(o);
    const bytes = [];
    for (let i = 0; i < maxLength && o + i < this.length; i++) {
      const byte = this.u8(o + i);
      if (!byte) break;
      bytes.push(byte);
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
  relativeString(o, field = 0) {
    const offset = this.i32(o + field);
    return offset ? this.string(o + offset) : "";
  }
}
