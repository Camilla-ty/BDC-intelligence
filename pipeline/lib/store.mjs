// Content-addressed store for raw SEC bytes: <dataDir>/raw/sha256/<aa>/<sha256>.
// Files are written once (temporary file, then rename) and verified on every read.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const sha256Hex = (buffer) => createHash("sha256").update(buffer).digest("hex");

export function createStore(dataDir) {
  const keyFor = (sha) => `raw/sha256/${sha.slice(0, 2)}/${sha}`;
  const pathFor = (key) => {
    if (!/^raw\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(key)) throw new Error(`invalid storage key: ${key}`);
    return path.join(dataDir, key);
  };

  function put(buffer) {
    const sha = sha256Hex(buffer);
    const key = keyFor(sha);
    const file = pathFor(key);
    if (existsSync(file)) {
      if (sha256Hex(readFileSync(file)) !== sha) throw new Error(`stored file ${key} is corrupt`);
      return { sha256: sha, storageKey: key, byteSize: buffer.length, existed: true };
    }
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, buffer);
    renameSync(tmp, file);
    return { sha256: sha, storageKey: key, byteSize: buffer.length, existed: false };
  }

  function read(key, expectedSha) {
    const buffer = readFileSync(pathFor(key));
    const sha = sha256Hex(buffer);
    if (expectedSha && sha !== expectedSha) throw new Error(`stored file ${key} does not match its recorded sha256`);
    return buffer;
  }

  return { put, read, pathFor };
}
