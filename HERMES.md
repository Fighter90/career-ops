@AGENTS.md
<!-- Hermes config — imports AGENTS.md, same as CLAUDE.md / CODEX.md. -->

# Running career-ops with Hermes

[Hermes](https://hermes-agent.nousresearch.com/) (Nous Research) is an open,
AGENTS.md-standard agent runtime. Running it inside this repo already loads the
career-ops instructions: Hermes **auto-injects `AGENTS.md`** (alongside `SOUL.md`,
`.cursorrules`, memory, and preloaded skills) by default — `--ignore-rules` is the
flag that *skips* them. This wrapper makes the entry point explicit and mirrors the
other per-CLI files.

- **Interactive:** `hermes` (or the terminal UI `hermes --tui`) from the repo root,
  then describe the task in plain text (e.g. "run the career-ops pipeline").
- **Headless / batch:** `hermes -z "prompt"` — single prompt in, final response text
  out, nothing else on stdout/stderr. Add `--in <repo-dir>` to set the working
  directory when invoking from elsewhere.
- **Doctor:** pass `--cli hermes` to `doctor.mjs`.

Hermes can *additionally* serve as the [career-ops-ui](https://github.com/Fighter90/career-ops-ui)
web app's LLM provider — run its OpenAI-compatible API Server (`hermes gateway`) and
set `HERMES_API_KEY` in the UI's **App settings**. That is a separate, optional role
(the UI talking to a local Hermes endpoint) and is unrelated to driving career-ops
from the Hermes CLI here.
