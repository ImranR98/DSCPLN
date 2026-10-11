'use strict'

// Commits workbook changes to the git repository that contains the workbook.
// Uses an app-specific author/committer identity and never signs commits, so it
// works on machines with no personal git identity (or with signing configured).

const path = require('path')
const { execFileSync } = require('child_process')

const APP_IDENTITY = {
    name: 'D$CPLN',
    email: 'dscpln@localhost',
}

const buildEnv = () => ({
    ...process.env,
    GIT_AUTHOR_NAME: APP_IDENTITY.name,
    GIT_AUTHOR_EMAIL: APP_IDENTITY.email,
    GIT_COMMITTER_NAME: APP_IDENTITY.name,
    GIT_COMMITTER_EMAIL: APP_IDENTITY.email,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'commit.gpgsign',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'safe.directory',
    GIT_CONFIG_VALUE_1: '*',
    GIT_TERMINAL_PROMPT: '0',
})

const runGit = (args, cwd) => {
    try {
        return execFileSync('git', args, {
            cwd,
            env: buildEnv(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    } catch (e) {
        if (e.code === 'ENOENT') {
            throw new Error('git is required to commit workbook changes but was not found in PATH')
        }
        throw e
    }
}

const findRepoRoot = (directory) => {
    let output
    try {
        output = runGit(['rev-parse', '--show-toplevel'], directory)
    } catch (e) {
        if (/not a git repository/i.test(`${e.stdout || ''}${e.stderr || ''}`)) {
            return null
        }
        throw e
    }
    return output.trim() || null
}

const assertWorkbookRepo = (file) => {
    const absolute = path.resolve(file)
    const repoRoot = findRepoRoot(path.dirname(absolute))
    if (!repoRoot) {
        throw new Error(`The workbook must live in a git repository so changes can be committed: ${absolute}`)
    }
    return repoRoot
}

const commitFile = (file, message) => {
    const absolute = path.resolve(file)
    const repoRoot = assertWorkbookRepo(absolute)
    const relative = path.relative(repoRoot, absolute)
    runGit(['add', '--', relative], repoRoot)
    try {
        runGit(['commit', '--no-gpg-sign', '--no-verify', '-m', message, '--', relative], repoRoot)
        return true
    } catch (e) {
        const output = `${e.stdout || ''}${e.stderr || ''}`
        if (/nothing to commit|no changes added to commit/i.test(output)) {
            return false
        }
        throw e
    }
}

module.exports = { assertWorkbookRepo, commitFile }
