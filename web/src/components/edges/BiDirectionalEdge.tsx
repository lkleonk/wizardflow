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
const ENDPOINT_TRIM_RATIO = 0;

function trimEndpoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const trim = len * ENDPOINT_TRIM_RATIO;
  const ux = dx / len;
  const uy = dy / len;

  return {
    sourceX: sourceX + ux * trim,
    sourceY: sourceY + uy * trim,
    targetX: targetX - ux * trim,
    targetY: targetY - uy * trim,
  };
}

export function TrimmedStraightEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
}: EdgeProps) {
  const trimmed = trimEndpoints(sourceX, sourceY, targetX, targetY);
  const path = `M ${trimmed.sourceX},${trimmed.sourceY} L ${trimmed.targetX},${trimmed.targetY}`;

  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}

export default function BiDirectionalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
}: EdgeProps) {
  const trimmed = trimEndpoints(sourceX, sourceY, targetX, targetY);
  const dx = trimmed.targetX - trimmed.sourceX;
  const dy = trimmed.targetY - trimmed.sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const offset = Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, len * OFFSET_RATIO));
  // Unit perpendicular to the travel direction (fixed rotation), so a→b and b→a
  // bow to opposite sides.
  const nx = -dy / len;
  const ny = dx / len;
  const cx = (trimmed.sourceX + trimmed.targetX) / 2 + nx * offset;
  const cy = (trimmed.sourceY + trimmed.targetY) / 2 + ny * offset;
  const path = `M ${trimmed.sourceX},${trimmed.sourceY} Q ${cx},${cy} ${trimmed.targetX},${trimmed.targetY}`;
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}
