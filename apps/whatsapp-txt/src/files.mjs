// Conversation files: atomic writes, directory listing and the
// rename planning shared by the CLI and the server import.

import fs from 'node:fs';

export const writeFileAtomic = (file, data) => {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    let fd = null
    try {
        fd = fs.openSync(tmp, 'w')
        fs.writeFileSync(fd, data)
        fs.fsyncSync(fd)
        fs.closeSync(fd)
        fd = null
        fs.renameSync(tmp, file)
    } catch (err) {
        if (fd !== null) fs.closeSync(fd)
        fs.rmSync(tmp, { force: true })
        throw err
    }
}

// Lists chat files in a dir (.txt exports and .json outputs; dotfiles such as backup state files are ignored)
export const getChatFiles = (dir, includeJson = true) => fs.readdirSync(dir).filter(fil => {
    if (fil.startsWith('.')) return false
    const lower = fil.toLowerCase()
    if (!lower.endsWith('.txt') && !(includeJson && lower.endsWith('.json'))) return false
    return !fs.statSync(`${dir}/${fil}`).isDirectory()
})

// Conversation identity: clean name without extension (.txt and .json are the same conversation)
export const conversationKey = (finalName) => finalName.replace(/\.(txt|json)$/i, '')

// Given a file name, returns { style, prefix, finalName } if it has a known export prefix, else null
export const matchFilenamePrefix = (txt) => {
    const regexRes1 = /^WhatsApp Chat with /.exec(txt) // Android Export
    const regexRes2 = /^[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[1-2][0-9]|3[0-1]) - /.exec(txt) // Previous Backup
    const regexRes3 = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}-/.exec(txt) // iPhone Export
    const res = regexRes1 || regexRes2 || regexRes3
    if (!res) return null
    const style = regexRes1 ? 'android' : regexRes2 ? 'backup' : 'iphone'
    return { style, prefix: res[0], finalName: txt.length > res[0].length + 4 ? txt.slice(res[0].length) : txt }
}

// Given a list of files in a dir, returns [{ original, final }] and throws before any rename if two
// files would end up with the same name or a target already exists
export const planFileRenames = (dir, txts) => {
    const plan = txts.map(txt => {
        const match = matchFilenamePrefix(txt)
        return { original: txt, final: match ? match.finalName : txt }
    })
    const grouped = new Map()
    for (const item of plan) {
        if (item.final === item.original) continue
        if (!grouped.has(item.final)) grouped.set(item.final, [])
        grouped.get(item.final).push(item.original)
    }
    const problems = []
    for (const [final, originals] of grouped) {
        if (originals.length > 1) {
            problems.push(`  ${originals.map(name => JSON.stringify(name)).join(' and ')} both map to ${JSON.stringify(final)}`)
        }
        if (fs.existsSync(`${dir}/${final}`)) {
            problems.push(`  ${JSON.stringify(originals[0])} maps to ${JSON.stringify(final)}, which already exists`)
        }
    }
    if (problems.length > 0) {
        throw `Refusing to rename files in ${dir} because of name collisions:\n${problems.join('\n')}`
    }
    return plan
}

// Header lines prepended by some external backup tools
