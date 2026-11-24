# 用独立登记、原生会话和 Git 工作树验证改动范围、冲突校验与回滚。
import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
import registry as r


class RegistryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name).resolve()
        self.home = base / "paseo"
        self.cwd = base / "worktree"
        source = base / "repo"
        subprocess.run(["git", "init", "-q", str(source)], check=True)
        cmd = ["git", "-C", str(source), "-c", "user.name=test", "-c", "user.email=test@example.invalid"]
        subprocess.run([*cmd, "commit", "-qm", "fixture", "--allow-empty"], check=True)
        subprocess.run([*cmd, "worktree", "add", "-q", "--detach", str(self.cwd)], check=True)
        self.file = self.cwd / "untracked.txt"
        self.file.write_text("retain")
        self.write("server-id", b"self")
        self.write("projects/projects.json", [{"projectId": x, "displayName": x} for x in ("old", "new")])
        workspace = dict(workspaceId="wks_1", projectId="old", displayName="source",
                         isPaseoOwnedWorktree=True, cwd=str(self.cwd))
        self.write(r.WORKSPACES, [workspace, {**workspace, "workspaceId":"wks_2", "parentWorkspaceId":"wks_1"}])
        self.id = str(uuid.uuid4())
        sid = str(uuid.uuid4())
        self.native = base / (sid + ".jsonl")
        self.native.write_text(json.dumps({"type": "session", "id": sid}) + "\n")
        self.a = dict(id=self.id, workspaceId="wks_1", provider="pi",
                      persistence=dict(provider="pi",sessionId=sid,nativeHandle=str(self.native)))
        self.agent = Path("agents") / (self.id + ".json")
        self.write(self.agent, self.a)
        self.write("finish-subscriptions.json", [
            dict(id="a",callerAgentId=self.id,childAgentId="elsewhere",serverId="remote"),
            dict(id="b",callerAgentId="else",childAgentId=self.id,serverId="remote")])
        self.write("agent-requests/mine.json",dict(agentId=self.id))
        self.write("agent-requests/other.json",dict(agentId="else"))
        self.before = self.snapshot()

    def test_settings_history_without_workspace(self):
        rows = r.read(self.home / r.WORKSPACES)
        self.write(r.WORKSPACES, [rows[0], {**rows[1], "archivedAt": "archived"}])
        before = self.snapshot()
        history = r.request(self.home, {"op": "history", "host": "self"})
        self.assertEqual(history["destinations"], [{"id": "wks_1", "name": "old / source"}])
        self.assertEqual(history["jobs"], [])
        self.assertEqual(before, self.snapshot())
        self.write(r.WORKSPACES, [])
        self.assertEqual(r.request(self.home, {"op": "history", "host": "self"})["destinations"], [])

    def write(self, name, value):
        r.atomic(self.home / name, value if isinstance(value, bytes) else r.encoded(value))

    def snapshot(self):
        return {p.relative_to(self.home):p.read_bytes() for p in self.home.rglob("*")
                if p.is_file() and r.AREA not in p.relative_to(self.home).parents}

    def prepare(self, action, target=""):
        cmd = dict(workspace="wks_1",action=action,target=target)
        preview, _ = r.plan(self.home, cmd)
        job = self.home / r.AREA / str(uuid.uuid4())
        job.mkdir(parents=True)
        return job, dict(cmd=cmd,token=preview["token"])

    def test_move_changes_one_field(self):
        job, q = self.prepare("move", "new")
        r.execute(self.home,job,q)
        after = self.snapshot()
        ws = json.loads(after[r.WORKSPACES])
        self.assertEqual(ws[0]["projectId"], "new")
        ws[0]["projectId"] = "old"
        after[r.WORKSPACES] = r.encoded(ws)
        self.assertEqual(after,self.before)

    def test_release_matches_local_parent_or_child(self):
        job, q = self.prepare("release",self.id)
        r.execute(self.home,job,q)
        after = self.snapshot()
        self.assertEqual(after[r.WORKSPACES], self.before[r.WORKSPACES])
        self.assertNotIn(self.agent, after)
        self.assertNotIn(Path("agent-requests/mine.json"), after)
        self.assertIn(Path("agent-requests/other.json"), after)
        self.assertEqual([s["id"] for s in json.loads(after[Path("finish-subscriptions.json")])], ["b"])
        r.recover(self.home,job)
        self.assertEqual(self.snapshot(),self.before)

    def test_remove_keeps_git_and_native_history(self):
        original = self.native.read_bytes()
        job, q = self.prepare("remove")
        r.execute(self.home,job,q)
        ws = r.read(self.home / r.WORKSPACES)
        self.assertEqual([w["workspaceId"] for w in ws], ["wks_2"])
        self.assertNotIn("parentWorkspaceId", ws[0])
        self.assertEqual(self.file.read_text(),"retain")
        subprocess.run(["git","-C",str(self.cwd),"status","--porcelain"],check=True,capture_output=True)
        self.assertEqual(self.native.read_bytes(),original)

    def test_rechecks_membership_and_native_file(self):
        job, q = self.prepare("remove")
        self.write("agents/other.json", {**self.a,"id":str(uuid.uuid4())})
        state = self.snapshot()
        with self.assertRaisesRegex(ValueError, "变化"):
            r.execute(self.home,job,q)
        self.assertEqual(state,self.snapshot())
        self.native.unlink()
        with self.assertRaisesRegex(ValueError,"历史"):
            r.plan(self.home,q["cmd"])

    def test_exclusive_offline_lock(self):
        self.write("paseo.pid",b"existing")
        with self.assertRaises(FileExistsError), r.offline(self.home):
            self.fail("online registry write")
        self.assertEqual((self.home/"paseo.pid").read_bytes(),b"existing")

    def test_partial_write_rolls_back(self):
        job, q = self.prepare("remove")
        write = r.atomic
        def fail_once(path, data, mode=None):
            if path == self.home / r.WORKSPACES and data != self.before[r.WORKSPACES]:
                raise OSError("fixture failure")
            write(path,data,mode)
        with patch.object(r,"atomic",fail_once), self.assertRaises(OSError):
            r.execute(self.home,job,q)
        self.assertEqual(self.snapshot(),self.before)
