import type { Metadata } from "next";
import Link from "next/link";
import styles from "./whyWizardFlow.module.css";

export const metadata: Metadata = {
  title: "Why WizardFlow?",
  description:
    "Portable, local-first agent traces with optional OpenTelemetry export for your existing observability stack.",
  alternates: { canonical: "/why-wizardflow" },
  openGraph: {
    title: "Why WizardFlow?",
    description:
      "Portable agent traces for local replay, sharing, focused debugging, and optional OpenTelemetry export.",
    url: "/why-wizardflow",
  },
};

const comparison = [
  ["Primary artifact", "Portable JSONL file", "Stored platform trace"],
  ["Core interaction", "Graph and replay", "Search and analysis"],
  ["Replay unit", "One message", "Usually a trace"],
  ["Standalone sharing", "Send one file", "Varies by platform"],
  ["OpenTelemetry export", "Optional OTLP traces", "Often built in"],
  ["Fleet-wide monitoring", "Not the focus", "Core capability"],
  ["Team dashboards and evaluations", "Not the focus", "Core capability"],
];

export default function WhyWizardFlowPage() {
  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <Link className={styles.backLink} href="/">
          ← Back to viewer
        </Link>

        <p className={styles.eyebrow}>Why WizardFlow?</p>
        <h1 className={styles.title}>
          An agent run should be easy to replay, understand, and share.
        </h1>
        <p className={styles.lead}>
          WizardFlow turns an agent run into a portable JSONL file and an
          intuitive, graph-based replay. Open it locally or in your
          browser&mdash;no backend or account required.
        </p>

        <section className={styles.featureOverview}>
          <h2>Why WizardFlow?</h2>
          <div className={styles.featureGrid}>
            <article className={styles.featureCard}>
              <p className={styles.featureKicker}>Portable</p>
              <h3>Replayable JSONL artifact</h3>
              <p>
                Keep the evidence behind a demo or benchmark, archive it, or
                share one file with a colleague.
              </p>
            </article>
            <article className={styles.featureCard}>
              <p className={styles.featureKicker}>Visual</p>
              <h3>Per-message graph replay</h3>
              <p>
                Follow each message through the nodes it visited, with timing
                and payloads synchronized as the run advances.
              </p>
            </article>
            <article className={styles.featureCard}>
              <p className={styles.featureKicker}>Accessible</p>
              <h3>Open it in the browser</h3>
              <p>
                Drop the file into getwizardflow.com. No installation, account,
                or command line&mdash;so non-developers can explore it too.
              </p>
            </article>
            <article className={styles.featureCard}>
              <p className={styles.featureKicker}>Simple</p>
              <h3>No backend required</h3>
              <p>
                Record and inspect runs without deploying a trace server or
                maintaining a database. The hosted viewer processes files in
                your browser.
              </p>
            </article>
          </div>
        </section>

        <section className={styles.section}>
          <h2>When one run needs a closer look</h2>
          <p>
            Free, open-source, hosted, and self-hosted observability platforms
            are excellent at collecting many traces, searching across them,
            running evaluations, and supporting production teams.
          </p>
          <p>
            Sharing, reviewing, or archiving one specific run is a different
            workflow. Sometimes the clearest handoff is simply: &ldquo;Open this
            file and replay what happened.&rdquo;
          </p>
        </section>

        <section className={styles.section}>
          <h2>A visual replay anyone can follow</h2>
          <p>
            WizardFlow shows the agent&rsquo;s graph and replays one message at a
            time through the nodes it visited. The graph, message timeline, and
            node inspector remain synchronized as the run advances, making the
            execution understandable without requiring someone to read raw logs
            or interpret a span list.
          </p>
          <div className={styles.playerSketch} aria-label="Example flow replay">
            <div>planner &rarr; retriever &rarr; writer</div>
            <div className={styles.playerControls} aria-hidden="true">
              <span>&#x23EE;</span>
              <span>&#x25C0;</span>
              <span>&#x25B6;</span>
              <span>&#x23ED;</span>
              <span>Speed: 1&times;</span>
            </div>
          </div>
          <p>
            Play, pause, change speed, step through nodes, and move between
            messages with controls that feel like a familiar music player.
          </p>
        </section>

        <section className={styles.section}>
          <h2>The trace is the artifact</h2>
          <p>A WizardFlow trace is an ordinary file. You can:</p>
          <ul>
            <li>attach it to a bug report;</li>
            <li>send it to a teammate;</li>
            <li>commit or archive it;</li>
            <li>inspect or diff it with ordinary tools;</li>
            <li>preserve representative runs as benchmarking artifacts;</li>
            <li>replay it without connecting to a trace backend.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Keep the evidence behind your benchmarks and demos</h2>
          <p>
            Scores show whether performance changed. Replayable traces help
            explain why.
          </p>
          <p>
            When those runs live only inside an observability platform,
            reviewing a benchmark can depend on accounts, retained data, shared
            access, and a specific vendor&rsquo;s interface. WizardFlow keeps each
            run as a portable file that can travel with the benchmark and be
            replayed independently.
          </p>
          <p>
            WizardFlow preserves the evidence. Your benchmarking tools handle
            scoring.
          </p>
          <p>
            For demos, the same replayable file lets people inspect the actual
            path, timing, and payloads behind the final result instead of only
            watching a recording.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Two ways to replay the WizardFlow JSONL</h2>
          <div className={styles.replayGrid}>
            <div>
              <h3>On your machine</h3>
              <code>wizardflow ui run.jsonl</code>
              <p>opens the complete viewer locally.</p>
            </div>
            <div>
              <h3>In the browser</h3>
              <p>
                Non-developers can drop the same file into getwizardflow.com.
                The hosted viewer parses it in the browser; the trace is not
                uploaded.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2>File-first, with optional OpenTelemetry export</h2>
          <p>
            The JSONL trace remains the durable, transport-neutral source of
            truth. It preserves the graph, messages, node executions, timing,
            and recorded payloads without tying the artifact to an
            observability vendor.
          </p>
          <p>
            When you also need centralized traces, the Python SDK can export
            node executions as <strong>OpenTelemetry spans over OTLP</strong>.
            That lets tools such as Phoenix and Langfuse ingest the run through
            their trace pipelines while WizardFlow keeps the replayable file.
          </p>
          <ul>
            <li>Node spans retain the original WizardFlow timestamps.</li>
            <li>LLM, agent, tool, and retrieval semantics map conservatively.</li>
            <li>Prompt and output content export is disabled by default.</li>
            <li>JSONL and OpenTelemetry can be enabled independently.</li>
          </ul>
          <p>
            Importing existing OpenTelemetry traces into WizardFlow is planned
            for a future release.
          </p>
          <a
            className={styles.inlineLink}
            href="https://github.com/lkleonk/wizardflow/blob/main/sdk/python/docs/opentelemetry.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the OpenTelemetry guide
          </a>
        </section>

        <section className={styles.section}>
          <h2>A different starting point</h2>
          <p>
            WizardFlow starts with portable, graph-based replay and can grow
            into centralized observability. Most observability platforms start
            with centralized traces, search, and operational monitoring.
          </p>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>WizardFlow today</th>
                  <th>Operations-focused platforms</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(([capability, wizardFlow, platforms]) => (
                  <tr key={capability}>
                    <th scope="row">{capability}</th>
                    <td>{wizardFlow}</td>
                    <td>{platforms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.section}>
          <h2>Where operations-focused platforms win</h2>
          <p>
            Observability platforms may be free or paid, hosted or self-hosted.
            They are the better fit for continuous production monitoring,
            organization-wide search, retention, dashboards, evaluations, and
            alerts.
          </p>
          <p>
            WizardFlow is especially useful while prototyping and debugging
            individual runs, and when a run should become a durable artifact for
            a demo, benchmark, bug report, or straightforward handoff to a
            colleague.
          </p>
          <p>
            WizardFlow provides the portable, graph-based replay; a backend
            provides the operational view across many runs. Through
            OpenTelemetry, you can use both.
          </p>
        </section>

        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/?example=doctor-consultation">
            Watch an example replay
          </Link>
          <a
            className={styles.secondaryAction}
            href="https://github.com/lkleonk/wizardflow/tree/main/sdk/python#quickstart"
            target="_blank"
            rel="noreferrer"
          >
            View the Python quickstart
          </a>
        </div>
      </article>
    </main>
  );
}
