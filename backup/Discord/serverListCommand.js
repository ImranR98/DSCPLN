const DCEA = require('./DCEA.js')

try {
    if (process.argv.length < 4) throw `Usage: [command] [DiscordChatExporter.CLI Directory Path] [Discord Account Token]`
    console.log(DCEA.generateServerListCommand(process.argv[2], process.argv[3]))
} catch (err) {
    console.error(err)
    process.exit(-1)
}