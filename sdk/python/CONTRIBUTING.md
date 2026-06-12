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
folding, completed-only persistence, atomic write, `id=` targeting, unknown-node
fast-fail, …).

## Schema contract

The JSON this SDK serializes to is defined by `src/types/agenttrace.ts` in the
monorepo frontend — that TypeScript type is the schema of record. Change it and
the serializer (`src/wizardflow/client.py`) plus its tests must change in
lockstep; they must not drift.

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
