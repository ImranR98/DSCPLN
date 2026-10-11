import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { main, writeFileAtomic } = require('../WhatsAppTXT.js')

const EXPORT = (line) => `${line}\n`

const writeExport = (dir, name, lines) => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n')
}

test('writeFileAtomic replaces files atomically and leaves no temp files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watxt-atomic-'))
    const file = path.join(dir, 'out.json')
    fs.writeFileSync(file, 'old')
    writeFileAtomic(file, 'new')
    assert.equal(fs.readFileSync(file, 'utf8'), 'new')
    assert.deepEqual(fs.readdirSync(dir), ['out.json'])
    fs.rmSync(dir, { recursive: true, force: true })
})

test('a failed merge write must not delete the old conversation files', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watxt-safety-out-'))
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watxt-safety-src-'))
    const existing = 'Safety Chat'
    writeExport(outDir, `${existing}.txt`, [
        EXPORT('2024-01-15, 9:00 a.m. - Alice: Hello from the output dir'),
        EXPORT('2024-01-15, 9:01 a.m. - Bob: Overlapping message'),
    ])
    writeExport(srcDir, `${existing}.txt`, [
        EXPORT('2024-01-15, 9:01 a.m. - Bob: Overlapping message'),
        EXPORT('2024-01-15, 9:02 a.m. - Alice: From the source dir'),
    ])

    const originalWrite = fs.writeFileSync
    fs.writeFileSync = (file, ...rest) => {
        if (typeof file === 'number') throw new Error('simulated disk full')
        return originalWrite(file, ...rest)
    }
    try {
        assert.throws(() => main([outDir, srcDir], {}), /simulated disk full/)
    } finally {
        fs.writeFileSync = originalWrite
    }

    // The merge failed before deleting anything, so both inputs must survive
    // and no partial temp file may be left behind.
    assert.equal(fs.existsSync(path.join(outDir, `${existing}.txt`)), true)
    assert.equal(fs.existsSync(path.join(srcDir, `${existing}.txt`)), true)
    assert.deepEqual(fs.readdirSync(outDir), [`${existing}.txt`])
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.rmSync(srcDir, { recursive: true, force: true })
})
