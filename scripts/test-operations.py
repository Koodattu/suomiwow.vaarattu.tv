#!/usr/bin/env python3
"""Linux CLI regression tests; all Git/Docker activity is stubbed and isolated."""

import fcntl
import gzip
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parent
STUB = r'''#!/usr/bin/env python3
import gzip
import json
import os
from pathlib import Path
import subprocess
import sys

name = Path(sys.argv[0]).name
args = sys.argv[1:]
if name == "date":
    sys.exit(subprocess.call(["/bin/date", "-d", os.environ["OPS_TEST_NOW"], *args]))
if name == "sleep":
    sys.exit(0)
with open(os.environ["OPS_TEST_TRACE"], "a") as trace:
    trace.write(json.dumps([name, *args]) + "\n")
if name == "git":
    if args == ["rev-parse", "--abbrev-ref", "HEAD"]:
        print("main")
    elif args == ["rev-parse", "HEAD"]:
        print("old")
    elif args == ["rev-parse", "FETCH_HEAD"]:
        print("old" if os.environ.get("OPS_TEST_UP_TO_DATE") else "new")
elif name == "docker":
    if args[0] == "inspect":
        print("false" if os.environ.get("OPS_TEST_DB_STOPPED") else "true")
    elif "mongodump" in args:
        mode = os.environ.get("OPS_TEST_DUMP", "ok")
        sys.stdout.buffer.write(gzip.compress(b"test archive") if mode == "ok" else b"incomplete")
        sys.exit(1 if mode == "fail" else 0)
    elif args[0] == "ps":
        print("container")
'''


class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="wow-operations-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name in ("docker", "git", "date", "sleep"):
            stub = self.bin / name
            stub.write_text(STUB)
            stub.chmod(0o755)
        self.project = self.root / "project"
        self.project.mkdir()
        self.backups = self.root / "backups with spaces"
        self.backups.mkdir()
        self.trace = self.root / "trace.jsonl"
        self.lock = self.root / "operations.lock"
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "PROJECT_DIR": str(self.project),
            "BACKUP_DIR": str(self.backups),
            "LOCKFILE": str(self.lock),
            "OPS_TEST_TRACE": str(self.trace),
            "OPS_TEST_NOW": "2026-10-06 12:00:00 UTC",
        }

    def run_script(self, name, *args, **env):
        return subprocess.run(
            ["bash", str(SCRIPTS / name), *args],
            env={**self.env, **env}, capture_output=True, text=True, timeout=10,
        )

    def calls(self):
        return [json.loads(line) for line in self.trace.read_text().splitlines()] if self.trace.exists() else []

    def seed_backups(self):
        for day in range(1, 7):
            (self.backups / f"wow_db_backup_202609{day:02d}_110000.gz").write_bytes(gzip.compress(b"old backup"))

    def backup_contents(self):
        return {path.name: path.read_bytes() for path in self.backups.iterdir()}

    def test_deploy_builds_new_code_without_dump(self):
        result = self.run_script("deploy.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any(call[:2] == ["docker", "compose"] for call in self.calls()))
        self.assertFalse(any("mongodump" in call for call in self.calls()))
        self.assertFalse(list(self.backups.iterdir()))

    def test_up_to_date_deploy_does_not_rebuild(self):
        result = self.run_script("deploy.sh", OPS_TEST_UP_TO_DATE="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(call[0] == "docker" for call in self.calls()))

    def test_manual_backup_at_any_hour_keeps_five_and_never_deploys(self):
        self.seed_backups()
        result = self.run_script("backup-db.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        names = sorted(self.backup_contents())
        self.assertEqual(len(names), 5)
        self.assertEqual(names[0], "wow_db_backup_20260903_110000.gz")
        completed = self.backups / names[-1]
        self.assertEqual(gzip.decompress(completed.read_bytes()), b"test archive")
        self.assertEqual(completed.stat().st_mode & 0o777, 0o600)
        self.assertTrue(any("mongodump" in call and "--oplog" in call for call in self.calls()))
        self.assertFalse(any(call[0] == "git" or "compose" in call for call in self.calls()))

    def test_failed_dump_preserves_old_backups_and_removes_partial_file(self):
        self.seed_backups()
        before = self.backup_contents()
        result = self.run_script("backup-db.sh", OPS_TEST_DUMP="fail")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.backup_contents(), before)

    def test_invalid_gzip_is_not_published_or_rotated(self):
        self.seed_backups()
        before = self.backup_contents()
        result = self.run_script("backup-db.sh", OPS_TEST_DUMP="corrupt")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.backup_contents(), before)

    def test_missing_database_fails_without_creating_backup(self):
        result = self.run_script("backup-db.sh", OPS_TEST_DB_STOPPED="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(list(self.backups.iterdir()))
        self.assertFalse(any("mongodump" in call for call in self.calls()))

    def test_scheduled_backup_runs_at_eleven_in_summer_and_winter(self):
        for now in ("2026-07-15 08:00:00 UTC", "2026-01-15 09:00:00 UTC"):
            with self.subTest(now=now):
                result = self.run_script("backup-db.sh", "--scheduled", OPS_TEST_NOW=now)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("Backup completed:", result.stdout)

    def test_scheduled_backup_skips_other_hours_in_summer_and_winter(self):
        for now in ("2026-07-15 09:00:00 UTC", "2026-01-15 08:00:00 UTC"):
            with self.subTest(now=now):
                result = self.run_script("backup-db.sh", "--scheduled", OPS_TEST_NOW=now)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(self.calls())
                self.assertFalse(list(self.backups.iterdir()))

    def test_deploy_skips_held_lock_without_git_or_docker_calls(self):
        with self.lock.open("w") as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            result = self.run_script("deploy.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Skipping this check", result.stdout)
        self.assertFalse(self.calls())
        self.assertTrue(self.lock.exists())

    def test_backup_waits_for_lock_then_succeeds(self):
        with self.lock.open("w") as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            with subprocess.Popen(
                ["bash", str(SCRIPTS / "backup-db.sh")], env=self.env,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            ) as process:
                self.assertIn("Waiting for", process.stdout.readline())
                self.assertIsNone(process.poll())
                self.assertFalse(self.calls())
                fcntl.flock(held, fcntl.LOCK_UN)
                stdout, stderr = process.communicate(timeout=10)
                self.assertEqual(process.returncode, 0, stderr)
                self.assertIn("Backup completed:", stdout)

    def test_invalid_arguments_fail_before_any_external_activity(self):
        result = self.run_script("backup-db.sh", "--unknown")
        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.calls())


if __name__ == "__main__":
    unittest.main(verbosity=2)
