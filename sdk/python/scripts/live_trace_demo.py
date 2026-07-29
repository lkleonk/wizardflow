"""Driver for eyeballing the live-trace UI by hand.

Writes a trace with the real SDK and keeps appending messages, so the viewer has
something that actually grows while you watch it — the only end-to-end exercise
of live updates and part rotation, neither of which has an automated test.

    # 1. start the generator (writes a timestamped trace into web/public,
    #    clearing the previous run's files first)
    cd "C:\\Users\\Leon Koch\\Desktop\\code_Freizeit\\react_projects\\wizardflow\\wizardflow-mui\\sdk\\python"
    python scripts/live_trace_demo.py

    # 2. in another terminal
    cd "C:\\Users\\Leon Koch\\Desktop\\code_Freizeit\\react_projects\\wizardflow\\wizardflow-mui\\web"
    npm run dev
    # open the URL the generator printed

Why `npm run dev` and not `wizardflow ui`: the CLI serves the *bundled* viewer in
src/wizardflow/_ui/, which is a stale export without the polling code. To test
the CLI path (real ETag/304 server) instead, refresh the bundle first with
`python scripts/build_ui.py`, then `wizardflow ui --latest <dir>`.

Maintainer-only, like build_ui.py next to it: needs the monorepo checkout (it
writes into web/) and never ships — the wheel packages src/wizardflow alone.
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

SDK_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SDK_ROOT.parents[1]
sys.path.insert(0, str(SDK_ROOT / "src"))

import wizardflow  # noqa: E402  (path shim above must run first)

# web/public is what the Next dev server serves at /, so the trace lands on a
# same-origin URL the viewer's `?trace=` launcher will accept.
OUT_DIR = REPO_ROOT / "web" / "public"
PREFIX = "live-demo"
# Seeded before the loop, so the viewer opens on a non-empty trace.
INITIAL_MESSAGES = 3
# Between steps within one message, so the recorded timings aren't all zero.
STEP_DELAY = 0.15
# Absurdly low on purpose (the real default is 2000): message 19 seals part 1
# with a `nextPart` seal record and opens __part2, so the rotation path is
# reachable in a couple of minutes instead of never.
MESSAGES_PER_PART = 18

NODES = ["intake", "router", "retriever", "calculator", "responder"]
EDGES = [
    ("intake", "router"),
    # The router picks one branch at runtime — dashed in the viewer.
    {"source": "router", "target": "retriever", "conditional": True},
    {"source": "router", "target": "calculator", "conditional": True},
    ("retriever", "responder"),
    ("calculator", "responder"),
]

QUESTIONS = [
    "What did we ship last quarter?",
    "How many seats are left on the team plan?",
    "Summarize the incident from Tuesday.",
    "What's the refund policy for annual plans?",
    "Which customers churned in June?",
    "How much runway is left at the current burn?",
    "Who owns the billing service now?",
    "What changed in the pricing page last week?",
]


def announce(trace_path: Path) -> None:
    """Print the viewer URL for a part.

    Port 3000 is just Next's dev default — nothing here checks it. If
    `npm run dev` fell back to 3001, fix the port by hand.
    """
    print(f"Open:     http://localhost:3000/?trace=/{trace_path.name}")


def emit_message(index: int) -> None:
    """One run through the graph: intake → router → branch → responder."""
    message_id = f"msg-{index:03d}"
    question = random.choice(QUESTIONS)

    wizardflow.log(message_id, "intake", "user_question", question)
    time.sleep(STEP_DELAY)

    branch = random.choice(["retriever", "calculator"])
    wizardflow.log(message_id, "router", "chosen_branch", branch)
    wizardflow.log(message_id, "router", "confidence", round(random.uniform(0.6, 0.99), 2))
    time.sleep(STEP_DELAY)

    if branch == "retriever":
        wizardflow.log(
            message_id,
            "retriever",
            "documents",
            [
                {"id": f"doc-{random.randint(100, 999)}", "score": round(random.random(), 3)}
                for _ in range(3)
            ],
        )
    else:
        operands = [random.randint(2, 40) for _ in range(3)]
        wizardflow.log(message_id, "calculator", "operands", operands)
        wizardflow.log(message_id, "calculator", "result", sum(operands))
    time.sleep(STEP_DELAY)

    wizardflow.log(
        message_id,
        "responder",
        "answer",
        f"[{index}] Answer assembled via {branch} for: {question}",
    )
    # end_message is the call that appends the line — this is the moment the
    # file grows and the viewer's next poll sees a new message.
    wizardflow.end_message(
        message_id,
        title=question,
        meta={"branch": branch, "seq": index},
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--interval",
        type=float,
        default=6.0,
        help="Seconds between appended messages (default: 6).",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=40,
        help="How many messages to append before exiting (default: 40).",
    )
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Every run writes a new timestamped file, so clear the previous ones —
    # unconditionally, because this directory is only ever demo scratch.
    for stale in OUT_DIR.glob(f"{PREFIX}__*.jsonl"):
        stale.unlink()
        print(f"Removed:  {stale.name}")

    client = wizardflow.init(
        output_dir=str(OUT_DIR),
        file_prefix=PREFIX,
        max_messages=MESSAGES_PER_PART,
        name="Live demo run",
        description="Synthetic run that keeps appending, for testing live updates.",
        nodes=NODES,
        edges=EDGES,
        node_descriptions={
            "intake": "Receives the user question.",
            "router": "Picks the branch that can answer it.",
            "retriever": "Looks up supporting documents.",
            "calculator": "Runs the arithmetic path.",
            "responder": "Writes the final answer.",
        },
    )

    trace_path = Path(client.current_path)
    print(f"Writing:  {trace_path}")
    announce(trace_path)
    print()

    index = 0
    for _ in range(INITIAL_MESSAGES):
        index += 1
        emit_message(index)
    print(f"Seeded {index} messages — open the viewer now, then watch it grow.")
    print(
        f"Part rotates after message {MESSAGES_PER_PART} — the viewer stops "
        "following there; step to the new part with the › control in the "
        "header (its URL is printed below too)."
    )
    print("Ctrl+C to stop.\n")

    try:
        while index < INITIAL_MESSAGES + args.count:
            time.sleep(args.interval)
            index += 1
            emit_message(index)
            print(f"  appended message {index}")
            # A rotation seals the part the viewer is watching (adding the
            # `nextPart` record that switches its pulse dot off) and moves
            # writing to a new file, which is a different URL.
            if Path(client.current_path) != trace_path:
                trace_path = Path(client.current_path)
                print(f"\n  ── rotated. Sealed part done; now writing {trace_path.name}")
                announce(trace_path)
                print()
    except KeyboardInterrupt:
        print("\nStopped.")

    # No seal record is written here — a normally-finished run just stops, which
    # is exactly why the viewer can't tell "done" from "idle" and keeps polling
    # slowly instead of stopping.
    print(f"\nDone. {index} messages in {trace_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
