import test from "node:test";
import assert from "node:assert/strict";
import {
  customTimeFromFileName,
  formatDateStamp,
  isLikelyStandardName,
  selectDateFromTags,
  standardNameFor,
  unwrapOriginalBase,
} from "../src/exif.js";

test("prefers DateTimeOriginal", () => {
  const tags = {
    DateTimeOriginal: "2021:06:07 08:09:10",
    ModifyDate: "2019:01:01 00:00:00",
    FileModifyDate: "2022:01:01 00:00:00+00:00",
  };
  assert.equal(selectDateFromTags(tags, "x.jpg"), "2021:06:07 08:09:10");
});

test("falls back to the oldest date-like value, ignoring access/inode dates", () => {
  const tags = {
    CreateDate: "2020:01:02 03:04:05",
    ModifyDate: "2019:05:06 07:08:09",
    FileAccessDate: "2010:01:01 00:00:00",
    FileInodeChangeDate: "2010:01:01 00:00:00",
  };
  assert.equal(selectDateFromTags(tags, "x.jpg"), "2019:05:06 07:08:09");
});

test("ignores zero dates, numeric-only values and YYYY:MM values", () => {
  const tags = {
    CreateDate: "0000:00:00 00:00:00",
    ModifyDate: "2020:01",
    TrackCreateDate: "12345",
    MediaCreateDate: "2018:03:04 05:06:07",
  };
  assert.equal(selectDateFromTags(tags, "x.jpg"), "2018:03:04 05:06:07");
});

test("returns null when nothing usable exists", () => {
  assert.equal(selectDateFromTags({ MakerNotes: "hello" }, "x.jpg"), null);
});

test("YYYYMMDD-only values become local midnight and can win over no other dates", () => {
  const result = selectDateFromTags({ GPSDateStamp: "20190304" }, "IMG_1.jpg");
  assert.match(result, /^2019:03:04 0:00[+-][0-9]{2}:[0-9]{2}$/);
});

test("custom YYYYMMDD_HHMM file names set the time", () => {
  assert.equal(customTimeFromFileName("20190304_123 video.mp4"), "01:23");
  assert.equal(customTimeFromFileName("20190304_930-x.mp4"), null);
  assert.equal(customTimeFromFileName("nope.mp4"), null);
});

test("minute overflow in custom file names rolls into hours and wraps at 24", () => {
  assert.equal(customTimeFromFileName("20190304_199 video.mp4"), "02:39");
  assert.equal(customTimeFromFileName("20190304_999 video.mp4"), "10:39");
});

test("formatDateStamp trims to 19 characters with dashes", () => {
  assert.equal(formatDateStamp("2021:06:07 08:09:10"), "2021-06-07-08-09-10");
  assert.equal(formatDateStamp("2021:06:07 0:00-04:00"), "2021-06-07-0-00-04-");
});

test("standardNameFor builds the standard name from the original base", () => {
  assert.equal(standardNameFor("IMG_1.jpg", "2021:06:07 08:09:10"), "2021-06-07-08-09-10-(IMG_1).jpg");
});

test("standardNameFor unwraps an already-standardized source name", () => {
  assert.equal(
    standardNameFor("2020-01-02-03-04-05-(IMG_1).jpg", "2021:06:07 08:09:10"),
    "2021-06-07-08-09-10-(IMG_1).jpg",
  );
});

test("unwrapOriginalBase strips LifeTagger-style tag suffixes", () => {
  assert.equal(unwrapOriginalBase("2020-01-02-03-04-05-(IMG_1)-[beach, sunny]"), "IMG_1");
  assert.equal(unwrapOriginalBase("IMG_1"), "IMG_1");
});

test("isLikelyStandardName detects standardized prefixes", () => {
  assert.equal(isLikelyStandardName("2020-01-02-03-04-05-(IMG_1).jpg"), true);
  assert.equal(isLikelyStandardName("IMG_1.jpg"), false);
});
