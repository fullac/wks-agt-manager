# 管理本机 Paseo 登记，按预览范围在后台退出后提交，保留文件和原生会话。
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
import re
import select
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

WORKSPACES = Path("projects/workspaces.json")
AREA = Path("plugin-data/subagent-groups/management")
UUID = re.compile(r"[0-9a-fA-F-]{36}\Z")


def read(path):
    return json.loads(path.read_bytes())


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def atomic(path, data, mode=None):
    if data is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            if mode is not None:
                os.fchmod(fd, mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def records(home):
    folder = home / "agents"
    for p in sorted([*folder.glob("*.json"), *folder.glob("*/*.json")]):
        value = read(p)
        if not isinstance(value, dict) or not value.get("id") or not value.get("provider"):
            continue
        yield p.relative_to(home), value


def catalog(home, wid):
    workspaces = read(home / WORKSPACES)
    w = next((w for w in workspaces if w["workspaceId"] == wid and not w.get("archivedAt")), None)
    if w is None:
        raise ValueError("工作区已移除或归档")
    projects = [{"id": p["projectId"], "name": p.get("customName") or p["displayName"]}
                for p in read(home / "projects/projects.json") if not p.get("archivedAt")]
    agents = {a["id"]: {"id": a["id"], "name": a.get("title") or a["id"], "provider": a["provider"]}
              for _, a in records(home) if a.get("workspaceId") == wid}
    return {"workspace": w.get("title") or w["displayName"], "project": w["projectId"],
            "projects": projects, "agents": list(agents.values())}


def native_file(a):
    p = a.get("persistence") or {}
    sid = p.get("sessionId") or ""
    if not UUID.fullmatch(sid):
        raise ValueError(f"{a['id']} 缺少可核实的原生会话 ID")
    base = Path.home()
    if a["provider"] == "codex":
        root = Path(os.environ.get("CODEX_HOME", base / ".codex"))
        files = [path for folder in ("sessions", "archived_sessions") for path in
                 (root / folder).rglob(f"*-{sid}.jsonl")]
    elif a["provider"] == "claude":
        root = Path(os.environ.get("CLAUDE_CONFIG_DIR", base / ".claude")) / "projects"
        files = list(root.glob(f"*/{sid}.jsonl"))
    elif a["provider"] == "pi":
        handle = Path(p.get("nativeHandle") or "")
        files = [handle] if handle.is_absolute() and handle.name.endswith(f"{sid}.jsonl") else []
    elif a["provider"] == "grok":
        files = list((base / ".grok/sessions").glob(f"*/{sid}/chat_history.jsonl"))
    else:
        files = []
    if not any(f.is_file() and f.stat().st_size for f in files):
        raise ValueError(f"{a.get('title') or a['id']} 的 {a['provider']} 原生历史无法核实，未释放")
    return sid


def plan(home, cmd):
    wid, action = cmd["workspace"], cmd["action"]
    summary = catalog(home, wid)
    ws = read(home / WORKSPACES)
    w = next(w for w in ws if w["workspaceId"] == wid)
    changes, released, details = {}, [], []
    if action == "move":
        target = cmd["target"]
        if target == w["projectId"] or not any(p["id"] == target for p in summary["projects"]):
            raise ValueError("请选择另一个有效项目")
        w["projectId"] = target
        changes[WORKSPACES] = encoded(ws)
        details.append("只改该工作区的 projectId，保留工作目录、分支和全部 Agent。")
    elif action in ("release", "remove"):
        entries = list(records(home))
        selected = {a["id"] for _, a in entries if a.get("workspaceId") == wid
                    and (action == "remove" or a["id"] == cmd["target"])}
        if action == "release" and not selected:
            raise ValueError("该 Agent 已移动或移除")
        host = (home / "server-id").read_text().strip()
        for schedule in (home / "schedules").glob("*.json"):
            record = read(schedule)
            target = record.get("target") or {}
            if target.get("agentId") in selected:
                raise ValueError(f"计划 {record.get('name') or schedule.stem} 仍绑定该 Agent，请先解除计划绑定")
        for path, a in entries:
            if a["id"] in selected:
                if a.get("workspaceId") != wid:
                    raise ValueError("同一个 Agent 有冲突的工作区记录")
                sid = native_file(a)
                released.append(dict(id=a["id"], provider=a["provider"], session=sid, handle=a["persistence"].get("nativeHandle") or sid, title=a.get("title") or a["id"]))
                changes[path] = None
                usage = path.with_suffix(".usage.json")
                if (home / usage).is_file():
                    changes[usage] = None
            else:
                labels = a.get("labels") or {}
                if labels.get("paseo.parent-agent-id") in selected and labels.get("paseo.parent-server-id", host) == host:
                    labels.pop("paseo.parent-agent-id")
                    labels.pop("paseo.parent-server-id", None)
                    changes[path] = encoded(a)
                    details.append(f"保留子 Agent {a['id']}，解除已移除的父级。")
        if action == "remove":
            ws.remove(w)
            for child in ws:
                if child.get("parentWorkspaceId") == wid:
                    child.pop("parentWorkspaceId")
                    details.append(f"保留子工作区 {child['workspaceId']}，解除已移除的父级。")
            changes[WORKSPACES] = encoded(ws)
        for folder in ("agent-requests", "creations"):
            for f in sorted((home / folder).glob("*.json")):
                v = read(f)
                s = v.get("snapshot", v)
                if s.get("agentId") in selected or (action == "remove" and s.get("workspaceId") == wid):
                    changes[f.relative_to(home)] = None
        owners = [("agent", aid) for aid in selected]
        if action == "remove":
            owners.append(("workspace", wid))
        for kind, ident in owners:
            key = digest(json.dumps([kind, ident], separators=(",", ":")).encode())
            claim = Path("creations") / (key + ".claim")
            if (home / claim).exists():
                changes[claim] = None
        subs = Path("finish-subscriptions.json")
        if (home / subs).exists():
            old = read(home / subs)
            new = [s for s in old if s["callerAgentId"] not in selected and not
                   (s["childAgentId"] in selected and s.get("serverId", host) == host)]
            if new != old:
                changes[subs] = encoded(new)
        details.append("保留工作树、项目文件及原生会话；移除所列 Paseo 登记与关联回执。")
    else:
        raise ValueError("未知操作")
    for path in changes:
        if (home / path).resolve() != home / path:
            raise ValueError("登记路径经过符号链接，已取消写入")
    preview = {"workspace": summary["workspace"], "oldProject": summary["project"], "request": cmd,
               "files": sorted(map(str, changes)), "released": released, "details": details}
    # 只绑定授权的目标与影响范围；后台关闭时会正常刷新 Agent 的运行快照。
    preview["token"] = digest(encoded(preview))
    return preview, changes


@contextlib.contextmanager
def offline(home):
    # 使用与该版本后台相同的 O_EXCL PID 文件；后台运行或正在启动时不会写登记。
    p = home / "paseo.pid"
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(dict(pid=os.getpid(), startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                           hostname=socket.gethostname(), uid=os.getuid(), listen=None), f)
        yield
    finally:
        p.unlink(missing_ok=True)


def execute(home, job, request):
    preview, changes = plan(home, request["cmd"])
    if preview["token"] != request["token"]:
        raise ValueError("工作区或受影响的记录已变化，请重新预览")
    backup = job / "before"
    order = sorted(changes, key=lambda p: (p == WORKSPACES, str(p)))
    manifest = []
    for path in order:
        before = (home / path).read_bytes()
        atomic(backup / path, before)
        after = changes[path]
        manifest.append(dict(path=str(path), mode=stat.S_IMODE((home / path).stat().st_mode),
                             before=digest(before), after=digest(after) if after is not None else None))
    atomic(job / "manifest.json", encoded(manifest))
    atomic(job / "status.json", encoded({"state": "applying"}))
    try:
        for entry in manifest:
            path = Path(entry["path"])
            atomic(home / path, changes[path], entry["mode"])
        for path in order:
            actual = (home / path).read_bytes() if (home / path).exists() else None
            if actual != changes[path]:
                raise ValueError("登记写入校验失败")
        atomic(job / "status.json", encoded({"state": "done"}))
    except BaseException:
        recover(home, job)
        raise


def recover(home, job):
    manifest = read(job / "manifest.json")
    for entry in manifest:
        path = home / entry["path"]
        current = digest(path.read_bytes()) if path.exists() else None
        if current not in (entry["before"], entry["after"]):
            raise ValueError("登记在中断后有新改动，已保留备份并停止自动恢复")
    for entry in reversed(manifest):
        path = Path(entry["path"])
        before = (job / "before" / path).read_bytes()
        if digest(before) != entry["before"]:
            raise ValueError("备份校验失败")
        atomic(home / path, before, entry["mode"])
    atomic(job / "status.json", encoded({"state": "error", "error": "中断的操作已回滚，请重新预览"}))


def pending_jobs(root):
    return sorted(root.glob("*/request.json"))


def work(home):
    root = home / AREA
    # 一个后台退出可能同时唤醒多个插件实例。
    with (root / "worker.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        while True:
            with (root / "queue.lock").open("a") as admission:
                fcntl.flock(admission, fcntl.LOCK_EX)
                jobs = [p.parent for p in pending_jobs(root)
                        if read(p.parent / "status.json")["state"] in ("queued", "applying")]
                if not jobs:
                    fcntl.flock(lock, fcntl.LOCK_UN)
                    return
            try:
                with offline(home):
                    for job in jobs:
                        with job_lock(job):
                            state = read(job / "status.json")["state"]
                            try:
                                if state == "applying":
                                    recover(home, job)
                                elif state == "queued":
                                    execute(home, job, read(job / "request.json"))
                            except Exception as exc:
                                atomic(job / "status.json", encoded({"state": "error", "error": str(exc)}))
            except FileExistsError:
                wait_for_shutdown(home / "paseo.pid")


def wait_for_shutdown(pid_file):
    # macOS 在文件被移除时立即唤醒；无需循环读取登记或影响运行中的进程。
    if not hasattr(select, "kqueue"):
        time.sleep(1)
        return
    try:
        with pid_file.open() as fd, contextlib.closing(select.kqueue()) as queue:
            event = select.kevent(fd.fileno(), filter=select.KQ_FILTER_VNODE,
                                  flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                                  fflags=select.KQ_NOTE_DELETE | select.KQ_NOTE_RENAME)
            queue.control([event], 0, 0)
            if pid_file.exists():
                queue.control([], 1, 8)
    except FileNotFoundError:
        pass


@contextlib.contextmanager
def job_lock(job):
    with (job / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def wake(home):
    with (home / AREA / "worker.log").open("ab") as log:
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "worker", str(home)],
                         start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=log, close_fds=True)


def request(home, data):
    if data["host"] != (home / "server-id").read_text().strip():
        raise ValueError("菜单与后台主机不一致")
    wid = data["workspace"]
    root = home / AREA
    if data["op"] in ("history", "import-info"):
        jobs, sessions = [], {}
        for path in pending_jobs(root):
            req, status = read(path), read(path.parent / "status.json")
            jobs.append(dict(id=path.parent.name, workspace=req["cmd"]["workspace"],
                             name=req["preview"]["workspace"], action=req["cmd"]["action"], **status))
            if status["state"] == "done":
                for a in req["preview"]["released"]:
                    sessions[a["id"]] = a
        bound = {(a["provider"], (a.get("persistence") or {}).get("sessionId")): a for _, a in records(home)}
        available = [a for a in sessions.values() if (a["provider"], a["session"]) not in bound]
        if data["op"] == "history":
            return {"jobs": jobs, "released": available}
        w = next((w for w in read(home / WORKSPACES) if w["workspaceId"] == wid and not w.get("archivedAt")), None)
        session = sessions.get(data["target"])
        if not w or not session or not Path(w["cwd"]).is_dir():
            raise ValueError("目标工作区或待导入的会话不可用")
        existing = bound.get((session["provider"], session["session"]))
        if existing:
            if existing.get("workspaceId") == wid and not existing.get("archivedAt"):
                return {"existing": existing["id"]}
            raise ValueError("该原生会话已有其他 Paseo 登记，请刷新操作记录")
        handle = session.get("handle", session["session"])
        return {"provider": session["provider"], "sessionId": handle, "workspaceId": wid, "cwd": w["cwd"]}
    if data["op"] == "catalog":
        return catalog(home, wid)
    if data["op"] == "cancel":
        job = root / str(uuid.UUID(data["target"]))
        with job_lock(job):
            if read(job / "request.json")["cmd"]["workspace"] != wid or read(job / "status.json")["state"] != "queued":
                raise ValueError("任务已处理")
            atomic(job / "status.json", encoded({"state": "cancelled"}))
        return {"ok": True}
    cmd = {k: data[k] for k in ("workspace", "action", "target")}
    preview, _ = plan(home, cmd)
    if data["op"] == "preview":
        return {**preview, "files": [f.replace("Users-" + Path.home().name + "-", "Home-") for f in preview["files"]]}
    if data["op"] != "submit" or data.get("token") != preview["token"]:
        raise ValueError("预览已过期，请重新选择")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / "queue.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for p in pending_jobs(root):
            prev = read(p)
            if prev["cmd"]["workspace"] == wid and read(p.parent / "status.json")["state"] in ("queued", "applying"):
                if prev["token"] == preview["token"]:
                    wake(home)
                    return {"id": p.parent.name}
                raise ValueError("该工作区已有待处理操作，请先取消")
        job = root / str(uuid.uuid4())
        job.mkdir(mode=0o700)
        atomic(job / "status.json", encoded({"state": "queued"}))
        atomic(job / "request.json", encoded(dict(cmd=cmd, token=preview["token"], preview=preview)))
        wake(home)
        return {"id": job.name}


if __name__ == "__main__":
    try:
        os.umask(0o077)
        mode, location = sys.argv[1:3]
        home = Path(location).resolve()
        if mode == "worker":
            work(home)
        elif mode == "resume":
            if pending_jobs(home / AREA):
                wake(home)
        else:
            print(json.dumps(request(home, json.load(sys.stdin)), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
