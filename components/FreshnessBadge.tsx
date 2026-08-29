import type { DataFreshness } from "@/types";

const LABEL: Record<DataFreshness, string> = {
  GREEN: "DATA FRESH",
  YELLOW: "DATA STALE",
  RED: "CHECK DATA",
};

export default function FreshnessBadge({ freshness }: { freshness: DataFreshness }) {
  return <span className={`badge badge-${freshness.toLowerCase()}`}>{LABEL[freshness]}</span>;
}
