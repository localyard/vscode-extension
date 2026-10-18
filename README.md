# Localyard for VS Code

Run your [Localyard](https://github.com/localyard/localyard) sites from VS Code: start and stop projects, watch their processes and services, follow logs, and open terminals that already have the project's PHP, Node and environment variables.

## Getting started

1. Install this extension.
2. **Install the `yard` command when asked.** The extension does everything through Localyard's `yard` command line tool. If `yard` isn't on your machine, a prompt offers to install it:
   - **macOS and Linux:** click **Install yard**. It runs the official installer, which puts `yard` in `~/.localyard/bin`.
   - **Windows:** click **Download Localyard** and install the Localyard app. Then open **Settings → yard command → Install yard command** in the app.

   If you closed the prompt, run **Localyard: Install the yard Command** from the Command Palette, or click **Localyard** in the status bar.
3. Open a project folder. If it has no `yard.toml` yet, run **Localyard: Create yard.toml**. Then click **Start** in the Localyard sidebar.

Already use the Localyard app? It includes `yard`. Once you've turned on **Install yard command** in its settings, the extension finds it on its own.

## Features

- **Sidebar:** every project with its processes, and every service (MySQL, PostgreSQL, Redis, MongoDB, Mailpit and more), each with its live status. Start, stop, restart, open and install from the buttons next to each item.
- **Live status, no polling:** status changes the moment a process starts, crashes or restarts, including changes made from the app or a terminal.
- **Status bar:** the open folder's site and whether it's running. Click it for the project's actions.
- **Logs:** each process's output in its own Output panel, followed live. The site's access log is there too.
- **Terminals with the project's environment:** new terminals get the project's runtimes on `PATH` and the variables from `yard.toml`, the same as `yard shell`.
- **Commands** for start, stop, restart, setup hooks, share publicly, switching PHP or Node version, and `yard doctor`.
- **`yard.toml` completion and checks** with the [Even Better TOML](https://marketplace.visualstudio.com/items?itemName=tamasfe.even-better-toml) extension installed.

## Commands

| Command | What it does |
| --- | --- |
| Localyard: Start Project | `yard up`: installs what's missing, starts services and processes, serves the site |
| Localyard: Stop Project | `yard down` |
| Localyard: Restart Project | `yard restart` |
| Localyard: Run Setup Hooks | `yard setup` |
| Localyard: Open Site | Opens `https://<name>.test` in your browser |
| Localyard: Share Site Publicly | `yard share` in a terminal, until you close it |
| Localyard: Show Logs | Follows a process's log, or the site's access log |
| Localyard: Switch PHP Version / Switch Node Version | `yard use php 8.4`, `yard use node 22` |
| Localyard: Create yard.toml | `yard init`: detects the stack and writes `yard.toml` |
| Localyard: Run Doctor | `yard doctor`: checks DNS, HTTPS, the web server, ports and PATH |
| Localyard: Install the yard Command | Installs `yard` if it's missing |

## Settings

| Setting | Default | |
| --- | --- | --- |
| `localyard.yardPath` | empty | Full path to `yard`. When empty, the extension looks on your `PATH` and in `~/.localyard/bin`. |
| `localyard.terminalEnvironment` | `true` | Give new terminals the project's runtimes and environment. |
| `localyard.statusBar` | `true` | Show the project in the status bar. |

## Requirements

- macOS, Linux or Windows, with Localyard's `yard` command (the extension offers to install it).
- Live status needs `yard events`, which arrived in Localyard 0.1.2. With an older version, status updates after each action and when you click Refresh.

## Workspace trust

In a folder you haven't trusted, the extension shows status but won't start the project, run its setup hooks or load its environment into terminals. Those run commands from the folder's `yard.toml`.

## Feedback

Report problems and ideas at [github.com/localyard/localyard/issues](https://github.com/localyard/localyard/issues).
