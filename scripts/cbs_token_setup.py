"""
scripts/cbs_token_setup.py — STUB

Owner: integration-doctor. Ground truth: docs/04_INTEGRATIONS.md §B,
docs/09_DEPLOYMENT.md §CBS live sync (one-time token step).

One-time human setup, run on the Mac with a browser logged into CBS. Guides
the user to obtain the legacy CBS access_token. The token/cookies stay on
the machine, go in .env, are NEVER printed or sent to the LLM. On success,
print ONLY "token acquired, add it to Vercel env as CBS_ACCESS_TOKEN" — never
the token itself. If the legacy flow is dead, report it and fall back to
manual entry (CBS automation is best-effort, never required).
"""

from __future__ import annotations


def guide_token_acquisition() -> bool:
    """Interactive walkthrough; returns True if a token was acquired and
    written to .env, False if the legacy flow appears dead."""
    raise NotImplementedError("integration-doctor: implement guide_token_acquisition")


if __name__ == "__main__":
    raise NotImplementedError("integration-doctor: wire CLI entrypoint (never print the token)")
