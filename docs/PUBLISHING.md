# Publishing HTML Coursebook

Repository: `gyula-coder/obsidian-html-coursebook`.
Plugin identifier: `html-coursebook`.
Release: `0.1.1`.
License: MIT.

## Local preparation

```sh
npm ci
npm run validate
```

Review `manifest.json`, `LICENSE`, both READMEs and the release notes before publication. Only the plugin source and synthetic demo belong in this repository. Do not upload a personal vault, private courses, local screenshots containing other notes, `.obsidian/`, credentials or `node_modules/`.

The included official Obsidian ESLint configuration checks the code and metadata. Passing these local checks does not mean the community directory has approved the entry.

## GitHub

The public repository must contain the readable source, manifest, README and license. Keep the checked-in `main.js` reproducible with `npm run build`.

Create a public repository at this location, commit and push the source to `main`, then push a tag named exactly `0.1.1`. The tag must match the manifest version, with no `v` prefix.

The release workflow validates the build, then publishes these binary attachments:

- `main.js`
- `manifest.json`
- `styles.css`

A source ZIP or installation ZIP alone is not sufficient for Obsidian's installer. Watch the Actions job and verify that the release and all three files are visible before submitting to the directory.

GitHub authentication is separate from being signed into GitHub in a browser. If no existing Git credential is available, the repository owner must complete the normal GitHub sign-in / authorization flow. Never paste a token into a chat or commit one to this repository.

## Obsidian community directory

The current official process uses the community website:

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with an Obsidian account.
2. Link the GitHub account that owns the repository.
3. Add a plugin using the public GitHub repository URL.
4. Review the automated scanner results and resolve any errors.
5. Publish the listing through the directory once eligible.

The identifier cannot be casually changed after publication, so keep `html-coursebook` stable. Use `versions.json` when later releases change the minimum supported app version.

Official sources:

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Set up and claim](https://docs.obsidian.md/community-directory/set-up-and-claim)

## Subsequent releases

Update `version` in `package.json` and `manifest.json`, add the version to `versions.json`, synchronize the lockfile, and write `docs/releases/<version>.md`. Run validation, commit, then push the exact version tag. The release workflow publishes the installation assets. Community-directory re-submission is not required for normal updates.
