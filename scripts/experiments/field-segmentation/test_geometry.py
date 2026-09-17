"""Geometry correctness matters before any candidate becomes a saved boundary."""
import unittest

import numpy as np

from run import polygons_from_mask, wgs84_polygons


class GeometryTests(unittest.TestCase):
    def test_components_holes_and_closed_normalized_rings(self):
        mask = np.zeros((100, 200), dtype=bool)
        mask[10:90, 10:90] = True
        mask[30:60, 30:60] = False
        mask[20:60, 120:180] = True
        polygons = polygons_from_mask(mask)
        self.assertEqual(len(polygons), 2)
        self.assertEqual(sorted(map(len, polygons)), [1, 2])
        for polygon in polygons:
            for ring in polygon:
                self.assertEqual(ring[0], ring[-1])
                self.assertGreaterEqual(len(ring), 4)
                self.assertTrue(all(0 <= x <= 1 and 0 <= y <= 1 for x, y in ring))

    def test_empty_mask(self):
        self.assertEqual(polygons_from_mask(np.zeros((50, 70), dtype=bool)), [])

    def test_georeferencing_uses_top_left_and_preserves_holes(self):
        extent = {"xmin": 0, "ymin": 0, "xmax": 111319.49079327357, "ymax": 111325.1428663851,
                  "spatialReference": {"wkid": 3857}}
        polygons = [[[[0, 0], [1, 0], [1, 1], [0, 0]], [[.2, .2], [.3, .2], [.3, .3], [.2, .2]]]]
        result = wgs84_polygons(polygons, extent)
        self.assertEqual(len(result[0]), 2)
        for actual, expected in zip(result[0][0], [[0, 1], [1, 1], [1, 0], [0, 1]]):
            np.testing.assert_allclose(actual, expected, atol=1e-8)

    def test_rejects_unrecognized_projection(self):
        with self.assertRaises(ValueError):
            wgs84_polygons([], {"spatialReference": {"wkid": 4326}})


if __name__ == "__main__":
    unittest.main()
