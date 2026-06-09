"""Build and sync the local WizardFlow UI into the Python package.

Run from sdk/python/ whenever the committed SDK UI bundle should be refreshed:

    python scripts/build_ui.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


SDK_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SDK_ROOT.parents[1]
WEB_DIR = REPO_ROOT / "web"
WEB_OUT = WEB_DIR / "out"
PACKAGE_UI_DIR = SDK_ROOT / "src" / "wizardflow" / "_ui"
HOSTED_ONLY_ROUTE_STEMS = ("impressum", "datenschutz")


def main() -> int:
    env = os.environ.copy()
    env["NEXT_PUBLIC_WIZARDFLOW_TARGET"] = "local"

    if not WEB_DIR.is_dir():
        raise SystemExit(
            "Could not find the monorepo web/ directory. This maintainer sync "
            "script must run from a checkout that includes the frontend source."
        )

    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm") or shutil.which("npm")
    if npm is None:
        raise SystemExit("Could not find npm on PATH")

    subprocess.run([npm, "run", "build"], cwd=WEB_DIR, env=env, check=True)
    if not (WEB_OUT / "index.html").is_file():
        raise SystemExit(f"Next static export did not produce {WEB_OUT / 'index.html'}")

    PACKAGE_UI_DIR.mkdir(parents=True, exist_ok=True)
    for child in PACKAGE_UI_DIR.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()

    for child in WEB_OUT.iterdir():
        target = PACKAGE_UI_DIR / child.name
        if child.is_dir():
            shutil.copytree(child, target)
        else:
            shutil.copy2(child, target)

    _remove_hosted_only_routes()
    print(f"Synced local WizardFlow UI to {PACKAGE_UI_DIR}")
    return 0


def _remove_hosted_only_routes() -> None:
    for stem in HOSTED_ONLY_ROUTE_STEMS:
        for path in (
            PACKAGE_UI_DIR / stem,
            PACKAGE_UI_DIR / f"{stem}.html",
            PACKAGE_UI_DIR / f"{stem}.txt",
        ):
            if path.is_dir():
                shutil.rmtree(path)
            elif path.exists():
                path.unlink()


if __name__ == "__main__":
    raise SystemExit(main())
