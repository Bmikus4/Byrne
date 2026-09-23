#!/usr/bin/env python3
"""The session gate. The only sanctioned `git commit` and `git push` in this repository.

Three things, in this order, stopping at the first failure:

  1. CONFIRM.  Typecheck, run the suite, re-render the figures from the examples, take the
     measurement the project's claims rest on, and build. A red suite, a figure that no
     longer matches its example, or an acceptance number outside tolerance exits non-zero
     HAVING WRITTEN NOTHING. A broken state must never reach the feed, because a later
     reader cannot tell a bad measurement from a bad build.

  2. TICKET.   Append one entry to public/data/feed.json carrying the numbers as they
     stood, a headline the entry can be scanned by, and the test count. One feed, append
     only. Old entries may be thinned to their headlines; they are never rewritten.

  3. COMMIT and PUSH.  Subject from -m. The body appends the headline and the ticket id.
     The ticket carries no sha -- it is committed inside the commit it would name -- so
     the ticket id in the message is the join key: git log --grep "Ticket <id>".

A number that moved without a ticket explaining it is a regression. That is the whole
reason the feed is a feed and not a snapshot.

    python scripts/session.py -m "Subject line" [--headline "..."] [--no-push] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEED = ROOT / "public" / "data" / "feed.json"

# The acceptance examples are closed-form problems, so agreement is expected at machine
# precision, not at engineering precision. The one exception is the flux, which is a
# quadrature: its tolerance is the quadrature's, and it is stated separately.
MAX_RELATIVE_ERROR = 1e-12


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, text=True, shell=os.name == "nt", **kw)


def capture(cmd: list[str]) -> str:
    p = run(cmd, capture_output=True)
    if p.returncode != 0:
        sys.stderr.write(p.stdout or "")
        sys.stderr.write(p.stderr or "")
        fail(f"`{' '.join(cmd)}` exited {p.returncode}")
    return p.stdout


def fail(message: str) -> None:
    print(f"\n  GATE FAILED: {message}\n  Nothing was written, committed or pushed.\n")
    sys.exit(1)


def step(label: str) -> None:
    print(f"  -> {label}")


def confirm() -> dict:
    step("types")
    capture(["npx", "tsc", "--noEmit"])

    step("suite")
    p = run(["npx", "vitest", "run", "--reporter=dot"], capture_output=True)
    sys.stdout.write(p.stdout or "")
    if p.returncode != 0:
        sys.stderr.write(p.stderr or "")
        fail("the test suite is red")
    tests = 0
    for line in (p.stdout or "").splitlines():
        if "Tests" in line and "passed" in line:
            for token in line.replace("(", " ").replace(")", " ").split():
                if token.isdigit():
                    tests = max(tests, int(token))
    if tests == 0:
        fail("could not read a test count from the suite output")

    step("figures re-rendered from the examples")
    capture(["node", "scripts/render-figures.mjs"])
    dirty = capture(["git", "status", "--porcelain", "figures"]).strip()
    if dirty:
        print("     (figures changed; they are part of this commit)")

    step("measurement")
    measured = json.loads(capture(["npx", "tsx", "scripts/measure.mjs"]))

    if not measured["allConverged"]:
        fail("an acceptance example did not converge")
    worst = measured["worstRelativeError"]
    if worst > MAX_RELATIVE_ERROR:
        fail(f"worst relative error {worst:.3e} exceeds {MAX_RELATIVE_ERROR:.0e}")
    if not measured["examples"]["F"]["modelIdentical"]:
        fail("changing the display unit moved the model")
    if not measured["examples"]["F"]["exportIdentical"]:
        fail("changing the display unit changed the exported geometry")
    if measured["examples"]["E"]["worstComponent"] > 1e-12:
        fail("the frame round-trip is no longer exact to 1e-12")
    if measured["examples"]["D"]["outsideAbs"] > 1e-9:
        fail("flux through a surface with no charge inside is not zero")

    # The inverted control. The closed forms are perturbed by one part in a thousand; if
    # the comparison still reports agreement, it is not comparing and the numbers above
    # mean nothing. This is the check that stops a tautological measurement passing.
    step("inverted control")
    control = run(
        ["npx", "tsx", "scripts/measure.mjs"], capture_output=True,
        env={**os.environ, "BYRNE_CONTROL": "1"},
    )
    if control.returncode != 0:
        fail("the measurement script fails under the control")
    controlled = json.loads(control.stdout)
    if controlled["worstRelativeError"] < 1e-4:
        fail(
            "the inverted control still agrees to "
            f"{controlled['worstRelativeError']:.1e}: the acceptance comparison is not "
            "comparing anything"
        )
    print(f"     control error {controlled['worstRelativeError']:.3e} (expected ~1e-3)")

    step("build")
    capture(["npx", "vite", "build"])
    capture(["node", "scripts/build-site.mjs"])

    measured["tests"] = tests
    return measured


def ticket(measured: dict, headline: str) -> dict:
    FEED.parent.mkdir(parents=True, exist_ok=True)
    feed = json.loads(FEED.read_text("utf-8")) if FEED.exists() else []
    entry = {
        "id": f"T{len(feed) + 1:04d}",
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "headline": headline,
        "tests": measured["tests"],
        "worstRelativeError": measured["worstRelativeError"],
        "allConverged": measured["allConverged"],
        "examples": measured["examples"],
        "figures": measured["figures"],
        "components": measured["componentsCount"],
    }
    feed.append(entry)
    FEED.write_text(json.dumps(feed, indent=2) + "\n", encoding="utf-8")
    return entry


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-m", "--message", required=True, help="commit subject, <= 80 chars")
    ap.add_argument("--headline", help="feed headline; defaults to the subject")
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="confirm and measure only")
    args = ap.parse_args()

    if len(args.message) > 80:
        fail(f"the subject is {len(args.message)} characters; the limit is 80")

    print("\nCONFIRM")
    measured = confirm()

    print(f"\n  {measured['tests']} tests")
    print(f"  worst relative error {measured['worstRelativeError']:.3e}")
    for name, ex in measured["examples"].items():
        print(f"  {name}: {json.dumps(ex)[:104]}")

    if args.dry_run:
        print("\n  dry run: no ticket, no commit.\n")
        return 0

    print("\nTICKET")
    entry = ticket(measured, args.headline or args.message)
    step(f"{entry['id']} appended to public/data/feed.json")

    print("\nCOMMIT")
    run(["git", "add", "-A"])
    body = (
        f"{entry['headline']}\n\n"
        f"Ticket {entry['id']}. {entry['tests']} tests. "
        f"Worst relative error against the closed forms {entry['worstRelativeError']:.3e}.\n\n"
        "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
    )
    p = run(["git", "commit", "-m", args.message, "-m", body], capture_output=True)
    sys.stdout.write(p.stdout or "")
    if p.returncode != 0:
        sys.stderr.write(p.stderr or "")
        fail("git commit failed; the ticket is written but uncommitted")

    if not args.no_push:
        print("\nPUSH")
        p = run(["git", "push"], capture_output=True)
        sys.stdout.write((p.stdout or "") + (p.stderr or ""))
        if p.returncode != 0:
            fail("git push failed")

    print(f"\n  {entry['id']} -- git log --grep \"Ticket {entry['id']}\"\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
