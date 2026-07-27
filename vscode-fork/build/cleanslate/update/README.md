# CleanSlate updater

CleanSlate uses the built-in VS Code/Electron update state machine. The product points at:

```text
https://thewariend.com/api/update/:platform/:quality/:commit
```

The endpoint must return:

- `204 No Content` when the client commit is already current.
- macOS JSON for Squirrel.Mac: `{ "url", "name", "notes", "pub_date" }`.
- Windows JSON for the VS Code updater: `{ "url", "version", "productVersion", "timestamp", "sha256hash" }`.

`server.mjs` is a small GitHub Releases-backed implementation of that contract. Deploy it behind the website API route, or adapt its exported `handleCleanSlateUpdateRequest()` function in the website backend.

Release flow:

1. GitHub Actions builds the macOS zip/DMG and Windows installer/archive.
2. `create-update-manifest.mjs` writes `cleanslate-update.json` with the latest commit, version, asset names, and SHA-256 hashes.
3. The release job uploads all assets plus `cleanslate-update.json` to the public `TheWariend/CleanSlate-Releases` GitHub release.
4. The update endpoint reads that public release and serves the correct update response for the requesting platform.

Website API environment:

- `CLEANSLATE_GITHUB_REPOSITORY`, defaults to `TheWariend/CleanSlate-Releases`.
- `CLEANSLATE_UPDATE_MANIFEST_NAME`, optional, defaults to `cleanslate-update.json`.
