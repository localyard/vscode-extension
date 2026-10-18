# Publishing

Pushing a `v*` tag runs [.github/workflows/release.yml](.github/workflows/release.yml). It packages the extension, publishes it to the VS Code Marketplace and attaches the `.vsix` to a GitHub release.

## One-time setup

1. **Publisher.** Sign in at https://marketplace.visualstudio.com/manage with a Microsoft account and create a publisher with the ID `localyard`. That ID must match `"publisher"` in [package.json](package.json). If `localyard` is taken, use the ID you got and update package.json.
2. **Token.** In Azure DevOps (https://dev.azure.com, the same Microsoft account), open **User settings → Personal access tokens → New token**:
   - Organization: **All accessible organizations**. Publishing fails with a 401 otherwise.
   - Scopes: **Custom defined → Marketplace → Manage**
   - Expiry: up to one year. Set a reminder; when it expires, releases fail at the publish step.
3. **Secret.** Add the token to this repo as an Actions secret named `VSCE_PAT` (**Settings → Secrets and variables → Actions**).

## Releasing

1. Bump `"version"` in [package.json](package.json) and add a section to [CHANGELOG.md](CHANGELOG.md).
2. Commit, then tag and push:

   ```sh
   git tag v0.1.0
   git push origin main v0.1.0
   ```

3. Follow the run in the Actions tab. The Marketplace listing updates a few minutes after it finishes.

The tag must match the package.json version, or the workflow stops before publishing.

## Trying a build locally

```sh
npm ci
npm run package          # writes localyard-<version>.vsix
code --install-extension localyard-<version>.vsix
```

Or press F5 in VS Code to run it in an Extension Development Host.

## Compatibility with yard

The extension reads `yard events`, `yard ps --all --json`, `yard services --json` and `yard env --json`. When those change shape in the main repo, update [src/yard.ts](src/yard.ts) and release both together.
