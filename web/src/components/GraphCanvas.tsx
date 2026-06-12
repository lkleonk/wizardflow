"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Panel,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useColorScheme } from "@mui/material/styles";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import type { AgentTraceNode, AgentTraceEdge } from "@/types/agenttrace";
import { nodeColorAt } from "@/theme/muiTheme";
import { layoutGraph, type NodePosition } from "@/utils/graphLayout";
import TraceNode, { type TraceNodeData } from "@/components/nodes/TraceNode";
import BiDirectionalEdge, {
  TrimmedStraightEdge,
} from "@/components/edges/BiDirectionalEdge";

// Defined once outside the component — React Flow warns if nodeTypes/edgeTypes
// is a new object on every render.
const nodeTypes = { trace: TraceNode };
const edgeTypes = {
  trimmed: TrimmedStraightEdge,
  bidirectional: BiDirectionalEdge,
};
const layoutControlStyle = {
  width: 34,
  height: 34,
  padding: 5,
} satisfies React.CSSProperties;
const layoutControlIconStyle = {
  fontSize: 22,
  maxWidth: 22,
  maxHeight: 22,
} satisfies React.CSSProperties;

type GraphCanvasProps = {
  nodes: AgentTraceNode[];
  edges: AgentTraceEdge[];
  activeNodeId?: string;
  selectedNodeId?: string;
  /** Nodes visited earlier in the current message, most-recent first. */
  recentNodeIds: string[];
  onSelectNode: (nodeId: string) => void;
  /** Locks dragging while a trace plays. */
  isPlaying: boolean;
  arrangeMode: boolean;
  onArrangeModeChange: (enabled: boolean) => void;
};

type BuildArgs = {
  nodes: AgentTraceNode[];
  positions: Map<string, NodePosition>;
  activeNodeId?: string;
  selectedNodeId?: string;
  recencyRank: Map<string, number>;
  draggable: boolean;
  /** Positions a node currently sits at (e.g. dragged), preferred over layout. */
  livePositions: Map<string, NodePosition>;
};

type EdgeHandleSide = "left" | "right" | "top" | "bottom";

function edgeHandleSides(
  source?: NodePosition,
  target?: NodePosition
): { sourceHandle?: string; targetHandle?: string } {
  if (!source || !target) return {};

  const dx = target.x - source.x;
  const dy = target.y - source.y;
  let sourceSide: EdgeHandleSide;
  let targetSide: EdgeHandleSide;

  if (Math.abs(dx) >= Math.abs(dy)) {
    sourceSide = dx >= 0 ? "right" : "left";
    targetSide = dx >= 0 ? "left" : "right";
  } else {
    sourceSide = dy >= 0 ? "bottom" : "top";
    targetSide = dy >= 0 ? "top" : "bottom";
  }

  return {
    sourceHandle: `source-${sourceSide}`,
    targetHandle: `target-${targetSide}`,
  };
}

// Build the React Flow nodes from trace data. Position priority: wherever the
// node already sits (so a user's drag survives data-only re-renders), then the
// computed layout for nodes we haven't seen yet.
function buildNodes({
  nodes,
  positions,
  activeNodeId,
  selectedNodeId,
  recencyRank,
  draggable,
  livePositions,
}: BuildArgs): Node<TraceNodeData>[] {
  return nodes.map((node, index) => {
    const accent = node.color ?? nodeColorAt(index);
    const state =
      node.id === activeNodeId
        ? "active"
        : recencyRank.has(node.id)
          ? "recent"
          : "normal";
    const position =
      livePositions.get(node.id) ?? positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      id: node.id,
      type: "trace",
      position,
      data: {
        label: node.label ?? node.id,
        accent,
        state,
        recencyRank: recencyRank.get(node.id) ?? 0,
        selected: node.id === selectedNodeId,
      },
      // No fixed width/height — let the node size to its content so the
      // ring/glow (on the wrapper) hugs the surface instead of leaking into
      // empty space. React Flow measures the real size for edges/fitView.
      draggable,
      connectable: false,
    };
  });
}

export default function GraphCanvas({
  nodes,
  edges,
  activeNodeId,
  selectedNodeId,
  recentNodeIds,
  onSelectNode,
  isPlaying,
  arrangeMode,
  onArrangeModeChange,
}: GraphCanvasProps) {
  const { mode, systemMode } = useColorScheme();
  const isDark = (mode === "system" ? systemMode : mode) !== "light";

  // Positions depend only on graph topology, so memoize on nodes/edges.
  const positions = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);

  // Remount React Flow (and refit the view) when the graph itself changes,
  // e.g. after loading a different trace. (Node positions are reset separately
  // in the sync effect below — remounting only refits the viewport.)
  const graphKey = useMemo(() => nodes.map((n) => n.id).join("|"), [nodes]);

  const recencyRank = useMemo(() => {
    const map = new Map<string, number>();
    recentNodeIds.forEach((id, i) => map.set(id, i));
    return map;
  }, [recentNodeIds]);

  // Arrange mode lets the user drag nodes into their own mental layout. The
  // page owns this state so transport/header interactions can leave it cleanly.
  const arranging = arrangeMode && !isPlaying;

  useEffect(() => {
    if (isPlaying && arrangeMode) {
      onArrangeModeChange(false);
    }
  }, [isPlaying, arrangeMode, onArrangeModeChange]);

  // React Flow owns node positions internally so a drag sticks. We only seed the
  // initial layout here; topology/state updates flow through the effect below.
  const initialNodes = useMemo(
    () =>
      buildNodes({
        nodes,
        positions,
        activeNodeId,
        selectedNodeId,
        recencyRank,
        draggable: false,
        livePositions: new Map(),
      }),
    // Mount only — see the sync effect for subsequent updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [rfNodes, setRfNodes, onNodesChange] =
    useNodesState<Node<TraceNodeData>>(initialNodes);

  // The graph we last synced positions for. A dragged position belongs to one
  // graph only, so when the graph identity changes (a different flow loaded) we
  // must drop the carried-over positions — node ids recur across flows (e.g.
  // "user_input"), so reusing them would teleport the new flow's nodes.
  const syncedGraphKey = useRef(graphKey);

  // Push trace/state changes (active, recent, selection, drag-enabled) into the
  // nodes while preserving each node's current position — that's what keeps a
  // dragged layout intact as playback updates highlights every step. Across a
  // graph change we start fresh from the computed layout instead.
  useEffect(() => {
    setRfNodes((prev) => {
      const sameGraph = syncedGraphKey.current === graphKey;
      syncedGraphKey.current = graphKey;
      const livePositions = sameGraph
        ? new Map(prev.map((n) => [n.id, n.position]))
        : new Map<string, NodePosition>();
      return buildNodes({
        nodes,
        positions,
        activeNodeId,
        selectedNodeId,
        recencyRank,
        draggable: arranging,
        livePositions,
      });
    });
  }, [
    graphKey,
    nodes,
    positions,
    activeNodeId,
    selectedNodeId,
    recencyRank,
    arranging,
    setRfNodes,
  ]);

  // Snap every node back to the computed layout, discarding manual positions.
  const resetLayout = useCallback(() => {
    setRfNodes((prev) =>
      prev.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position }))
    );
  }, [positions, setRfNodes]);

  const rfEdges = useMemo<Edge[]>(() => {
    const onPath = new Set(recentNodeIds);
    if (activeNodeId) onPath.add(activeNodeId);
    const traversedStroke = isDark ? "#C2C9D4" : "#4A5260";
    const idleStroke = isDark ? "#586273" : "#B4BBC6";
    const livePositions = new Map(rfNodes.map((n) => [n.id, n.position]));
    // Edges that have a reverse twin (a→b and b→a both exist) get the curved
    // bidirectional edge so the loop is visible instead of two stacked lines.
    const edgeKeys = new Set(edges.map((e) => `${e.source}->${e.target}`));
    return edges.map((edge) => {
      const traversed = onPath.has(edge.source) && onPath.has(edge.target);
      const isBidirectional = edgeKeys.has(`${edge.target}->${edge.source}`);
      const handles = edgeHandleSides(
        livePositions.get(edge.source) ?? positions.get(edge.source),
        livePositions.get(edge.target) ?? positions.get(edge.target)
      );
      return {
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        ...handles,
        type: isBidirectional ? "bidirectional" : "trimmed",
        style: {
          stroke: traversed ? traversedStroke : idleStroke,
          strokeWidth: traversed ? 2.25 : 1.6,
          // Conditional (branch) edges render dashed; they still take the
          // traversed color above when the agent went that way.
          ...(edge.conditional ? { strokeDasharray: "6 4" } : null),
        },
      };
    });
  }, [edges, recentNodeIds, activeNodeId, isDark, rfNodes, positions]);

  const handleNodeClick: NodeMouseHandler = (_, node) => onSelectNode(node.id);
  const arrangeTitle = isPlaying
    ? "Arrange unavailable during playback"
    : arranging
      ? "Done arranging"
      : "Arrange nodes";

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 0 }}>
      <ReactFlow
        key={graphKey}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        proOptions={{ hideAttribution: false }}
        nodesDraggable={arranging}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.3}
        maxZoom={1.75}
        colorMode={isDark ? "dark" : "light"}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={isDark ? "#23272e" : "#d8dce2"}
        />
        <Controls showInteractive={false} />
        <Panel
          position="top-right"
          className="react-flow__controls"
          aria-label="Graph layout controls"
        >
          <ControlButton
            onClick={() => onArrangeModeChange(!arrangeMode)}
            disabled={isPlaying}
            title={arrangeTitle}
            aria-label={arrangeTitle}
            aria-pressed={arranging}
            style={{
              ...layoutControlStyle,
              ...(arranging ? { color: "var(--mui-palette-primary-main)" } : {}),
            }}
          >
            <OpenWithIcon style={layoutControlIconStyle} />
          </ControlButton>
          {arranging && (
            <ControlButton
              onClick={resetLayout}
              title="Reset layout"
              aria-label="Reset layout"
              style={layoutControlStyle}
            >
              <RestartAltIcon style={layoutControlIconStyle} />
            </ControlButton>
          )}
        </Panel>
      </ReactFlow>
    </div>
  );
}
