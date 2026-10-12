import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExifTool } from "exiftool-vendored";

const EXIF_CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ExifTool.config");

export const READ_ARGS = ["-m", "-api", "LargeFileSupport=1"];
export const WRITE_ARGS = ["-m", "-overwrite_original", "-api", "LargeFileSupport=1"];

export function createExifTool() {
  return new ExifTool({
    useMWG: false,
    defaultVideosToUTC: false,
    exiftoolArgs: ["-config", EXIF_CONFIG, "-stay_open", "True", "-@", "-"],
  });
}

export function tagValueStrings(tags, predicate) {
  const out = [];
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (predicate && !predicate(key)) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v === undefined || v === null) continue;
      out.push(String(v));
    }
  }
  return out;
}

function containsZeroDate(v) {
  return v.includes("0000");
}

export function endsWithYearMonth(v) {
  return /[0-9]{4}:[0-9]{2}$/.test(v);
}

function isDateLikeKey(key) {
  return /Date/.test(key) && !/Access|Inode/.test(key);
}

export function customTimeFromFileName(fileName) {
  const prefix = path.basename(fileName).split(/\s+/)[0];
  const m = /^([0-9]{8})_([0-9]{3})$/.exec(prefix);
  if (!m) return null;
  let hours = Number(m[2][0]);
  let minutes = Number(m[2].slice(1, 3));
  if (minutes >= 60) {
    hours += Math.floor(minutes / 60);
    minutes = minutes % 60;
  }
  hours = hours % 24;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function localOffsetString(y, m, d, hh, mm) {
  const dt = new Date(y, m - 1, d, hh, mm, 0);
  const off = -dt.getTimezoneOffset();
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function formatZonedDate(yyyymmdd, timeStr) {
  if (!/^[0-9]{8}$/.test(yyyymmdd)) return null;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  if (y < 1000 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const [hh, mm] = (timeStr ?? "0:00").split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return null;
  return `${yyyymmdd.slice(0, 4)}:${yyyymmdd.slice(4, 6)}:${yyyymmdd.slice(6, 8)} ${timeStr ?? "0:00"}${localOffsetString(y, m, d, hh, mm)}`;
}

export function selectDateFromTags(tags, fileName) {
  const all = tagValueStrings(tags);
  const passesCommonFilters = (v) => !containsZeroDate(v) && !endsWithYearMonth(v);

  let dto = null;
  for (const v of tagValueStrings(tags, (k) => k === "DateTimeOriginal")) {
    if (passesCommonFilters(v) && v.trim() !== "") {
      dto = v;
      break;
    }
  }
  if (dto) return dto;

  const dateValues = tagValueStrings(tags, isDateLikeKey).filter(passesCommonFilters);
  const odValues = dateValues.filter((v) => !/^[0-9]+$/.test(v)).sort();
  const paddedValues = dateValues.filter((v) => /^[0-9]{8}$/.test(v)).sort();

  let od = odValues[0] ?? null;
  const padded = paddedValues[0];
  if (padded) {
    const ymd = `${padded.slice(0, 4)}:${padded.slice(4, 6)}:${padded.slice(6, 8)}`;
    const sameAsOldest = od ? od.split(/\s+/)[0] === ymd : false;
    if (!sameAsOldest) {
      const formatted = formatZonedDate(padded, customTimeFromFileName(fileName));
      if (formatted) {
        od = [formatted, ...odValues].sort()[0];
      }
    }
  }
  return od;
}

export async function readTags(exiftool, file) {
  return exiftool.readRaw(file, READ_ARGS);
}

export async function findRealExifDate(exiftool, file) {
  const tags = await readTags(exiftool, file);
  return selectDateFromTags(tags, file);
}

export function fixupDateValue(value) {
  if (value.split(":").length === 3) return `${value} 00:00:00`;
  return value;
}

export async function applyDates(exiftool, file, dateValue) {
  const value = fixupDateValue(dateValue);
  await exiftool.write(
    file,
    {
      DateTimeOriginal: value,
      CreateDate: value,
      MediaCreateDate: value,
      TrackCreateDate: value,
      ModifyDate: value,
      MediaModifyDate: value,
      TrackModifyDate: value,
      FileModifyDate: value,
    },
    { writeArgs: WRITE_ARGS },
  );
  try {
    await exiftool.write(file, { ContentCreateDate: value }, { writeArgs: WRITE_ARGS });
  } catch {
    // video-only tag
  }
}

export async function applyDatesFromFileName(exiftool, file) {
  await exiftool.write(
    file,
    {},
    [
      ...WRITE_ARGS,
      "-FileName>DateTimeOriginal",
      "-FileName>CreateDate",
      "-FileName>MediaCreateDate",
      "-FileName>TrackCreateDate",
    ],
  );
}

export async function readBackDateTimeOriginal(exiftool, file) {
  const tags = await readTags(exiftool, file);
  const values = tagValueStrings(tags, (k) => k === "DateTimeOriginal");
  const v = values.find((x) => x.trim() !== "" && !containsZeroDate(x));
  return v ?? null;
}

export async function readMediaCreateDate(exiftool, file) {
  const tags = await readTags(exiftool, file);
  const values = tagValueStrings(tags, (k) => k === "MediaCreateDate");
  return values.find((x) => x.trim() !== "" && !containsZeroDate(x)) ?? null;
}

export function formatDateStamp(dateValue) {
  return dateValue.replace(/[: ]/g, "-").slice(0, 19);
}

export function splitName(fileName) {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { base: fileName, ext: fileName };
  return { base: fileName.slice(0, dot), ext: fileName.slice(dot + 1) };
}

export function isLikelyStandardName(name) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-\(.+\)/.test(name);
}

export function unwrapOriginalBase(base) {
  const m = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-\((.*)\)(?:-\[[^\]]*\])?$/.exec(base);
  if (!m) return base;
  return m[1];
}

export function originalBaseOf(fileName) {
  const { base } = splitName(fileName);
  return unwrapOriginalBase(base);
}

export function standardNameFor(fileName, dateValue) {
  const { ext } = splitName(fileName);
  const stamp = formatDateStamp(dateValue);
  return `${stamp}-(${originalBaseOf(fileName)}).${ext}`;
}

export function normalizeExifDateToEpoch(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = /^([0-9]{4}):([0-9]{2}):([0-9]{2})[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?(.*)$/.exec(s);
  if (m) {
    const [, y, mo, d, h, mi, sec, rest] = m;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${sec ?? "00"}${rest ?? ""}`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}
