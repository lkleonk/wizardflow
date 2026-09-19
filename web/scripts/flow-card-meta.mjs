// Maintainer helper: recompute the gallery card stats for every bundled example
// flow. The gallery renders its cards without loading any trace (see the
// `loadTrace` comment in src/data/index.ts), so `nodeCount` / `messageCount` in
// src/data/index.ts are hand-maintained literals — this prints the values they
// should hold, so editing a flow doesn't silently leave its card lying.
//
//   node scripts/flow-card-meta.mjs
//
// Each flow file is data-only, so it's evaluated directly rather than
// type-checked: TS imports and the export annotation are stripped and the rest
// is run as JS. `decorateExampleTrace` only adds presentation metadata and does
// not change graph/message counts, so an identity stub is sufficient here.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import vm from "node:vm";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const flowsDir = path.join(here, "..", "src", "data", "flows");

// Mirrors STRUCTURAL_NODE_IDS in src/utils/traceSelectors.ts.
const STRUCTURAL = new Set(["__start__", "__end__"]);

/** Mirrors `visibleGraph(trace).nodes.length`. */
function visibleNodeCount(trace) {
  const logged = new Set();
  for (const message of trace.messages) {
    for (const step of message.steps) logged.add(step.nodeId);
  }
  return trace.graph.nodes.filter(
    (node) => !(STRUCTURAL.has(node.id) && !logged.has(node.id))
  ).length;
}

for (const file of fs.readdirSync(flowsDir).sort()) {
  if (!file.endsWith(".ts")) continue;
  const source = fs
    .readFileSync(path.join(flowsDir, file), "utf8")
    .replace(/^import[\s\S]*?;\s*$/gm, "")
    .replace(/export const \w+\s*:\s*[\w<>[\]]+\s*=/, "module.exports.trace =");
  const module_ = { exports: {} };
  vm.runInNewContext(source, {
    module: module_,
    exports: module_.exports,
    decorateExampleTrace: (trace) => trace,
  });
  const trace = module_.exports.trace;
  console.log(
    `${file.replace(/\.ts$/, "").padEnd(22)} nodeCount: ${String(
      visibleNodeCount(trace)
    ).padStart(2)}   messageCount: ${trace.messages.length}`
  );
}
