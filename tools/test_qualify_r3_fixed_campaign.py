"""Protocol-level checks for the fixed R3 qualification runner."""

from __future__ import annotations

import stat
import tempfile
import unittest
from pathlib import Path

from qualify_r3_fixed_campaign import Renderer


class RendererProtocolTest(unittest.TestCase):
    def test_batched_stdout_is_drained_before_waiting_for_more_pipe_data(self) -> None:
        """A single write of READY plus a batch reply must not strand DONE."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / "fake_renderer.py"
            child.write_text(
                """#!/usr/bin/env python3
import os
import sys

os.write(
    sys.stdout.fileno(),
    b\"READY\\nR3_BATCH mode=host workload=steady count=2 mean_ns=1.5 checksum=fake\\nR3_SAMPLES mode=host workload=steady ns=[1, 2]\\nDONE\\n\",
)
for line in sys.stdin:
    if line.strip() == \"quit\":
        break
""",
                encoding="utf-8",
            )
            child.chmod(child.stat().st_mode | stat.S_IXUSR)
            renderer = Renderer(child, "fake", root / "fake.log")
            try:
                batch = renderer.batch("host", "steady", 2, 0)
            finally:
                renderer.close()

            self.assertEqual(batch["samples_ns"], [1, 2])
            self.assertEqual(batch["checksum"], "fake")
            self.assertEqual(batch["reported_mean_ns"], 1.5)


if __name__ == "__main__":
    unittest.main()
