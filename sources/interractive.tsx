import { BaseCommand, WorkspaceRequiredError } from '@yarnpkg/cli';
import {
  Cache,
  Configuration,
  Project,
  HardDependencies,
  formatUtils,
  miscUtils,
  structUtils,
  Descriptor,
  DescriptorHash,
  StreamReport,
  Workspace,
  Ident,
  IdentHash,
} from '@yarnpkg/core';
import type { SubmitInjectedComponent } from '@yarnpkg/libui/sources/misc/renderForm';
import { suggestUtils } from '@yarnpkg/plugin-essentials';
import { Command, Option, Usage, UsageError } from 'clipanion';
import { diffWords } from 'diff';
import path from 'path';
import semver from 'semver';
import { WriteStream } from 'tty';
import * as t from 'typanion';

const SIMPLE_SEMVER =
  /^((?:[\^~]|>=?)?)([0-9]+)(\.[0-9]+)(\.[0-9]+)((?:-\S+)?)$/;

// Helper function to match glob patterns
const matchesGlob = (str: string, pattern: string): boolean => {
  // Escape special regex characters except * and ?
  const escapedPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${escapedPattern}$`);
  return regex.test(str);
};

const matchesLocation = (
  pattern: ExcludedDependency,
  workspace: Workspace,
): boolean => {
  const parsedWorkspace = workspace.anchoredDescriptor.scope
    ? `@${workspace.anchoredDescriptor.scope}/${workspace.anchoredDescriptor.name}`
    : workspace.anchoredDescriptor.name;

  if (pattern.workspace && pattern.workspace === parsedWorkspace) {
    console.log(`Workspace: ${pattern.workspace}, ${parsedWorkspace}}`);
    return true;
  }
  if (pattern.directory && pattern.directory === process.cwd()) {
    console.log(`Directory: ${pattern.directory}, ${process.cwd()}`);
    return true;
  }

  return false;
};

const matchesVersionRange = (
  pattern: ExcludedDependency,
  versionRange: string,
): boolean => {
  if (!pattern.versionRange) return true;

  console.log(`Excluded version range: ${pattern.versionRange}`);
  console.log(`Manifest Version Range: ${versionRange}`);

  const isValid = semver.validRange(pattern.versionRange);
  console.log(isValid);

  const satisfies = semver.satisfies(versionRange, pattern.versionRange);
  console.log(satisfies);
  // If the version range is a valid semver, we can compare it directly
  if (isValid) {
    return satisfies;
  }

  // Otherwise, we assume it's a glob pattern and check if it matches
  return matchesGlob(versionRange, pattern.versionRange);
};

// eslint-disable-next-line @typescript-eslint/comma-dangle -- the trailing comma is required because of parsing ambiguities
const partition = <T,>(array: Array<T>, size: number): Array<Array<T>> => {
  return array.length > 0
    ? [array.slice(0, size)].concat(partition(array.slice(size), size))
    : [];
};

type UpgradeSuggestion = { value: string | null; label: string };
type UpgradeSuggestions = Array<UpgradeSuggestion>;
type ExcludedDependency = {
  workspace: string | null;
  directory: string | null;
  dependencyPattern: string;
  versionRange: string | null;
};

const formatInvalidDependency = (dep: string): string => {
  return `Invalid dependency format: ${dep}. Expected format: [<location>#]<dependencyPattern>[@<version>]`;
};

const parseExcludedItem = (dep: string): ExcludedDependency => {
  const sections = dep.split('#');

  // If we have 1 part, it means only the dependency pattern is specified, no workspace
  if (sections.length === 1) {
    const parsedDep = parseDependency(sections[0]);
    return {
      workspace: null,
      directory: null,
      dependencyPattern: parsedDep.dependencyPattern,
      versionRange: parsedDep.versionRange,
    };
  } else if (sections.length === 2) {
    // If we have 2 sections, it means we have a workspace and a dependency pattern
    const [locationPart, dependencyPart] = sections;
    const parsedDep = parseDependency(dependencyPart);
    const parsedLocation = parsePackageLocation(locationPart);

    return {
      workspace: parsedLocation.workspace || null,
      directory: parsedLocation.directory || null,
      dependencyPattern: parsedDep.dependencyPattern,
      versionRange: parsedDep.versionRange,
    };
  }

  throw new UsageError(formatInvalidDependency(dep));
};

const parseDependency = (
  dep: string,
): Pick<ExcludedDependency, 'dependencyPattern' | 'versionRange'> => {
  const aliasParts = dep.split('@');

  // If no alias is specified, we assume the whole string is the dependency pattern
  if (aliasParts.length === 1) {
    return {
      dependencyPattern: aliasParts[0],
      versionRange: null,
    };
  } else if (aliasParts.length === 2) {
    if (!aliasParts[0]) {
      // If the first part is empty, it means the dependency is specified with a version
      return {
        // Add back the @ to the scoped dependency
        dependencyPattern: `@${aliasParts[1]}`,
        versionRange: null,
      };
    }
    // Otherwise, we assume the first part is the dependency pattern and the second part is the version
    return {
      dependencyPattern: aliasParts[0],
      versionRange: aliasParts[1],
    };
  } else if (aliasParts.length === 3) {
    // If we have 3 parts, it means we have a scoped dependency with a version
    return {
      dependencyPattern: `@${aliasParts[1]}`,
      versionRange: aliasParts[2],
    };
  }
  throw new UsageError(formatInvalidDependency(dep));
};

const parsePackageLocation = (
  location: string,
): Pick<ExcludedDependency, 'workspace' | 'directory'> => {
  const hasAlias = location.indexOf(`@`) >= 0;

  if (hasAlias) {
    // If we have an alias, the location is a workspace
    return {
      workspace: location,
      directory: null,
    };
  }
  // Otherwise, we assume the location is a directory
  return {
    directory: location,
    workspace: null,
  };
};

const formatVersionRange = (dep: ExcludedDependency): ExcludedDependency => {
  if (!dep.versionRange) {
    return dep;
  }

  if (dep.versionRange.startsWith('npm:')) {
    // If the version range starts with "npm:", we assume it's a npm alias
    return {
      ...dep,
      versionRange: dep.versionRange.slice(4), // Remove "npm:" prefix
    };
  }

  return dep;
};

// eslint-disable-next-line arca/no-default-export
export default class UpgradeInteractiveCommand extends BaseCommand {
  static paths = [[`upgrade-interactive-filter`]];

  static usage: Usage = Command.Usage({
    category: `Interactive commands`,
    description: `open the upgrade interface`,
    details: `
      This command opens a fullscreen terminal interface where you can see any out of date packages used by your application, their status compared to the latest versions available on the remote registry, and select packages to upgrade.
    `,
    examples: [
      [
        `Open the upgrade window for all workspaces`,
        `yarn upgrade-interactive-filter`,
      ],
      [
        `Open the upgrade window for specific workspace`,
        `yarn upgrade-interactive-filter @yarnpkg/core`,
      ],
      [
        `Open the upgrade window excluding specific packages`,
        `yarn upgrade-interactive-filter @yarnpkg/core --exclude react,typescript`,
      ],
      [
        `Open the upgrade window excluding packages using glob patterns`,
        `yarn upgrade-interactive-filter --exclude "@types/*,react-*"`,
      ],
    ],
  });

  workspaces = Option.Rest({ required: 0 });

  excludeArg = Option.String(`--exclude`, {
    description: `A comma-separated list of dependencies to exclude from the upgrade (supports glob patterns like "@types/*" or "react-*"). You can specify the workspace and version like so: <workspace>#<package>@<version>`,
    validator: t.isOptional(t.isString()),
  });

  async execute() {
    const { ItemOptions } = await import(
      `@yarnpkg/libui/sources/components/ItemOptions`
    );
    const { Pad } = await import(`@yarnpkg/libui/sources/components/Pad`);
    const { ScrollableItems } = await import(
      `@yarnpkg/libui/sources/components/ScrollableItems`
    );
    const { useMinistore } = await import(
      `@yarnpkg/libui/sources/hooks/useMinistore`
    );
    const { renderForm } = await import(
      `@yarnpkg/libui/sources/misc/renderForm`
    );
    const { Box, Text } = await import(`ink`);
    const {
      default: React,
      useEffect,
      useRef,
      useState,
    } = await import(`react`);

    if (!(this.context.stdout as WriteStream).isTTY)
      throw new UsageError(`This command can only be run in a TTY environment`);

    const configuration = await Configuration.find(
      this.context.cwd,
      this.context.plugins,
    );
    const { project, workspace } = await Project.find(
      configuration,
      this.context.cwd,
    );

    // console.log(workspace);

    const cache = await Cache.find(configuration);

    if (!workspace)
      throw new WorkspaceRequiredError(project.cwd, this.context.cwd);

    let requiredWorkspaces: Set<IdentHash> | null = null;

    // If specific workspaces are provided, filter by them. Otherwise, process all workspaces.
    if (this.workspaces.length > 0) {
      requiredWorkspaces = new Set(
        this.workspaces.map((name) => {
          const ident = structUtils.parseIdent(name);
          project.getWorkspaceByIdent(ident);
          return ident.identHash;
        }),
      );
    }

    // console.log(requiredWorkspaces);

    // Parse excluded dependencies (supports glob patterns)
    const excludeDeps: ExcludedDependency[] = [];
    if (this.excludeArg) {
      const excludedList = this.excludeArg
        .split(',')
        .map((dep) => dep.trim())
        .filter((dep) => dep.length > 0)
        .map(parseExcludedItem)
        .map(formatVersionRange);
      excludeDeps.push(...excludedList);
    }

    console.log(`Excluding dependencies:`, excludeDeps);

    // Helper function to check if a package should be excluded
    const isPackageExcluded = (
      packageName: string,
      workspace: Workspace,
      versionRange: string,
    ): boolean => {
      return excludeDeps.some(
        (pattern) =>
          matchesGlob(packageName, pattern.dependencyPattern) &&
          matchesLocation(pattern, workspace) &&
          matchesVersionRange(pattern, versionRange),
      );
    };

    await project.restoreInstallState({
      restoreResolutions: false,
    });

    // 7 = 1-line command written by the user
    //   + 2-line prompt
    //   + 1 newline
    //   + 1-line header
    //   + 1 newline
    //     [...package list]
    //   + 1 empty line
    const VIEWPORT_SIZE = (this.context.stdout as WriteStream).rows - 7;

    const colorizeRawDiff = (from: string, to: string) => {
      const diff = diffWords(from, to);
      let str = ``;

      for (const part of diff) {
        if (part.added) {
          str += formatUtils.pretty(configuration, part.value, `green`);
        } else if (!part.removed) {
          str += part.value;
        }
      }

      return str;
    };

    const colorizeVersionDiff = (from: string, to: string) => {
      if (from === to) return to;

      const parsedFrom = structUtils.parseRange(from);
      const parsedTo = structUtils.parseRange(to);

      const matchedFrom = parsedFrom.selector.match(SIMPLE_SEMVER);
      const matchedTo = parsedTo.selector.match(SIMPLE_SEMVER);

      if (!matchedFrom || !matchedTo) return colorizeRawDiff(from, to);

      const SEMVER_COLORS = [
        `gray`, // modifier
        `red`, // major
        `yellow`, // minor
        `green`, // patch
        `magenta`, // rc
      ];

      let color: string | null = null;
      let res = ``;

      for (let t = 1; t < SEMVER_COLORS.length; ++t) {
        if (color !== null || matchedFrom[t] !== matchedTo[t]) {
          if (color === null) color = SEMVER_COLORS[t - 1];

          res += formatUtils.pretty(configuration, matchedTo[t], color);
        } else {
          res += matchedTo[t];
        }
      }

      return res;
    };

    const fetchUpdatedDescriptor = async (
      descriptor: Descriptor,
      copyStyle: string,
      range: string,
    ) => {
      const candidate = await suggestUtils.fetchDescriptorFrom(
        descriptor,
        range,
        { project, cache, preserveModifier: copyStyle, workspace },
      );

      if (candidate !== null) {
        return candidate.range;
      } else {
        return descriptor.range;
      }
    };

    const fetchSuggestions = async (
      descriptor: Descriptor,
    ): Promise<UpgradeSuggestions> => {
      const referenceRange = semver.valid(descriptor.range)
        ? `^${descriptor.range}`
        : descriptor.range;

      const [resolution, latest] = await Promise.all([
        fetchUpdatedDescriptor(
          descriptor,
          descriptor.range,
          referenceRange,
        ).catch(() => null),
        fetchUpdatedDescriptor(descriptor, descriptor.range, `latest`).catch(
          () => null,
        ),
      ]);

      const suggestions: Array<{ value: string | null; label: string }> = [
        {
          value: null,
          label: descriptor.range,
        },
      ];

      if (resolution && resolution !== descriptor.range) {
        suggestions.push({
          value: resolution,
          label: colorizeVersionDiff(descriptor.range, resolution),
        });
      } else {
        suggestions.push({ value: null, label: `` });
      }

      if (latest && latest !== resolution && latest !== descriptor.range) {
        suggestions.push({
          value: latest,
          label: colorizeVersionDiff(descriptor.range, latest),
        });
      } else {
        suggestions.push({ value: null, label: `` });
      }

      return suggestions;
    };

    const Prompt = () => {
      return (
        <Box flexDirection={`row`}>
          <Box flexDirection={`column`} width={49}>
            <Box marginLeft={1}>
              <Text>
                Press <Text bold color={`cyanBright`}>{`<up>`}</Text>/
                <Text bold color={`cyanBright`}>{`<down>`}</Text> to select
                packages.
              </Text>
            </Box>
            <Box marginLeft={1}>
              <Text>
                Press <Text bold color={`cyanBright`}>{`<left>`}</Text>/
                <Text bold color={`cyanBright`}>{`<right>`}</Text> to select
                versions.
              </Text>
            </Box>
          </Box>
          <Box flexDirection={`column`}>
            <Box marginLeft={1}>
              <Text>
                Press <Text bold color={`cyanBright`}>{`<enter>`}</Text> to
                install.
              </Text>
            </Box>
            <Box marginLeft={1}>
              <Text>
                Press <Text bold color={`cyanBright`}>{`<ctrl+c>`}</Text> to
                abort.
              </Text>
            </Box>
          </Box>
        </Box>
      );
    };

    const Header = () => {
      return (
        <Box flexDirection={`row`} paddingTop={1} paddingBottom={1}>
          <Box width={50}>
            <Text bold>
              <Text color={`greenBright`}>?</Text> Pick the packages you want to
              upgrade.
            </Text>
          </Box>
          <Box width={17}>
            <Text bold underline color={`gray`}>
              Current
            </Text>
          </Box>
          <Box width={17}>
            <Text bold underline color={`gray`}>
              Range
            </Text>
          </Box>
          <Box width={17}>
            <Text bold underline color={`gray`}>
              Latest
            </Text>
          </Box>
        </Box>
      );
    };

    const UpgradeEntry = ({
      active,
      descriptor,
      suggestions,
    }: {
      active: boolean;
      descriptor: Descriptor;
      suggestions: Array<UpgradeSuggestion>;
    }) => {
      const [action, setAction] = useMinistore<string | null>(
        descriptor.descriptorHash,
        null,
      );

      const packageIdentifier = structUtils.stringifyIdent(descriptor);
      const padLength = Math.max(0, 45 - packageIdentifier.length);
      return (
        <>
          <Box>
            <Box width={45}>
              <Text bold>
                {structUtils.prettyIdent(configuration, descriptor)}
              </Text>
              <Pad active={active} length={padLength} />
            </Box>
            <ItemOptions
              active={active}
              options={suggestions}
              value={action}
              skewer={true}
              onChange={setAction}
              sizes={[17, 17, 17]}
            />
          </Box>
        </>
      );
    };

    const UpgradeEntries = ({
      dependencies,
    }: {
      dependencies: Array<Descriptor>;
    }) => {
      const [suggestions, setSuggestions] = useState<
        Array<{
          descriptor: Descriptor;
          suggestions: UpgradeSuggestions;
        } | null>
      >(dependencies.map(() => null));
      const mountedRef = useRef<boolean>(true);

      const getSuggestionsForDescriptor = async (descriptor: Descriptor) => {
        const suggestions = await fetchSuggestions(descriptor);
        if (
          suggestions.filter((suggestion) => suggestion.label !== ``).length <=
          1
        )
          return null;

        return { descriptor, suggestions };
      };

      useEffect(() => {
        return () => {
          mountedRef.current = false;
        };
      }, []);

      useEffect(() => {
        // Updating the invisible suggestions as they resolve causes continuous lag spikes while scrolling through the list of visible suggestions.
        // Because of that, we update the invisible suggestions in batches of VIEWPORT_SIZE.

        const foregroundDependencyCount = Math.trunc(VIEWPORT_SIZE * 1.75);

        const foregroundDependencies = dependencies.slice(
          0,
          foregroundDependencyCount,
        );
        const backgroundDependencies = dependencies.slice(
          foregroundDependencyCount,
        );

        const backgroundDependencyGroups = partition(
          backgroundDependencies,
          VIEWPORT_SIZE,
        );

        const foregroundLock = foregroundDependencies
          .map(getSuggestionsForDescriptor)
          .reduce(async (lock, currentSuggestionPromise) => {
            await lock;

            const currentSuggestion = await currentSuggestionPromise;
            if (currentSuggestion === null) return;

            if (!mountedRef.current) return;

            setSuggestions((suggestions) => {
              const firstEmptySlot = suggestions.findIndex(
                (suggestion) => suggestion === null,
              );

              const newSuggestions = [...suggestions];
              newSuggestions[firstEmptySlot] = currentSuggestion;

              return newSuggestions;
            });
          }, Promise.resolve());

        backgroundDependencyGroups
          .reduce(
            (lock, group) =>
              Promise.all(
                group.map((descriptor) =>
                  Promise.resolve().then(() =>
                    getSuggestionsForDescriptor(descriptor),
                  ),
                ),
              ).then(async (newSuggestions) => {
                newSuggestions = newSuggestions.filter(
                  (suggestion) => suggestion !== null,
                );

                await lock;
                if (mountedRef.current) {
                  setSuggestions((suggestions) => {
                    const firstEmptySlot = suggestions.findIndex(
                      (suggestion) => suggestion === null,
                    );
                    return suggestions
                      .slice(0, firstEmptySlot)
                      .concat(newSuggestions)
                      .concat(
                        suggestions.slice(
                          firstEmptySlot + newSuggestions.length,
                        ),
                      );
                  });
                }
              }),
            foregroundLock,
          )
          .then(() => {
            // Cleanup all empty slots
            if (mountedRef.current) {
              setSuggestions((suggestions) =>
                suggestions.filter((suggestion) => suggestion !== null),
              );
            }
          });
      }, []);

      if (!suggestions.length) return <Text>No upgrades found</Text>;

      return (
        <ScrollableItems
          radius={VIEWPORT_SIZE >> 1}
          children={suggestions.map((suggestion, index) => {
            // We use the same keys so that we don't lose the selection when a suggestion finishes loading
            return suggestion !== null ? (
              <UpgradeEntry
                key={index}
                active={false}
                descriptor={suggestion.descriptor}
                suggestions={suggestion.suggestions}
              />
            ) : (
              <Text key={index}>Loading...</Text>
            );
          })}
        />
      );
    };

    const GlobalListApp: SubmitInjectedComponent<
      Map<string, string | null>
    > = ({ useSubmit }) => {
      useSubmit(useMinistore());

      const allDependencies = new Map<DescriptorHash, Descriptor>();

      for (const workspace of project.workspaces) {
        if (
          workspace.manifest.name?.identHash &&
          (requiredWorkspaces === null ||
            requiredWorkspaces.has(workspace.manifest.name.identHash))
        ) {
          for (const dependencyType of [
            `dependencies`,
            `devDependencies`,
          ] as Array<HardDependencies>) {
            for (const descriptor of workspace.manifest[
              dependencyType
            ].values()) {
              if (project.tryWorkspaceByDescriptor(descriptor) === null) {
                const packageName = structUtils.stringifyIdent(descriptor);
                // Skip excluded dependencies
                if (
                  !isPackageExcluded(packageName, workspace, descriptor.range)
                ) {
                  allDependencies.set(descriptor.descriptorHash, descriptor);
                }
              }
            }
          }
        }
      }

      const sortedDependencies = miscUtils.sortMap(
        allDependencies.values(),
        (descriptor) => {
          return structUtils.stringifyDescriptor(descriptor);
        },
      );

      return (
        <Box flexDirection={`column`}>
          <Prompt />
          <Header />
          <UpgradeEntries dependencies={sortedDependencies} />
        </Box>
      );
    };

    const updateRequests = await renderForm(
      GlobalListApp,
      {},
      {
        stdin: this.context.stdin,
        stdout: this.context.stdout,
        stderr: this.context.stderr,
      },
    );
    if (typeof updateRequests === `undefined`) return 1;

    let hasChanged = false;

    for (const workspace of project.workspaces) {
      for (const dependencyType of [
        `dependencies`,
        `devDependencies`,
      ] as Array<HardDependencies>) {
        const dependencies = workspace.manifest[dependencyType];

        for (const descriptor of dependencies.values()) {
          const newRange = updateRequests.get(descriptor.descriptorHash);

          if (typeof newRange !== `undefined` && newRange !== null) {
            dependencies.set(
              descriptor.identHash,
              structUtils.makeDescriptor(descriptor, newRange),
            );
            hasChanged = true;
          }
        }
      }
    }

    if (!hasChanged) return 0;

    const installReport = await StreamReport.start(
      {
        configuration,
        stdout: this.context.stdout,
        includeLogs: !this.context.quiet,
      },
      async (report) => {
        await project.install({ cache, report });
      },
    );

    return installReport.exitCode();
  }
}
