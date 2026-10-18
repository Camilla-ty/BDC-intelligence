// ZIP member access through the system unzip tool (as in the Phase 0.2 inspection scripts).
// Every member is streamed once to record its byte size and SHA-256.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

function unzipFailed(member, result) {
  const code = result.error?.code ?? result.status;
  const detail = (result.stderr && String(result.stderr)) || result.error?.message || `exit ${code}`;
  return new Error(`unzip failed for ${member}: ${detail}`);
}

export function listMembers(zipPath) {
  const r = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw unzipFailed(zipPath, r);
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

const READ_MEMBER_MAX_BUFFER = 512 * 1024 * 1024;

export function readMember(zipPath, member, { maxBuffer = READ_MEMBER_MAX_BUFFER } = {}) {
  const r = spawnSync("unzip", ["-p", zipPath, member], { maxBuffer });
  if (r.error || r.status !== 0) throw unzipFailed(member, { ...r, stderr: r.stderr?.toString?.() ?? r.stderr });
  return r.stdout;
}

function childStillRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function waitChildClosed(child) {
  return new Promise((resolve) => {
    if (!childStillRunning(child)) resolve();
    else child.once("close", () => resolve());
  });
}

function stopChild(child) {
  if (childStillRunning(child)) child.kill("SIGTERM");
  child.stdout.destroy();
}

// Yields stdout chunks. A spawn error or a non-zero unzip exit is always a failure;
// callers must not treat a truncated stream as the complete member.
// return() or a throw after a yield kills unzip so the child cannot block on a full pipe.
export async function* streamMemberChunks(zipPath, member, { onSpawn } = {}) {
  const child = spawn("unzip", ["-p", zipPath, member], { stdio: ["ignore", "pipe", "pipe"] });
  onSpawn?.(child);
  let stderr = "";
  let spawnError = null;
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("error", (error) => { spawnError = error; });

  try {
    try {
      for await (const chunk of child.stdout) {
        yield chunk;
      }
    } catch (error) {
      stopChild(child);
      await waitChildClosed(child);
      throw error;
    }

    await waitChildClosed(child);
    const code = child.exitCode;
    if (spawnError) throw unzipFailed(member, { error: spawnError, status: code, stderr });
    if (code !== 0) throw unzipFailed(member, { status: code, stderr });
  } finally {
    stopChild(child);
    await waitChildClosed(child);
  }
}

export async function describeMembers(zipPath) {
  const out = [];
  for (const m of listMembers(zipPath)) out.push(await hashMember(zipPath, m));
  return out;
}
