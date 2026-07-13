# AI version-control rules

These rules apply to the entire repository.

## Before changing code

1. Run `git status --short --branch` and inspect the current branch and worktree.
2. Never discard, overwrite, or rewrite existing user changes.
3. If the worktree contains uncommitted changes, create a checkpoint commit before editing:
   `git add -A && git commit -m "checkpoint: save state before AI changes"`.
4. Do not commit secrets, local environment files, logs, dependencies, build caches, APK/AAB files, or other generated artifacts.
5. Keep each task focused. Do not include unrelated refactors or formatting changes.

## After changing code

1. Review `git diff` and run the relevant tests or build.
2. Create one independent commit for the completed task, using a message that describes the result.
3. Push the commit to `origin` so the version is backed up remotely, unless the user explicitly says not to push.
4. Report the commit ID, tests run, and whether the push succeeded.

## Safety

- Do not use `git reset --hard`, `git clean`, history rewriting, force-push, or branch deletion without explicit user approval.
- Prefer `git revert <commit>` to undo a committed change while preserving history.
- Prefer `git switch -c recovery/<name> <commit-or-tag>` when inspecting or recovering an older version.
