const DCEA = require('./DCEA.js')

try {
    if (process.argv.length < 6) throw `Usage: [command] [DiscordChatExporter.CLI Directory Path] [Discord Account Token] [Discord Chat Exports Directory] [Server Position in list of accessible servers]`
    console.log(DCEA.generateBackupCommandForServer(process.argv[2], process.argv[3], process.argv[4], process.argv[5]))
} catch (err) {
    console.error(err)
    process.exit(-1)
}