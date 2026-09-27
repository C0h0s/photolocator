import assert from "node:assert/strict";
import { test } from "node:test";
import { circleRing, clusterPredictions, formatRadius, haversineKm, isValidLatLng, zoomForRadius } from "../src/lib/geo.ts";

test("haversine distance matches a known pair", () => {
  // Rancho Cucamonga to downtown Los Angeles is ~60 km.
  const d = haversineKm({ lat: 34.1064, lng: -117.5931 }, { lat: 34.0522, lng: -118.2437 });
  assert.ok(Math.abs(d - 60.2) < 1.5, `got ${d}`);
});

test("circle ring is closed and every point sits at the requested radius", () => {
  const center = { lat: 34.1592, lng: -117.6253 };
  const ring = circleRing(center, 1.2, 32);
  assert.equal(ring.length, 33);
  assert.deepEqual(ring[0], ring[32]);
  for (const [lng, lat] of ring) assert.ok(Math.abs(haversineKm(center, { lat, lng }) - 1.2) < 0.01);
});

test("circle ring wraps across the antimeridian", () => {
  for (const [lng] of circleRing({ lat: 0, lng: 179.99 }, 50)) assert.ok(lng >= -180 && lng <= 180);
});

test("zoom shrinks as uncertainty grows and stays clamped", () => {
  const z = [0.01, 1, 10, 100, 5000].map((r) => zoomForRadius(r, 34));
  for (let i = 1; i < z.length; i++) assert.ok(z[i] <= z[i - 1]);
  assert.equal(z[0], 15.5);
  assert.equal(z[4], 2.5);
});

test("coordinate validation and radius labels", () => {
  assert.ok(isValidLatLng(34.1, -117.6));
  for (const [lat, lng] of [[91, 0], [0, 181], [NaN, 0], ["1", 2]]) assert.equal(isValidLatLng(lat, lng), false);
  assert.equal(formatRadius(0.12), "100 m");
  assert.equal(formatRadius(1.2), "1.2 km");
  assert.equal(formatRadius(3), "3 km");
  assert.equal(formatRadius(1250), "1,250 km");
});

test("clusters nearby predictions and ranks clusters by probability mass", () => {
  const points = [
    { lat: 34.1, lng: -117.6, p: 0.3 },
    { lat: 34.2, lng: -117.5, p: 0.2 },
    { lat: 51.3, lng: -116.2, p: 0.25 },
    { lat: 51.4, lng: -116.1, p: 0.05 },
    { lat: -1.3, lng: 36.8, p: 0.1 },
  ];
  const clusters = clusterPredictions(points, 150, 6);
  assert.equal(clusters.length, 3);
  assert.ok(Math.abs(clusters[0].weight - 0.5) < 1e-9);
  assert.equal(clusters[0].points, 2);
  assert.ok(Math.abs(clusters[0].lat - 34.14) < 1e-9, "weighted mean latitude");
  assert.ok(Math.abs(clusters[1].weight - 0.3) < 1e-9);
  assert.equal(clusterPredictions(points, 150, 2).length, 2);
});

test("clusters straddling the antimeridian keep a sensible centre", () => {
  const [c] = clusterPredictions([
    { lat: -17, lng: 179.9, p: 0.5 },
    { lat: -17, lng: -179.9, p: 0.5 },
  ]);
  assert.ok(Math.abs(Math.abs(c.lng) - 180) < 0.2, `got ${c.lng}`);
});
