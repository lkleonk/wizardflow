"""Shared plain helpers for SDK trace tests."""

import contextlib
import json

from wizardflow import Client


def _new(tmp_path, **kw):
    return Client(output_dir=str(tmp_path), file_prefix="trace", **kw)


def _read_part(path):
    """Parse a JSONL part file into (header, messages, seal)."""
    header, messages, seal = None, [], None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            rec = json.loads(line)
            if rec["type"] == "header":
                header = rec
            elif rec["type"] == "message":
                messages.append(rec)
            elif rec["type"] == "seal":
                seal = rec
    return header, messages, seal

class _FakeOTelBridge:
    def __init__(self):
        self.calls = []

    def start_run(self, timestamp, trace_name, nodes, edges):
        self.calls.append(("start_run", timestamp, trace_name, nodes, edges))

    def start_node(self, message_id, node, kind, timestamp, trace_name):
        self.calls.append(("start", message_id, node, kind, timestamp, trace_name))

    def end_node(
        self, message_id, node, kind, timestamp, payloads, message_meta=None, *, error=None
    ):
        self.calls.append(
            ("end", message_id, node, kind, timestamp, payloads, message_meta)
        )

    def start_workflow(self, message_id, timestamp):
        self.calls.append(("start_workflow", message_id, timestamp))

    def use_workflow(self, message_id):
        self.calls.append(("use_workflow", message_id))
        return contextlib.nullcontext()

    def end_workflow(
        self, message_id, timestamp, *, title=None, meta=None, attributes=None, error=None
    ):
        self.calls.append(
            ("end_workflow", message_id, timestamp, title, meta, attributes, error)
        )

    def set_root_attributes(self, attributes):
        self.calls.append(("set_root_attributes", attributes))

    def reinit_run(self, end_timestamp, start_timestamp, trace_name, nodes, edges):
        self.calls.append(
            ("reinit_run", end_timestamp, start_timestamp, trace_name, nodes, edges)
        )

    def close(self, timestamp):
        self.calls.append(("close", timestamp))


def _log_one(client, message_id, payload):
    client.log(message_id, "a", "blob", payload)
    client.end_message(message_id)
