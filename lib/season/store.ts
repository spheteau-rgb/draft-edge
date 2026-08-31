/**
 * Where week snapshots live.
 *
 * Vercel's filesystem is read-only, so anything transcribed at runtime has to
 * go to Redis. The repo's committed `data/season/*.json` stays readable as a
 * fallback: weeks captured before this existed keep working, and local runs
 * without REDIS_URL still have somewhere to write.
 *
 * Snapshot-replace semantics are unchanged — writing week N discards week N.
 */

import { getRedis } from "@/lib/store";
import {
  loadWeekSnapshotFromDisk,
  writeWeekSnapshotToDisk,
  type WeekSnapshot,
} from "@/lib/season/snapshot";

function key(season: number, week: number): string {
  return `season:${season}:week:${String(week).padStart(2, "0")}`;
}

function hasRedis(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export async function loadWeekSnapshot(season: number, week: number): Promise<WeekSnapshot | null> {
  if (hasRedis()) {
    const raw = await getRedis().get(key(season, week));
    if (raw) {
      try {
        return JSON.parse(raw) as WeekSnapshot;
      } catch {
        console.error(`Corrupt snapshot JSON at ${key(season, week)}, falling back to disk`);
      }
    }
  }
  return loadWeekSnapshotFromDisk(season, week);
}

export async function saveWeekSnapshot(snapshot: WeekSnapshot): Promise<void> {
  if (hasRedis()) {
    await getRedis().set(key(snapshot.season, snapshot.week), JSON.stringify(snapshot));
    return;
  }
  writeWeekSnapshotToDisk(snapshot);
}
