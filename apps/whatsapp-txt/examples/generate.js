const fs = require('fs')
const path = require('path')

// Regenerates every committed example fixture. Run with: node examples/generate.js
// The fixtures are validated by: node checkFormat.js --check-examples
const root = __dirname

const write = (rel, content) => {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
}

const p2 = (num) => String(num).padStart(2, '0')
const fullwidth = (str) => str.replace(/[0-9a-z.:]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xFEE0))
const LRM = '\u200e'

const fmts = {
    android: (date, h, mi, ampm) => `${date[0]}-${p2(date[1])}-${p2(date[2])}, ${h}:${p2(mi)} ${ampm === 'am' ? 'a.m.' : 'p.m.'} - `,
    newAndroid: (date, h, mi, ampm) => `${date[1]}/${date[2]}/${String(date[0]).slice(2)}, ${h}:${p2(mi)} ${ampm.toUpperCase()} - `,
    newDmy: (date, h, mi, ampm) => `${date[2]}/${date[1]}/${date[0]}, ${h}:${p2(mi)} ${ampm} - `,
    iphone: (date, h, mi, ampm) => `[${date[0]}-${p2(date[1])}-${p2(date[2])}, ${h}:${p2(mi)}:05 ${ampm.toUpperCase()}] `
}

const bodyForFormat = (format, body) => {
    if (format !== 'iphone') return body
    return body
        .replace('<Media omitted>', `${LRM}image omitted`)
        .replace('IMG-20240115-WA0001.jpg (file attached)', '<attached: IMG_0001.jpg>')
}

const buildChat = (format, date, spec) => spec.map(([h, mi, ampm, sender, body]) =>
    fmts[format](date, h, mi, ampm) + (sender ? `${sender}: ` : '') + bodyForFormat(format, body)
).join('\n') + '\n'

// ---- Matrix: 4 filename styles x 4 timestamp formats, each with every message type ----

const matrixSpec = [
    [8, 58, 'am', null, 'Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.'],
    [9, 0, 'am', 'Alice', 'Hey Bob! How are you?'],
    [9, 1, 'am', 'Bob', "I'm good, thanks! \u{1F604}"],
    [9, 2, 'am', 'Alice', 'This is a multi-line message\nthat continues on the next line.\n\nAnd even has a blank line in the middle.'],
    [9, 3, 'am', 'Bob', '<Media omitted>'],
    [9, 4, 'am', 'Alice', 'IMG-20240115-WA0001.jpg (file attached)'],
    [9, 5, 'am', 'Bob', 'This message was deleted'],
    [9, 6, 'am', 'Alice', 'You deleted this message'],
    [9, 7, 'am', null, 'Alice added Carol'],
    [9, 8, 'am', 'Alice', 'Check this out: https://example.com/path?a=1'],
    [9, 9, 'am', 'Bob', ''],
    [12, 0, 'pm', 'Alice', 'Meeting at noon?'],
    [11, 59, 'pm', 'Bob', 'Good night']
]

const matrixDate = [2024, 1, 15]
const cleanNames = {
    android: 'AndroidFormat.txt',
    newAndroid: 'NewAndroidFormat.txt',
    newDmy: 'NewDmyFormat.txt',
    iphone: 'IphoneFormat.txt'
}
const stylePrefixes = {
    'android-filename': (name) => `WhatsApp Chat with ${name}`,
    'backup-filename': (name) => `20240115 - ${name}`,
    'iphone-filename': (name) => `2024-1-15-${name}`,
    'generic-filename': (name) => name
}

for (const style of Object.keys(stylePrefixes)) {
    for (const format of Object.keys(fmts)) {
        write(path.join('valid', 'matrix', style, stylePrefixes[style](cleanNames[format])), buildChat(format, matrixDate, matrixSpec))
    }
}

// ---- Edge case fixtures (all valid) ----

write('valid/edge/WhatsApp Chat with MidnightNoon.txt', [
    '2024-01-15, 12:00 a.m. - Alice: Midnight',
    '2024-01-15, 12:01 a.m. - Bob: Just after midnight',
    '2024-01-15, 12:00 p.m. - Alice: Noon',
    '2024-01-15, 12:01 p.m. - Bob: Just after noon',
    '2024-01-15, 11:59 p.m. - Alice: Almost midnight',
    '2024-01-16, 12:00 a.m. - Bob: Next midnight'
].join('\n') + '\n')

write('valid/edge/WhatsApp Chat with NnbspTimes.txt', [
    '2024-01-15, 9:00\u202fa.m. - Alice: Narrow no-break space before the meridiem',
    '2024-01-15, 3:04\u202fp.m. - Bob: NFKD normalization makes this parse'
].join('\n') + '\n')

write('valid/edge/2024-1-16-NnbspIphone.txt', [
    `[2024-01-16, 3:04:05\u202fAM] Alice: NNBSP in an iPhone timestamp`,
    `[2024-01-16, 3:05:00\u202fPM] Bob: Still parses after NFKD`
].join('\n') + '\n')

write('valid/edge/20240115 - CRLF.txt', [
    '2024-01-15, 9:00 a.m. - Alice: This file uses CRLF line endings',
    '2024-01-15, 9:01 a.m. - Bob: The app tolerates the trailing carriage return'
].join('\r\n') + '\r\n')

write('valid/edge/2024-1-5-NoTrailingNewline.txt',
    '5/1/2024, 9:00 am - Alice: File does not end with a newline\n' +
    '5/1/2024, 9:01 am - Bob: The app still reads the last line')

write('valid/edge/WhatsApp Chat with MediaTypes.txt', [
    '2024-01-15, 9:00 a.m. - Alice: <Media omitted>',
    '2024-01-15, 9:01 a.m. - Bob: image omitted',
    '2024-01-15, 9:02 a.m. - Alice: video omitted',
    '2024-01-15, 9:03 a.m. - Bob: audio omitted',
    '2024-01-15, 9:04 a.m. - Alice: document omitted',
    '2024-01-15, 9:05 a.m. - Bob: sticker omitted',
    '2024-01-15, 9:06 a.m. - Alice: GIF omitted',
    '2024-01-15, 9:07 a.m. - Bob: Contact card omitted',
    '2024-01-15, 9:08 a.m. - Alice: IMG-20240115-WA0002.jpg (file attached)',
    '2024-01-15, 9:09 a.m. - Bob: PTF-20240115-WA0003.pdf (file attached)'
].join('\n') + '\n')

write('valid/edge/WhatsApp Chat with Unicode.txt', [
    '2024-01-17, 9:00 a.m. - Alice: \u{1F600}\u{1F389}\u{1F44D}',
    '2024-01-17, 9:01 a.m. - Bob: \u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645',
    '2024-01-17, 9:02 a.m. - Alice: Caf\u00e9 na\u00efve r\u00e9sum\u00e9',
    fullwidth('2024-01-17, 9:03 a.m.') + ' - Bob: Fullwidth digits normalize through NFKD'
].join('\n') + '\n')

write('valid/edge/20240115 - Multiline.txt', [
    '2024-01-15, 9:00 a.m. - Alice: First line of a multi-line message',
    'second line',
    'third line',
    '',
    'after a blank line',
    '2024-01-15, 9:01 a.m. - Bob: A message containing: colons: everywhere:',
    '2024-01-15, 9:02 a.m. - Alice: Not a real date here: 2024-01-15, 9:00 a.m. - Fake: nope',
    '2024-01-15, 9:03 a.m. - Bob: Final message'
].join('\n') + '\n')

write('valid/edge/20240115 - MixedFormats.txt', [
    '2024-01-18, 8:00 a.m. - Alice: Android format',
    '1/18/24, 9:00 AM - Bob: New Android format',
    '18/1/2024, 10:00 am - Alice: New DMY format',
    '[2024-01-18, 11:00:00 AM] Bob: iPhone format',
    '2024-01-18, 12:00 p.m. - Alice: Back to Android'
].join('\n') + '\n')

write('valid/edge/WhatsApp Chat with DuplicateTimes.txt', [
    '2024-01-19, 9:00 a.m. - Alice: Same minute',
    '2024-01-19, 9:00 a.m. - Bob: Same minute again'
].join('\n') + '\n')

write('valid/edge/WhatsApp Chat with ExportHeader.txt', [
    'Chat exported on Mon Apr 06 2020 03:37:54 GMT-0400 (Eastern Daylight Time).',
    'Last chat on Wed Jan 15 2024 11:59:00 GMT-0500 (Eastern Standard Time).',
    '',
    '2024-01-15, 9:00 a.m. - Alice: Chat starts after the export header',
    '2024-01-15, 9:01 a.m. - Bob: The app strips the header before merging'
].join('\n') + '\n')

write('valid/edge/WhatsApp Chat with PartialHeader.txt', [
    'Chat exported on Mon Apr 06 2020 03:37:54 GMT-0400 (Eastern Daylight Time).',
    '',
    '2024-01-15, 9:00 a.m. - Alice: Only the first header line is present',
    '2024-01-15, 9:01 a.m. - Bob: The checker warns but the file still passes'
].join('\n') + '\n')

write('valid/edge/20180615 - SecondsIso.txt', [
    '2016-03-18, 10:39:52 AM: Alice: Old Android ISO timestamp with seconds',
    '2016-03-18, 10:40:01 AM: Bob: Seconds are preserved',
    '2017-11-09, 9:01:18 AM: Alice: A later message in the same format'
].join('\n') + '\n')

write('valid/edge/WhatsApp Chat with SecondsUs.txt', [
    '3/18/16, 10:39:52 AM: ',
    '3/18/16, 10:39:53 AM: Alice: Old Android US timestamp with seconds',
    '3/18/16, 10:40:05 AM: Bob: An empty body line before this one is still a date line'
].join('\n') + '\n')

write('valid/edge/2024-1-15-SecondsDmy.txt', [
    '18/1/2018, 9:01:18 am - Alice: DMY timestamp with seconds',
    '18/1/2018, 9:02:00 pm - Bob: Lowercase meridiem with seconds'
].join('\n') + '\n')

write('valid/edge/2024-1-15-LrmIphone.txt', [
    `${LRM}[2024-01-15, 9:00:05 AM] Alice: First line carries a leading left-to-right mark`,
    '[2024-01-15, 9:01:05 AM] Bob: Plain line without the mark',
    `${LRM}[2024-01-15, 9:02:05 AM] Alice: ${LRM}<attached: IMG_0001.jpg>`,
    `[2024-01-15, 9:03:05 AM] Bob: ${LRM}image omitted`
].join('\n') + '\n')

write('valid/edge/2024-1-15-Canonical.txt', [
    '2024-01-15-090418 - Alice: Canonical app output line',
    '2024-01-15-090500 - Bob: Already normalized with seconds',
    '2024-01-15-090501 - Alice: Multi-line continuation',
    'continues here'
].join('\n') + '\n')

write('valid/edge/20180115 - DmyShortYear.txt', [
    '15/1/24, 3:04 PM - Alice: DMY date with a two-digit year',
    '15/1/24, 3:05 PM - Bob: Previously rejected, now parsed by the generic matcher'
].join('\n') + '\n')

write('valid/edge/WhatsApp Chat with UpperNoDots.txt', [
    '2024-01-15, 3:04 PM - Alice: Uppercase meridiem without periods',
    '2024-01-15, 3:05 PM - Bob: Year-first fallback through the generic matcher'
].join('\n') + '\n')

write('valid/edge/WhatsApp Chat with ShortMinute.txt', [
    '15/1/2024, 9:00 am - Alice: Valid line',
    '15/1/2024, 3:4 pm - Bob: Single-digit minute now parses'
].join('\n') + '\n')

write('valid/edge/2024-1-16-DotDmy.txt', [
    '15.01.2024, 15:04 - Alice: Dot separators with 24-hour time',
    '16.01.2024, 09:30 - Bob: Second day in the same format'
].join('\n') + '\n')

write('valid/edge/2024-1-16-ParenIphone.txt', [
    '(15/01/2024, 3:04 PM) Alice: Parenthesized bracketed timestamp',
    '(15/01/2024, 3:05 PM) Bob: Still parses'
].join('\n') + '\n')

write('valid/edge/20240115 - MdyInferred.txt', [
    '1/2/2024, 4:04 pm - Bob: Ambiguous line inferred as Jan 2',
    '1/15/2024, 3:04 pm - Alice: The unambiguous hint makes this file MDY'
].join('\n') + '\n')

write('valid/edge/WhatsApp Chat with AmbiguousDmyDefault.txt', [
    '05/06/2024, 09:00 - Alice: No hints in this file, so DMY is used by default'
].join('\n') + '\n')

write('valid/edge/20221009 - FilenameMdy.txt', [
    '10/8/22, 9:00 am - Alice: Ambiguous line resolved by the filename date',
    '10/9/22, 9:01 am - Alice: Same order here'
].join('\n') + '\n')

write('valid/edge/20240317 - NeighborMdy.txt', [
    '2022-10-01, 9:00 a.m. - Alice: Fixed anchor before the ambiguous lines',
    '10/3/22, 2:26 pm - Alice: Ambiguous, bracketed by fixed dates',
    '10/7/22, 3:35 pm - Alice: Ambiguous, still inside the window',
    '2022-10-29, 9:00 a.m. - Alice: Fixed anchor after the ambiguous lines'
].join('\n') + '\n')

write('valid/edge/20260612 - FilenameDmy.txt', [
    '11/06/2026, 6:49 pm - Alice: Ambiguous, filename suggests June 11',
    '11/06/2026, 7:09 pm - Alice: MDY would land in December, after the export'
].join('\n') + '\n')

// ---- Invalid fixtures (each isolates one defect; see invalid/expectations.json) ----

write('invalid/bom/WhatsApp Chat with Bom.txt', [
    '\uFEFF2024-01-15, 9:00 a.m. - Alice: The BOM breaks this first date line',
    '2024-01-15, 9:01 a.m. - Bob: Later date lines still look fine'
].join('\n') + '\n')

write('invalid/no-date-lines/WhatsApp Chat with NoDates.txt', [
    'Hello, this file has no date lines at all',
    'just message text'
].join('\n') + '\n')

write('invalid/empty/WhatsApp Chat with Empty.txt', '')

write('invalid/bad-calendar/WhatsApp Chat with BadCalendar.txt', [
    '2024-01-15, 9:00 a.m. - Alice: Valid',
    '2024-13-45, 9:01 a.m. - Bob: Invalid calendar date'
].join('\n') + '\n')

write('invalid/hour24-pm/WhatsApp Chat with Hour24.txt', [
    '2024-01-15, 9:00 a.m. - Alice: Valid',
    '2024-01-15, 15:04 p.m. - Bob: 24-hour clock with a meridiem'
].join('\n') + '\n')

write('invalid/orphan-continuation/WhatsApp Chat with Orphan.txt', [
    'This continuation line appears before any date line',
    '2024-01-15, 9:00 a.m. - Alice: Then a valid date line'
].join('\n') + '\n')

write('invalid/empty-prefix/WhatsApp Chat with .txt', [
    '2024-01-15, 9:00 a.m. - Alice: Content is fine but the filename cannot be stripped',
    '2024-01-15, 9:01 a.m. - Bob: The app keeps the name unchanged'
].join('\n') + '\n')

write('invalid/bad-canonical/WhatsApp Chat with BadCanonical.txt', [
    '2024-01-15-090418 - Alice: Valid canonical line',
    '2024-01-15-250000 - Bob: Hour 25 is not a valid canonical timestamp'
].join('\n') + '\n')

// ---- Merge scenarios (two source directories each) ----

write('merge/overlap/source-a/WhatsApp Chat with Alice.txt', [
    '2024-01-01, 10:00 a.m. - Alice: Day one',
    '2024-01-02, 10:00 a.m. - Bob: Day two',
    '2024-01-03, 10:00 a.m. - Alice: Day three morning'
].join('\n') + '\n')

write('merge/overlap/source-b/20240103 - Alice.txt', [
    '2024-01-03, 12:00 p.m. - Bob: Day three noon',
    '2024-01-04, 10:00 a.m. - Alice: Day four',
    '2024-01-05, 10:00 a.m. - Bob: Day five'
].join('\n') + '\n')

write('merge/disjoint/old/WhatsApp Chat with Bob.txt', [
    '1/1/2024, 10:00 am - Bob: Old backup day one',
    '2/1/2024, 10:00 am - Alice: Old backup day two'
].join('\n') + '\n')

write('merge/disjoint/new/2024-1-3-Bob.txt', [
    '[2024-01-03, 10:00:00 AM] Bob: New phone day three',
    '[2024-01-04, 10:00:00 AM] Alice: New phone day four'
].join('\n') + '\n')

write('merge/contained/wide/WhatsApp Chat with Carol.txt', [
    '2024-01-01, 9:00 a.m. - Carol: First',
    '2024-01-05, 9:00 p.m. - Carol: Last'
].join('\n') + '\n')

write('merge/contained/narrow/20240103 - Carol.txt', [
    '1/3/24, 10:00 AM - Carol: Middle update'
].join('\n') + '\n')

write('merge/identical/one/WhatsApp Chat with Dave.txt', [
    '2024-01-15, 10:00 a.m. - Dave: Hello',
    '2024-01-15, 11:00 a.m. - Dave: World'
].join('\n') + '\n')

write('merge/identical/two/2024-1-15-Dave.txt', [
    '2024-01-15, 10:00 a.m. - Dave: Hello again',
    '2024-01-15, 11:00 a.m. - Dave: World again'
].join('\n') + '\n')

write('merge/same-end/source-a/WhatsApp Chat with Erin.txt', [
    '2024-01-02, 10:00 a.m. - Alice: Second day',
    '2024-01-03, 10:00 a.m. - Bob: Shared last day'
].join('\n') + '\n')

write('merge/same-end/source-b/20240103 - Erin.txt', [
    '2024-01-01, 10:00 a.m. - Alice: First day',
    '2024-01-03, 10:00 a.m. - Bob: Shared last day too'
].join('\n') + '\n')

write('merge/with-preamble/source-a/WhatsApp Chat with Alice.txt', [
    'Chat exported on Mon Apr 06 2020 03:37:54 GMT-0400 (Eastern Daylight Time).',
    'Last chat on Tue Jan 02 2024 10:00:00 GMT-0500 (Eastern Standard Time).',
    '',
    '2024-01-01, 10:00 a.m. - Alice: Day one',
    '2024-01-02, 10:00 a.m. - Bob: Day two'
].join('\n') + '\n')

write('merge/with-preamble/source-b/20240103 - Alice.txt', [
    'Chat exported on Wed Apr 08 2020 08:00:00 GMT-0400 (Eastern Daylight Time).',
    'Last chat on Thu Jan 04 2024 10:00:00 GMT-0500 (Eastern Standard Time).',
    '',
    '2024-01-03, 10:39:52 AM: Alice: Day three with seconds',
    '2024-01-04, 10:00:00 AM: Bob: Day four'
].join('\n') + '\n')

console.log(`Wrote fixtures under ${root}`)
