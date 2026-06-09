import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import styles from "./TraceNode.module.css";

export type TraceNodeState = "active" | "recent" | "normal";

export type TraceNodeData = {
  label: string;
  accent: string;
  state: TraceNodeState;
  /** 0 = most recent. Higher = further in the past → fainter glow. */
  recencyRank: number;
  selected: boolean;
};

// Glow falls off with recency; the most recent node glows most.
function recentGlow(accent: string, rank: number): string {
  const alpha = Math.max(0.06, 0.34 - rank * 0.09);
  return `0 0 14px ${withAlpha(accent, alpha)}`;
}

function withAlpha(hex: string, alpha: number): string {
  // Expects #RRGGBB; falls back to the raw color if it's not that shape.
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function TraceNode({ data }: NodeProps) {
  const { label, accent, state, recencyRank, selected } =
    data as unknown as TraceNodeData;

  const wrapperClass = [styles.wrapper, styles[state]]
    .filter(Boolean)
    .join(" ");

  // The selection ring is independent of the active/recent glow so a node can
  // show both at once (e.g. the active node is also auto-selected). Listing the
  // crisp ring first keeps it on top of any soft glow behind it. The ring color
  // is the theme's primary text color (near-white on dark, near-black on light)
  // via its CSS variable, so it adapts to the color scheme automatically.
  const shadows: string[] = [];
  if (selected) shadows.push("0 0 0 2px var(--mui-palette-text-primary)");
  if (state === "active") shadows.push(`0 0 18px ${withAlpha(accent, 0.55)}`);
  else if (state === "recent") shadows.push(recentGlow(accent, recencyRank));
  const boxShadow = shadows.length > 0 ? shadows.join(", ") : "none";

  return (
    <div
      className={wrapperClass}
      style={
        { "--accent": accent, boxShadow } as React.CSSProperties & {
          "--accent": string;
        }
      }
    >
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.surface}>
        <span className={styles.dot} style={{ background: accent }} />
        {label}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}

export default memo(TraceNode);
