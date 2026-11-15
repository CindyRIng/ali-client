/**
 * owner 单实例锁：防止 CLI --local / 第二个 serve 抢 profile
 */
import fs from 'node:fs';
import path from 'node:path';
import { AliError } from '../errors/catalog.js';

export interface OwnerLockInfo {
  pid: number;
  startedAt: string;
  cwd?: string;
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readOwnerLock(lockFile: string): OwnerLockInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as OwnerLockInfo;
    if (!alive(info.pid)) return null;
    return info;
  } catch {
    return null;
  }
}

export function acquireOwnerLock(lockFile: string): void {
  const existing = readOwnerLock(lockFile);
  if (existing) {
    throw new AliError(
      'BAD_STATE',
      `另一个 ali-client owner 正在运行（pid=${existing.pid}，since ${existing.startedAt}）。` +
        '请直接使用 `ali ...`（自动代理 REST），或先 systemctl --user stop ali-client。',
      { details: { pid: existing.pid, startedAt: existing.startedAt } },
    );
  }
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), cwd: process.cwd() } satisfies OwnerLockInfo),
      { mode: 0o600 },
    );
  } catch (err) {
    throw new AliError('BAD_STATE', `无法写入 owner 锁文件：${lockFile}`, { cause: err });
  }
}

export function releaseOwnerLock(lockFile: string): void {
  try {
    const info = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as OwnerLockInfo;
    if (info.pid === process.pid) fs.rmSync(lockFile, { force: true });
  } catch {
    /* ignore */
  }
}
