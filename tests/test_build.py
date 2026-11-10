"""Run: .venv/bin/python -m unittest discover tests"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from build_data import zip_prefixes, zone_value  # noqa: E402


class ParseTests(unittest.TestCase):
    def test_single_prefix(self):
        self.assertEqual(zip_prefixes("005"), ["005"])

    def test_numeric_prefix_gets_leading_zeros(self):
        self.assertEqual(zip_prefixes(5), ["005"])

    def test_range_rows(self):
        self.assertEqual(zip_prefixes("004-007"), ["004", "005", "006", "007"])
        self.assertEqual(zip_prefixes("010 - 011"), ["010", "011"])

    def test_text_is_not_a_prefix(self):
        self.assertEqual(zip_prefixes("Dest. ZIP"), [])

    def test_zone_values(self):
        self.assertEqual(zone_value("002"), 2)
        self.assertIsNone(zone_value("-"))
        self.assertIsNone(zone_value(None))
        self.assertEqual(zone_value(2.0), 2)


if __name__ == "__main__":
    unittest.main()
