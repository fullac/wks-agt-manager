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

### Upgrading from `subagent-groups`

Let any queued operations finish or cancel them in the old plugin settings. Disable the old plugin with `paseo plugin disable subagent-groups`, then install this checkout using the commands above. Open **Settings → Plugins → wks-agt-manager** and verify your operation history before running `paseo plugin remove subagent-groups`. The plugin moves existing requests, results, and backups to its new data directory. If both history directories already exist, it reports a conflict and leaves both in place.

## Usage

| Action | Where to find it |
| --- | --- |
| Move a workspace | Right-click the workspace in the sidebar, choose **Move to project**, then select the destination. |
| Remove a workspace and release its agents | Right-click the workspace and choose **Remove workspace** above **Archive**. Expand the preview to see which agents and registration files it affects. |
| Release one agent | Right-click its tab and choose **Remove agent** above **Close**. Hover over the action for a description. |

Review the preview and confirm to queue a move or removal. In **Settings → Plugins → wks-agt-manager**, expand a history entry to see its local directory or cancel a queued operation. To reimport a released session, select the session and the destination workspace, then confirm the import.

## How it works

Paseo 0.17.3 has no plugin API for moving workspaces or releasing agents, so the plugin edits local registration files directly. A move updates the workspace's `projectId` in `~/.paseo/projects/workspaces.json`. A removal clears the selected registrations and related references while preserving project files and native session history. Reimport uses Paseo's native API.

Paseo caches registrations in memory. After you confirm a move or removal, a worker waits for the daemon to stop, backs up the affected files, then applies and verifies the changes. Backups are stored under `~/.paseo/plugin-data/wks-agt-manager/management/<operation-id>/`.
