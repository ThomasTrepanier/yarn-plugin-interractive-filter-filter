# `@yarnpkg/plugin-interractive-filter`

This plugin adds support for upgrade interactive with filter by workspace.

It's a fork of [plugin-interactive-tools](https://github.com/yarnpkg/berry/tree/master/packages/plugin-interactive-tools)

## Install

```
yarn plugin import https://raw.githubusercontent.com/eyolas/yarn-plugin-interractive-filter/master/bundles/%40yarnpkg/plugin-interractive-filter.js
```

## Commands

- yarn upgrade-interactive-filter <workspaces>
  - `--exclude`: A comma-separated list of dependencies to exclude from the upgrade (supports glob patterns like "@types/_" or "react-_")

### Examples

```bash
# Exclude specific packages by name
yarn upgrade-interactive-filter myworkspace --exclude react,typescript,lodash

# Exclude all TypeScript type definitions
yarn upgrade-interactive-filter myworkspace --exclude "@types/*"

# Exclude all React-related packages
yarn upgrade-interactive-filter myworkspace --exclude "react-*"

# Combine exact names and glob patterns
yarn upgrade-interactive-filter myworkspace --exclude "lodash,@types/*,react-*"
```
