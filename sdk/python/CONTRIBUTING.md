# Contributing to the WizardFlow Python SDK

This SDK lives in `sdk/python/` of the WizardFlow monorepo. It's pure Python with
no runtime dependencies; `pytest` is the only dev dependency.

## Local development

Work against a local checkout with an editable install:

```bash
cd sdk/python
pip install -e ".[dev]"
```

`tests/conftest.py` puts `src/` on the path, so the suite also runs without any
install.

## Tests

```bash
cd sdk/python
pytest
```

The tests pin the emitted schema shape and the recording semantics (step
folding, completed-only persistence, append-only durability, `id=` targeting,
unknown-node fast-fail, …).

### OTLP protobuf and the OTel packages

WizardFlow encodes and decodes OTLP protobuf itself (`src/wizardflow/otlp_proto.py`),
so neither `protobuf` nor `opentelemetry-proto` is a dependency. The tests check
it against the official classes, and compare the built-in exporter with the
OTel SDK's. Those tests skip without the packages; install them to run
everything:

```bash
pip install opentelemetry-sdk opentelemetry-proto opentelemetry-exporter-otlp-proto-http
```

To compare the two exporters by hand, `wizardflow otel export` takes a hidden
`--exporter otel-sdk` flag that sends through the OTel SDK instead of the
built-in exporter (default `--exporter builtin`). Point both at
`wizardflow serve` and compare what arrives.

## Schema contract

The JSONL this SDK serializes to is defined by `src/types/agenttrace.ts` in the
monorepo frontend. That TypeScript type, including the `header` / `message` /
`seal` record types, is the schema of record. Change it and the serializer
(`src/wizardflow/client.py`) plus the reader (`src/wizardflow/reader.py`) and
their tests must change in lockstep; they must not drift.

## Refreshing the bundled UI

The bundled viewer lives in `src/wizardflow/_ui/` and is committed so a
standalone SDK checkout (and the published package) works without the website
source or a Node build step. Refresh it from the monorepo frontend after UI
changes:

```bash
cd sdk/python
python scripts/build_ui.py
```

That script runs the shared Next frontend with
`NEXT_PUBLIC_WIZARDFLOW_TARGET=local`, copies the static export into
`src/wizardflow/_ui/`, and removes hosted-only legal route artifacts (`Impressum`
/ `Datenschutz`). The SDK UI keeps the GitHub project link.

## Checking live traces by hand

The viewer follows a trace file while it is still being written: it polls with
`If-None-Match`, extends the timeline without losing your place, and stops when
the part rotates away. None of that is covered by an automated test, so there is
a generator to watch it with:

```bash
cd sdk/python
python scripts/live_trace_demo.py
```

It records a synthetic run with the ordinary SDK calls, writing into the
monorepo's `web/public/` (so the trace is same-origin for `npm run dev` in
`web/`) and printing the viewer URL. It rotates after 18 messages, so the sealed
part, the part navigation, and the live pulse dot can all be seen in a couple of
minutes. Like `build_ui.py`, it needs the full monorepo checkout and is never
packaged.
