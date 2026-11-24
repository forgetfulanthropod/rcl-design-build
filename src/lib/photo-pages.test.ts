import assert from "node:assert/strict";
import { test } from "node:test";
import { PHOTOS_PER_PAGE, clampPhotoPage, photoPageCount, photoPageSlice } from "./photo-pages.ts";

test("activity log photos are 4 per page, with an empty log still one page", () => {
  assert.equal(PHOTOS_PER_PAGE, 4);
  assert.equal(photoPageCount(0), 1);
  assert.deepEqual(photoPageSlice([], 0), []);
  assert.equal(photoPageCount(4), 1);
  assert.equal(photoPageCount(5), 2);
  assert.equal(photoPageCount(8), 2);
  assert.equal(photoPageCount(9), 3);
});

test("page boundaries: first page is four, the next page is the remainder, and the index stays in range", () => {
  const photos = ["a", "b", "c", "d", "e"];
  assert.deepEqual(photoPageSlice(photos, 0), ["a", "b", "c", "d"]);
  assert.deepEqual(photoPageSlice(photos, 1), ["e"]);
  assert.equal(clampPhotoPage(-1, photos.length), 0);
  assert.equal(clampPhotoPage(0, photos.length), 0);
  assert.equal(clampPhotoPage(1, photos.length), 1);
  assert.equal(clampPhotoPage(9, photos.length), 1);
  assert.deepEqual(photoPageSlice(photos, 9), ["e"]);
});

test("deleting the last photo on the last page moves back to the previous page", () => {
  const photos = ["a", "b", "c", "d", "e"];
  const onLastPage = clampPhotoPage(1, photos.length);
  assert.deepEqual(photoPageSlice(photos, onLastPage), ["e"]);
  const afterDelete = photos.filter((id) => id !== "e");
  const page = clampPhotoPage(onLastPage, afterDelete.length);
  assert.equal(page, 0);
  assert.deepEqual(photoPageSlice(afterDelete, page), ["a", "b", "c", "d"]);
  assert.equal(photoPageCount(afterDelete.length), 1);
});
