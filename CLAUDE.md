# handoff-template

## Usage-based auto-handoff

This repo has a git-based checkpoint system for Claude Code sessions,
replacing the old Tailscale/SSH/WSL remote-access setup.

**How it works:** `ccusage` (installed globally via `npm install -g ccusage`
— it's a Node CLI, not a `uv`/Python tool) reads live token usage for the
current 5h ccusage billing block from local transcript data. It has no
access to Anthropic's actual account rate-limit/quota numbers, so this is
still an approximation — just a token-based one instead of a wall-clock one.

- `PreToolUse` and `Stop` hooks (`.claude/hooks/handoff-check.sh`) call
  `ccusage blocks --active --json` on every tool call and read the active
  block's `totalTokens`. Every time cumulative usage in that block crosses a
  new 1,000,000-token increment since the last checkpoint (tracked in the
  gitignored `.claude/.last_checkpoint_tokens`), the hook:
  1. Stages and commits any pending work (`Auto-handoff: checkpoint at
     ~N tokens in current session block`).
  2. Writes `resume-note.md` with the last commit, working-tree status, and
     next steps.
  3. Commits `resume-note.md` and pushes.
  4. Records the new checkpoint baseline.
- This is **non-blocking** — it never stops the session or the tool call. It
  just leaves a trail of restore points so a checkpoint is never more than
  ~1M tokens stale. If the active block rolls over to a new 5h window, the
  hook detects the token count resetting lower and re-baselines instead of
  computing a bogus diff.
- `ccusage`'s npm global bin is not on this machine's PATH (a pre-existing
  custom npmrc prefix at `C:\home\mkpc\.npm-global`). The hook checks PATH
  first, then falls back to that known install path. If `ccusage` isn't
  reachable at all, the hook exits quietly rather than failing the tool call.

**Instruction for Claude:** after any auto-handoff commit (a commit message
starting with `Auto-handoff:`), run `git push` immediately if it hasn't
already gone out — the hook pulls --rebase and pushes itself and records any failure in
`.claude/.last_checkpoint_sync_problem`, but treat an
unpushed auto-handoff commit as unfinished business at the start of your
next session.

**Resuming work:** start a new Claude Code session in this repo and read
`resume-note.md` first if it exists.

## Commands

- Rerun the semantic doc pass: in Claude Code, run `/graphify . --update --mode deep`. It re-reads only new or changed docs and images, with an LLM, and keeps the rest of the graph. Run it after significant doc changes (new docs, or heavily edited `.md` files). The git hooks refresh code only and never re-read docs.

## Working rules

- Before building anything, write success criteria and the tests that prove them.
- Record each non-trivial design decision in `docs/decisions.md`.
- After finishing a feature, create `docs/explainer-<feature>.html`: a one-page, plain-language visual of what was built and why, for a non-programmer.
- Before pushing a finished feature or milestone, run a review subagent that has not seen this conversation; it reads the diff and the success criteria and reports problems. Fix them before pushing. Checkpoint pushes are backups and need no review.
- If context gets compacted, tell me to run /clear so the next session starts from `resume-note.md`.

## Hooks

- `PreCompact`: forces a checkpoint (commit, update `resume-note.md`, `git pull --rebase`, push). Files over 50 MB are never committed, and a checkpoint that would add over 200 MB commits nothing. Any failure (rebase conflict, other pull failure, rejected push, repo mid-rebase) leaves the commits local, forces nothing, and is written to `.claude/.last_checkpoint_sync_problem`; `SessionStart` shows that note, then injects `resume-note.md`.
- `Stop` (`stop.sh`, the only Stop hook): runs the project's test command first, then the token checkpoint. Failing tests block stopping (once; guarded by `stop_hook_active`; tests are capped at 240s and a timeout counts as a failure) and skip the checkpoint. Define it by adding a line starting with `Test command:` followed by the command. No such line means tests are skipped and only the checkpoint runs.
