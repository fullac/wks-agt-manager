# wks-agt-manager

A Paseo Desktop plugin for moving workspaces between projects, releasing agents for reimport, and distinguishing Paseo subagents from provider-native subagents.

## Install locally

Workspace and agent registration management supports Paseo Desktop 0.17.3 on macOS and requires Python 3. With plugins enabled, run these commands inside a local clone of this repository:

```sh
npm install --legacy-peer-deps
npm run typecheck
npm test
paseo plugin install "$PWD"
```

Right-click a workspace to preview a move or open **wks-agt-manager** to release a workspace or agent.

## How it works

Paseo 0.17.3 has no plugin API for moving workspaces or releasing agents, so the plugin edits local registration files directly. A move updates the workspace's `projectId` in `~/.paseo/projects/workspaces.json`. A removal clears the selected registrations and related references while preserving project files and native session history. Reimport uses Paseo's native API.

Paseo caches registrations in memory. After you confirm a move or removal, a worker waits for the daemon to stop, backs up the affected files, then applies and verifies the changes. Backups are stored under `~/.paseo/plugin-data/subagent-groups/management/<operation-id>/`.
