# `@yarnpkg/plugin-interractive-filter`

This plugin adds support for upgrade interactive with filter by workspace and exclude packages.

It's a fork of [plugin-interactive-tools](https://github.com/yarnpkg/berry/tree/master/packages/plugin-interactive-tools)

## Install

```
yarn plugin import https://raw.githubusercontent.com/eyolas/yarn-plugin-interractive-filter/master/bundles/%40yarnpkg/plugin-interractive-filter.js
```

## Commands

- yarn upgrade-interactive-filter <workspaces>
  - `--exclude`: A comma-separated list of dependencies to exclude from the upgrade

## Features

### Run `upgrade-interactive` in specific workspace

```bash
# Run `upgrade-interactive` in a specific workspace
yarn upgrade-interactive-filter <workspace>
```

### Exclude packages

The package exclusion has 3 components:

1- **workspace/directory** of the package (workspaces must start with @, and directories cannot)

```shell
# Workspace
@mx/changelogs

# Directory
maintainx/backend
```

2- **Name** of the package (supports glob matching)

3- **Current version** of the package to exclude

```shell
# This will exclude from the list react packages whose current version matches the ^18.0.0 semver
yarn upgrade-interactive-filter --exclude react@npm:^18.0.0
```

#### Examples

```bash

# Exclude packages from the list in every workspace
yarn upgrade-interactive-filter --exclude react, typescript, @types/*

# Exclude package install at specific version
yarn upgrade-interactive-filter --exclude react@npm:^19.0.0

# Run `upgrade-interactive` in a specific workspace and exclude some packages
yarn upgrade-interactive-filter <workspace> --exclude react,typescript,lodash

#Run `upgrade-interactive` in every workspace, but exclude package from specific workspace at specific version
yarn upgrade-interactive-filter --exclude <location>#<package>@<version>

e.g.
yarn upgrade-interactive-filter --exclude @mx/changelogs#react@npm:^19.0.0
yarn upgrade-interactive-filter --exclude maintainx/backend#vitest@npm:^3.1.1
```
