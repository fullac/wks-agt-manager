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

Right-click a workspace and choose **移动到项目** to preview a move, or **wks-agt-manager** to release a workspace or agent. Confirmed registration changes are queued until the local Paseo daemon stops. The runtime ID is `subagent-groups` so existing installations retain their operation history.

See [the plugin overview](OVERVIEW.md) for the exact files affected, backup location, and reimport behavior.
