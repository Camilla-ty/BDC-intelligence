// ZIP member access through the system unzip tool (as in the Phase 0.2 inspection scripts).
// Every member is streamed once to record its byte size and SHA-256.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export function listMembers(zipPath) {
  const r = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`unzip -Z1 failed for ${zipPath}: ${r.stderr}`);
  return r.stdout.split("\n").filter((name) => name !== "" && !name.endsWith("/")).sort();
}

export function hashMember(zipPath, member) {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", zipPath, member]);
    const hash = createHash("sha256");
    let size = 0;
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      hash.update(chunk);
      size += chunk.length;
    });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`unzip -p failed for ${member}: ${stderr}`));
      else resolve({ memberPath: member, byteSize: size, sha256: hash.digest("hex") });
    });
  });
}

export function readMember(zipPath, member) {
  const r = spawnSync("unzip", ["-p", zipPath, member], { maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`unzip -p failed for ${member}: ${r.stderr}`);
  return r.stdout;
}

export async function describeMembers(zipPath) {
  const out = [];
  for (const m of listMembers(zipPath)) out.push(await hashMember(zipPath, m));
  return out;
}
