// The merge pipeline: plan renames, validate every source, then
// write/delete in the output directory. See WhatsAppTXT.mjs for the CLI.

import fs from 'node:fs';
import { buildDateContext, stripExportHeader } from './dates.mjs';
import { conversationKey, getChatFiles, planFileRenames, writeFileAtomic } from './files.mjs';
import { ts2display, ts2ds } from './format.mjs';
import { cleanDisplayName, detectRenamedGroups, groupSharedCount, mergeConversationGroup, mergeMessages } from './merge.mjs';
import { chatToJson, parseChat, parseJsonChat } from './parse.mjs';

export const main = (dirs, options = {}) => {
    // NOTE: FIRST DIR IN ARRAY IS TREATED DIFFERENTLY - Previous files are deleted and new ones placed there
    const dryRun = Boolean(options.dryRun)
    const parseOptions = { dateOrder: options.dateOrder }
    dirs = [...new Set(dirs)]

    // Phase 1: plan renames for every dir, aborting before touching anything on name collisions
    const plans = dirs.map(dir => ({ dir, files: planFileRenames(dir, getChatFiles(dir, true)) }))

    // Phase 2: read and validate every source before any rename, delete or write
    const ambiguous = []
    const problems = []
    const sources = new Map()
    plans.forEach(({ dir, files }) => {
        files.forEach(({ original, final }) => {
            const file = `${dir}/${original}`
            const raw = fs.readFileSync(file).toString()
            const key = conversationKey(final)
            if (original.toLowerCase().endsWith('.json')) {
                let messages
                try {
                    messages = parseJsonChat(raw)
                } catch (e) {
                    problems.push(`${file}: ${e}`)
                    return
                }
                if (messages.length === 0) {
                    problems.push(`${file}: no messages found`)
                    return
                }
                if (!sources.has(key)) sources.set(key, [])
                sources.get(key).push({ dir, original, messages })
            } else {
                const stripped = stripExportHeader(raw)
                const context = buildDateContext(stripped.split('\n'), { ...parseOptions, fileName: original })
                if (context.ambiguousCount > 0) ambiguous.push({ file, count: context.ambiguousCount, order: context.order, orderSource: context.orderSource })
                const parsed = parseChat(stripped, { context })
                if (parsed.warnings.length > 0) {
                    problems.push(`${file}: ${parsed.warnings.length} line(s) before the first date line`)
                    return
                }
                if (parsed.messages.length === 0) {
                    problems.push(`${file}: no date lines found`)
                    return
                }
                if (!sources.has(key)) sources.set(key, [])
                sources.get(key).push({ dir, original, messages: parsed.messages })
            }
        })
    })
    if (problems.length > 0) {
        throw `Aborting:\n${problems.map(problem => `  ${problem}`).join('\n')}`
    }

    // Phase 3: merge everything in memory, still before any mutation
    const summary = []
    const members = []
    sources.forEach((list, key) => {
        members.push({ key, name: key, messages: mergeMessages(list.map(source => source.messages)), sources: list })
    })
    const detected = options.mergeRenamed === false
        ? { groups: [], edges: new Map() }
        : detectRenamedGroups(members, { minShared: options.renameMinShared, minCoverage: options.renameMinCoverage })
    const groupedMembers = new Set(detected.groups.flat())
    detected.groups.forEach(group => {
        const memberList = group.map(index => members[index])
        const merged = mergeConversationGroup(memberList)
        const last = merged.messages[merged.messages.length - 1].date
        summary.push({
            name: merged.name,
            outName: `${ts2ds(last)} - ${merged.name}.json`,
            sources: memberList.reduce((total, member) => total + member.sources.length, 0),
            first: merged.messages[0].date,
            last,
            messages: merged.messages,
            cleanupKeys: memberList.map(member => member.key),
            group: { names: memberList.map(member => cleanDisplayName(member.name)), shared: groupSharedCount(memberList) }
        })
    })
    members.forEach((member, index) => {
        if (groupedMembers.has(index)) return
        const messages = member.messages
        const last = messages[messages.length - 1].date
        summary.push({ name: member.key, outName: `${ts2ds(last)} - ${member.key}.json`, sources: member.sources.length, first: messages[0].date, last, messages, cleanupKeys: [member.key] })
    })

    // Phase 4: apply renames, write merged files, then remove old outputs.
    // Ordering matters for safety: every merged file is written atomically
    // BEFORE any old output is deleted, so an interrupted merge can lose at
    // most nothing (the old files are still there on the next run).
    if (!dryRun) {
        plans.forEach(({ dir, files }) => {
            files.forEach(({ original, final }) => {
                if (final !== original) fs.renameSync(`${dir}/${original}`, `${dir}/${final}`)
            })
        })
        const writtenPaths = new Set(summary.map(conversation => `${dirs[0]}/${conversation.outName}`))
        for (const conversation of summary) {
            writeFileAtomic(`${dirs[0]}/${conversation.outName}`, chatToJson(conversation.messages))
        }
        for (const conversation of summary) {
            for (const key of conversation.cleanupKeys) {
                for (const extension of ['.txt', '.json']) {
                    const existing = `${dirs[0]}/${key}${extension}`
                    // Never delete a path written by this run (an output can
                    // also be an input that the merge just replaced).
                    if (fs.existsSync(existing) && !writtenPaths.has(existing)) fs.unlinkSync(existing)
                }
            }
        }
    }

    console.log('')
    if (dryRun) console.log('=== Dry run: no files were renamed, deleted or written ===')
    const multi = summary.filter(s => !s.group && s.sources > 1)
    const single = summary.filter(s => !s.group && s.sources === 1)
    console.log(`=== Merged ${multi.length} conversation(s) from multiple sources ===`)
    multi.forEach(s => {
        const range = s.first ? `${ts2display(s.first)} -> ${ts2display(s.last)}` : 'no dates found'
        console.log(`  ${s.outName}  [${range}]  (${s.sources} sources)`)
    })
    console.log(`=== ${single.length} conversation(s) from a single source ===`)
    single.forEach(s => {
        const range = s.first ? `${ts2display(s.first)} -> ${ts2display(s.last)}` : 'no dates found'
        console.log(`  ${s.outName}  [${range}]`)
    })
    const renamed = summary.filter(s => s.group)
    if (renamed.length > 0) {
        const files = renamed.reduce((total, s) => total + s.cleanupKeys.length, 0)
        console.log(`=== Merged ${renamed.length} renamed conversation(s) (${files} files) ===`)
        renamed.forEach(s => {
            console.log(`  ${s.group.names.map(name => `"${name}"`).join(' + ')} -> "${s.name}"  (${s.group.shared} shared msgs)`)
        })
    }
    if (ambiguous.length > 0) {
        console.log('=== Ambiguous dates ===')
        ambiguous.forEach(item => {
            console.log(`  ${item.file}: ${item.count} ambiguous date line(s) resolved as ${item.order.toUpperCase()} (${item.orderSource})`)
        })
        console.log('  Override with --date-order=dmy|mdy|ymd if the interpretation is wrong')
    }

    // Machine-readable result (used by the web app's import API; the CLI ignores it)
    return {
        dryRun,
        conversations: summary.map(conversation => ({
            outName: conversation.outName,
            sources: conversation.sources,
            first: conversation.first ?? null,
            last: conversation.last ?? null,
            group: conversation.group ? { names: conversation.group.names, shared: conversation.group.shared } : null
        })),
        ambiguous
    }
}
