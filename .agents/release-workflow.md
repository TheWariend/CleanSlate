# CleanSlate Release Workflow

Use this when the user asks to release CleanSlate.

## How A Release Starts

Releases are driven by the root `VERSION` file. Write the new version into it,
commit, and push to `main`. That is the entire trigger — no tag to create, no
workflow to dispatch.

```sh
echo 1.0.1 > VERSION          # writes the file; `>` overwrites it
git commit -am "CleanSlate Release"
git push origin main
```

`.github/workflows/cleanslate-release.yml` then:

1. Reads `VERSION` and checks the format, that `v<version>` is not already
   tagged, and that it is higher than the latest published release.
2. Builds, signs, and notarizes the macOS app.
3. Generates `cleanslate-update.json`.
4. Publishes assets to `TheWariend/CleanSlate-Releases`.
5. Tags `v<version>` — last, so a failed build strands no tag and the same
   version can be retried by pushing a fix.

## Rules

- `VERSION` holds a bare `MAJOR.MINOR.PATCH`, no leading `v`. Anything else
  fails the run.
- The version must be higher than the latest published release.
- Use `CleanSlate Release` as the commit message.
- Never create the tag yourself. The workflow owns tagging.
- Never edit `cleanslate-update.json`. The workflow generates it.

## Preflight

```sh
git status --short --branch
cat VERSION
gh release list --repo TheWariend/CleanSlate-Releases --limit 5
```

The working tree should be clean unless the user wants the current changes in
the release, and the new version must exceed the latest release above.

## Nothing Happened After Pushing

The workflow only runs when the push changes `VERSION` — that is a `paths`
filter on the trigger, so an ordinary push to `main` creates no run at all. If
you expected a release and got nothing, the commit did not touch `VERSION`.

If the run started and failed early, check the `Resolve version` step: it fails
loudly when the version is malformed, already tagged, or not higher than the
latest release.

## Manual Dispatch

Only when the user asks for it — for example to rebuild a version whose build
failed:

```sh
gh workflow run cleanslate-release.yml -f version=1.0.1 -f target=macos
```

Omitting `version` uses whatever is in `VERSION`. Targets: `macos` (`windows`
and `all` are not yet enabled).

## Confirm

```sh
gh run list --workflow cleanslate-release.yml --limit 3
gh run view <run-id>
```

The run title is always `CleanSlate Release`, set by `run-name:`. The branch
chip shows `main`, because the run is triggered by a push to `main` rather than
by a tag — the tag does not exist until the build succeeds.

## Final Response Checklist

Tell the user:

- The version and the commit hash.
- Whether the workflow is running or completed, and the run id.
- The published release URL once it succeeds.
- Whether the working tree is clean.
