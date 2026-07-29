# npm Package Release Workflow

Use this when the user asks to release `@cleanslate/sdk` or `@cleanslate/cli`.

For releasing the desktop IDE, see [release-workflow.md](./release-workflow.md).
The two are unrelated: the IDE is driven by the root `VERSION` file and a GitHub
workflow, the packages are published by hand from a developer machine.

## The Packages

| Package | Directory | What it is |
| --- | --- | --- |
| `@cleanslate/sdk` | `packages/cleanslate-sdk` | the agent runtime — loop, 59 tools, edit engine, Node host |
| `@cleanslate/cli` | `packages/cleanslate-cli` | the terminal surface, depends on the SDK |

Both are public, MIT, and owned by the `cleanslate` npm organization. The
publishing account is `thewariend`.

## How A Release Starts

There is no workflow and no trigger file. A release is a version bump, a
commit, a tag, and a manual `npm publish`.

**Release only what changed.** If a fix touches the CLI alone, the SDK stays at
its current version. Do not bump both out of tidiness — an unchanged package
republished under a new number tells users something changed when nothing did.

## Order

The CLI declares a dependency on the SDK, so when both change the SDK goes
first. Publishing the CLI against an SDK version that is not yet on the registry
fails to resolve.

## Steps

Bump the changed package. `npm version` writes `package.json` and the lockfile
but does **not** commit here, because the workspace root is above the package —
commit and tag by hand:

```sh
cd packages/cleanslate-cli
npm version patch          # patch | minor
cd ../..
git add -A
git commit -m "release: cleanslate-cli <version>"
git tag -a cleanslate-cli-v<version> -m "cleanslate-cli <version>"
git push origin <branch> --follow-tags
```

Then publish, from the package directory:

```sh
cd packages/cleanslate-cli
npm publish
```

`prepublishOnly` runs a clean build and the full suite first, so a broken or
failing package cannot go out. Publishing prompts for 2FA — the account uses a
security key, so npm opens a browser for Touch ID.

**The publish step needs a human.** Run non-interactively it cannot complete the
browser flow and fails with `EOTP`. Hand the command to the user rather than
running it.

## Version Numbers

Both packages are `0.x`, where breaking changes are expected and a minor bump
carries them.

| Change | Bump |
| --- | --- |
| bug fix, no API change | `patch` |
| new capability, or a changed host interface | `minor` |

Tags are namespaced per package — `cleanslate-cli-v0.1.1`, not `v0.1.1` — so the
two packages and the IDE do not collide in one tag space.

## Rules

- Never name another product in a commit message, tag, or changelog entry. The
  repository is public and its history was deliberately scrubbed of such
  references. Describe what the change does. Credit genuinely borrowed code in
  `NOTICE` and reference that file, not the source by name.
- `dist/` is gitignored, and npm publishes from disk. Never publish without a
  build — `prepublishOnly` enforces this, so do not bypass it with
  `--ignore-scripts`.
- A published version number is spent for good. If a publish fails after the
  registry has accepted it, bump again rather than retrying the same number.
- Unpublishing is possible for 72 hours and then not at all. Treat publishing as
  final.

## Preflight

```sh
git status --short --branch
npm test --workspaces
npm view @cleanslate/sdk version
npm view @cleanslate/cli version
npm whoami
```

The working tree should be clean, both suites green, and `npm whoami` should
print `thewariend`. Compare the published versions above against the local
`package.json` to see what actually needs releasing.

Check the tarball before publishing anything:

```sh
cd packages/cleanslate-sdk && npm pack --dry-run
```

`LICENSE`, `NOTICE` and `README.md` must be present — the SDK vendors VS Code
code and the notice has to travel with the tarball. No `src/` and no compiled
tests should appear.

## Confirm

```sh
npm view @cleanslate/cli version
```

The registry's read path is cached and a fresh publish can take several minutes
to become visible, longer for a scope's first ever publish. A 404 straight after
a successful publish is propagation, not failure — do not republish. Verify with
a real install once it appears:

```sh
cd /tmp && npm install -g @cleanslate/cli && cleanslate --version
```

## How Users Update

```sh
npm install -g @cleanslate/cli@latest
```

`npx @cleanslate/cli` always fetches the newest version, so those users get a
release with no action. Anyone who installed an older version stays on it until
they update.

## Final Response Checklist

Tell the user:

- Which packages were released and at which versions, and which were left alone.
- The commit hash and the tag.
- That the branch and tag are pushed.
- The published version confirmed on the registry, or that it is still
  propagating.
- The command users run to update.
