import { BaseEdge, type EdgeProps } from "@xyflow/react";

// Edge used for pairs that point both ways (e.g. coder ⇄ test_runner). A normal
// edge and its reverse twin would trace nearly the same path and stack into one
// line, hiding the loop. This bows each edge to one side with a quadratic curve;
// because the two edges of a pair travel in opposite directions, the same
// perpendicular rule sends them to opposite sides, so they split into two
// visible lanes. The bow scales with length, so a short same-column pair curves
// gently while a long back-edge arcs clear of the nodes between them.
const MIN_OFFSET = 16;
const MAX_OFFSET = 84;
const OFFSET_RATIO = 0.18;

export default function BiDirectionalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
}: EdgeProps) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const offset = Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, len * OFFSET_RATIO));
  // Unit perpendicular to the travel direction (fixed rotation), so a→b and b→a
  // bow to opposite sides.
  const nx = -dy / len;
  const ny = dx / len;
  const cx = (sourceX + targetX) / 2 + nx * offset;
  const cy = (sourceY + targetY) / 2 + ny * offset;
  const path = `M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`;
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}
