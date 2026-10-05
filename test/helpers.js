'use strict'

// Shared test scaffolding: temporary git-backed workbooks and a test server.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { loadConfig } = require('../config')
const { createApp } = require('../server')
const createProvider = require('../dataProviders/excelDataProvider')

const MOCK = path.join(__dirname, '..', 'mock-data.xlsx')

// Git with a deterministic identity and signing disabled, so tests can assert
// on commits without touching the user's config.
const git = (args, cwd) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@test',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@test',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'commit.gpgsign',
        GIT_CONFIG_VALUE_0: 'false',
    },
})

// A throwaway directory containing a git-tracked copy of the mock workbook.
const createWorkbookRepo = (prefix = 'dscpln-xlsx-') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    const workbookFile = path.join(dir, 'mock.xlsx')
    fs.copyFileSync(MOCK, workbookFile)
    git(['init', '-q'], dir)
    return { dir, workbookFile }
}

// The same repo plus an initialised excelDataProvider.
const createTestProvider = () => {
    const repo = createWorkbookRepo()
    return { ...repo, provider: createProvider({ workbookFile: repo.workbookFile }, repo.dir) }
}

const startServer = async () => {
    const { dir, workbookFile } = createWorkbookRepo('dscpln-server-')
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
        port: 3300,
        dataProvider: 'excelDataProvider',
        providers: {
            excelDataProvider: {
                workbookFile: `./${path.basename(workbookFile)}`,
            },
        },
    }))
    const config = loadConfig(path.join(dir, 'config.json'))
    const { app } = createApp(config)
    const server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
    }
}

const jsonRequest = (baseUrl, url, body, method = 'POST') => fetch(`${baseUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
})

module.exports = { git, MOCK, createWorkbookRepo, createTestProvider, startServer, jsonRequest }
