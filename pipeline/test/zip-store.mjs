// Writes an uncompressed ZIP (STORE method) using Node built-ins only. Used for synthetic
// data-set archives in tests; not an SEC parser.

import { crc32 } from "node:zlib";

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

export function buildStoredZip(members) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, body] of Object.entries(members)) {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.concat([
      Buffer.from("PK\x03\x04"), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0),
      nameBuf, data,
    ]);
    const central = Buffer.concat([
      Buffer.from("PK\x01\x02"), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0),
      u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from("PK\x05\x06"), u16(0), u16(0), u16(centrals.length), u16(centrals.length),
    u32(centralBuf.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, centralBuf, eocd]);
}
