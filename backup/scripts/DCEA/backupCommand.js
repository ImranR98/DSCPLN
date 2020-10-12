const DCEA = require('./DCEA.js')

try {
    if (process.argv.length < 7) throw `Usage: [command] [DiscordChatExporter.CLI Directory Path] [Discord Account Token] [Discord Chat Exports Directory] [Server ID] [Server Name]`
    console.log(process.argv)
    console.log(DCEA.generateBackupCommandForServer(process.argv[2], process.argv[3], process.argv[4], process.argv[5], process.argv[6]))
} catch (err) {
    console.error(err)
    process.exit(-1)
}