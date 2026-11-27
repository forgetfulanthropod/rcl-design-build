import assert from "node:assert/strict";
import { test } from "node:test";
import { geocodeAddress, REGION } from "./geo.ts";

test("demo Lexington streets land on their blocks", () => {
  assert.deepEqual(geocodeAddress("418 Whitaker Ln, Lexington, KY"), { lat: 38.0172, lng: -84.4588 });
  assert.deepEqual(geocodeAddress("1510 Oak St, Lexington, KY"), { lat: 38.0514, lng: -84.5086 });
  assert.deepEqual(geocodeAddress("820 Euclid Ave, Lexington, KY"), { lat: 38.0298, lng: -84.4904 });
  assert.deepEqual(geocodeAddress("  820   euclid ave, lexington, ky. "), { lat: 38.0298, lng: -84.4904 });
});

test("a street we know is found even without the city", () => {
  assert.deepEqual(geocodeAddress("1510 Oak St"), { lat: 38.0514, lng: -84.5086 });
});

test("a named city is used, and two addresses in it do not stack", () => {
  const a = geocodeAddress("100 Main St, Louisville, KY");
  const b = geocodeAddress("200 Market St, Louisville, KY");
  assert.ok(Math.abs(a.lat - 38.2527) < 0.02, String(a.lat));
  assert.ok(Math.abs(a.lng - -85.7585) < 0.02, String(a.lng));
  assert.notDeepEqual(a, b);
  assert.deepEqual(a, geocodeAddress("100 Main St, Louisville, KY"));
});

test("an address with no city stays in the Lexington region", () => {
  const point = geocodeAddress("999 Nowhere Rd");
  assert.ok(Math.abs(point.lat - REGION.lat) < 0.02);
  assert.ok(Math.abs(point.lng - REGION.lng) < 0.02);
  assert.deepEqual(point, geocodeAddress("999 Nowhere Rd"));
});

test("a blank address still returns a point in the region", () => {
  const point = geocodeAddress("   ");
  assert.ok(Math.abs(point.lat - REGION.lat) < 0.02);
  assert.ok(Math.abs(point.lng - REGION.lng) < 0.02);
});
