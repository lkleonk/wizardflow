import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import styles from "./whyWizardFlow.module.css";

export const metadata: Metadata = {
  title: "Why WizardFlow?",
  description:
    "See how WizardFlow's portable, local-first agent traces differ from hosted observability platforms.",
  alternates: { canonical: "/why-wizardflow" },
  openGraph: {
    title: "Why WizardFlow?",
    description:
      "Portable agent traces for local replay, sharing, and focused debugging.",
    url: "/why-wizardflow",
  },
};

const comparison = [
  ["Primary artifact", "Portable JSONL file", "Stored platform trace"],
  ["Local replay", "Included", "Usually platform-oriented"],
  ["Production monitoring", "Not the focus", "Core capability"],
  ["Team dashboards and evaluations", "Not the focus", "Core capability"],
];

export default function WhyWizardFlowPage() {
  if (!isHostedWizardFlow) notFound();

  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <Link className={styles.backLink} href="/">
          ← Back to viewer
        </Link>

        <p className={styles.eyebrow}>Why WizardFlow?</p>
        <h1 className={styles.title}>
          One agent run shouldn&rsquo;t require an observability platform.
        </h1>
        <p className={styles.lead}>
          WizardFlow turns an agent run into a portable JSONL file you can
          replay locally or drop into the browser.
        </p>

        <section className={styles.section}>
          <h2>When one run needs a closer look</h2>
          <p>
            You want to show a teammate why one run went wrong. Traditional
            observability products are designed around persistent
            infrastructure: servers, accounts, instrumentation pipelines, and
            dashboards.
          </p>
          <p>
            Those capabilities are valuable in production—but often excessive
            when the task is simply: “Look at this run.”
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
          <h2>Two ways to replay</h2>
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
          <h2>What you avoid</h2>
          <ul className={styles.compactList}>
            <li>No account</li>
            <li>No trace server or database</li>
            <li>No runtime dependencies</li>
            <li>No framework requirement</li>
            <li>No permanent platform commitment</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>A focused tool, not a smaller platform</h2>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>WizardFlow</th>
                  <th>Observability platforms</th>
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
          <h2>Where platforms win</h2>
          <p>
            If you need centralized production monitoring, shared dashboards,
            hosted evaluations, alerting, or long-term team analytics, a full
            observability platform may be the better tool.
          </p>
          <p>
            WizardFlow is designed for recording, replaying, and sharing
            individual runs as files.
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
