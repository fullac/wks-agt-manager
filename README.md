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

Right-click a workspace and choose **移动到项目** to preview a move, or **wks-agt-manager** to release a workspace or agent.

## How the plugin changes Paseo data

Paseo Desktop 0.17.3 exposes an API for importing a native session. Its plugin API has no equivalent operation for moving an existing workspace to another project or releasing an agent so its session can be imported elsewhere. Archiving keeps the registration. To support moves and removals, the plugin edits Paseo’s local registration files directly. The paths below assume the default data directory, `~/.paseo/`.

| Operation | What changes |
| --- | --- |
| Move a workspace | Updates the selected workspace’s `projectId` in `projects/workspaces.json`. Its ID, working directory, Git branch and agent registrations stay intact. |
| Remove an agent or workspace | Removes the selected registrations and cleans up related Paseo records and parent references. Removing a workspace also releases its registered agents, including archived ones. The preview lists the affected files and agents. Project files, Git worktrees and verified native session histories are preserved. |
| Reimport a released agent | Calls Paseo’s import API immediately after confirmation. Paseo creates an agent registration in the destination workspace using the existing native session. |

**Why wait for the daemon to stop?** The daemon (Paseo’s background process) caches registrations in memory. Editing the files while it is running risks having it write the old values back. Opening the menu or viewing a preview only reads registrations. Confirming a move or removal queues the request and starts an independent worker. Once the daemon stops, the worker acquires an exclusive lock, rechecks the preview, backs up the affected files, applies the edits and verifies them. Paseo reads the updated registrations on its next start.

The plugin checks for Paseo Desktop 0.17.3 before enabling registration management because these operations depend on that version’s file format. Requests, results and backups are stored under `~/.paseo/plugin-data/subagent-groups/management/<operation-id>/`. The directory uses the original plugin ID so existing installations retain their history.

<details>
<summary>中文说明：插件为何直接修改 Paseo 文件</summary>

Paseo Desktop 0.17.3 提供了原生会话导入接口，但插件接口没有提供「把已有工作区移动到另一个项目」或「解除 Agent 登记，让同一会话可以重新导入」的操作。归档后，原登记仍然存在。因此，插件通过直接修改本机 Paseo 登记文件来完成移动和移除。

- **移动工作区**只改 `projects/workspaces.json` 中该工作区的 `projectId`。工作区 ID、磁盘目录、Git 分支和 Agent 登记沿用原值。
- **移除 Agent 或工作区**会删除所选登记并清理关联记录。移除整个工作区也会释放其中已归档的 Agent。预览会列出涉及的文件和 Agent。项目文件、Git 工作树和已核验的原生会话历史都会保留。
- **重新导入 Agent**在确认后立即调用 Paseo 的原生导入接口，为原会话在目标工作区创建新的登记。

Paseo 后台会缓存登记，运行时直接改文件，旧值可能被写回。打开菜单和查看预览都只读登记。确认移动或移除后，插件把任务写入队列并启动独立进程。等后台停止后，该进程取得独占锁，重新核对预览、备份原文件、写入并校验。下次启动 Paseo 时，新登记生效。

插件会检查版本，因为上述写入依赖 macOS 上 Paseo Desktop 0.17.3 的文件格式。每次操作的请求、结果和备份默认保存在 `~/.paseo/plugin-data/subagent-groups/management/<操作编号>/`。

</details>
