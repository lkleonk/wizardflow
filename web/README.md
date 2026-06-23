# WizardFlow

WizardFlow is a small Next.js visualizer for replaying agent flows. It shows
each user message as a timeline item, replays the ordered node steps for that
message, highlights activity in the graph, and lets you inspect payloads for the
selected node.

## Features

- Message timeline for switching between messages.
- Graph replay with active and recently active node highlighting.
- Conditional (branch) edges shown dashed to distinguish them from edges that
  are always followed.
- Inspector panel for node payloads.
- Scrubber and transport controls for stepping through a message.
- Playback end modes:
  - stop at the end of the current message
  - repeat the current message
  - continue with the next message
- Playback speed cycle: `0.5x`, `1x`, `1.5x`, `2x`.
- Example flow gallery (bundled sample flows) plus JSONL/JSON trace upload.
- Light and dark mode.

## Keyboard Controls

Keyboard shortcuts are ignored while typing or while a button/input has focus.

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `ArrowLeft` | Previous node step |
| `ArrowRight` | Next node step |
| `ArrowUp` | Previous message |
| `ArrowDown` | Next message |
| `Home` | First step in the current message |
| `End` | Last step in the current message |

## Flow Format

The app accepts JSONL traces written by the Python SDK and legacy
single-document JSON traces. Both are parsed into one in-memory
`AgentTraceFile`:

```ts
type AgentTraceFile = {
  version: "0.1" | "0.2";
  name?: string;
  meta?: Record<string, string | number | boolean>;
  graph: {
    nodes: AgentTraceNode[];
    edges: AgentTraceEdge[];
  };
  messages: AgentTraceMessage[];
};
```

Each message contains ordered or unordered steps. The UI sorts steps by their
ISO timestamp before replaying them. An edge may set `conditional: true` to mark
a runtime branch (rendered dashed); plain edges are always followed.

See `src/types/agenttrace.ts` for the full schema and `src/data/flows/` for the
bundled example flows (registered in `src/data/index.ts`).

## Development

Install dependencies:

```bash
npm install
```

Run the local development server:

```bash
npm run dev
```

Run lint:

```bash
npm run lint
```

Build for production:

```bash
npm run build
```

The app is configured for static export (`output: "export"` in
`next.config.ts`), so the build emits a fully static site to `out/` — no server
runtime is required. Set `NEXT_PUBLIC_SITE_URL` at build time to override the
default origin used for canonical/OG/sitemap URLs.

Set `NEXT_PUBLIC_WIZARDFLOW_TARGET=local` for SDK/local UI builds. The default
target is `hosted`; hosted builds show the legal footer links and include those
routes in the sitemap, while local builds keep only the GitHub project link in
the footer.

For local SDK launches, the static app can auto-load a same-origin trace URL:
`/?trace=/__wizardflow_trace.json&traceName=run.json`. The Python CLI serves
that JSON endpoint; no Next.js API route or server runtime is required.

## Deployment

The build is a static site (`out/`), deployable to any static host or to Vercel
(which detects the static export automatically). Before publishing publicly,
review any legal pages you may need for your jurisdiction, such as
imprint/contact and privacy information.
