# claude-mods

Claude Code mods by phatjam98. This repository is a plugin marketplace: each mod under `mods/` installs with one line.

## Install

```
/plugin marketplace add phatjam98/claude-mods
/plugin install waypoint@claude-mods
```

The validator's form of the install command also works:

```
/plugin install waypoint --marketplace phatjam98/claude-mods
```

## Mods

| Mod | What it does |
|---|---|
| [waypoint](mods/waypoint/README.md) | Draws the plan the session is working through as a pane, with the PRs/MRs it touches and what each needs (CI, review, conflicts, merge). |

## Develop

### On the machine that has the clone

Use the directory marketplace, not the GitHub one:

```bash
claude plugin marketplace add ~/src/claude-mods
claude plugin install waypoint@claude-mods --scope user
```

After editing a mod, run `/reload-plugins` in the session. Marketplaces are keyed by name, so never also add the GitHub source (`phatjam98/claude-mods`) on the same machine.

### On other machines

```
/plugin marketplace add phatjam98/claude-mods
/plugin install waypoint@claude-mods
```

Later: `claude plugin update waypoint@claude-mods`.

### Commands

```bash
claude plugin validate --strict .                    # marketplace
claude plugin validate --strict mods/<name>          # one mod
claude plugin test mods/<name>                       # runs every *.test.ts under the mod
npx -p typescript tsc -p mods/<name>                 # after the first interactive load
```

The type-check needs `mods/<name>/.claude-plugin/types/`, which the engine writes the first time the mod is loaded in an interactive session. It is gitignored.

## Privacy

Each mod lists what it reads, observes and runs in its own "What it can reach" section. Read that before installing.

## License

MIT. See [LICENSE](LICENSE).
