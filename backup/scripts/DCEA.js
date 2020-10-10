// Get the command to backup Discord chats

const fs = require('fs')
const os = require('os')
const execSync = require('child_process').execSync

// Throws an error if the provided path is not a valid directory
module.exports.ensureDirectory = (path) => {
    if (!path || typeof path != 'string') throw 'Provide a directory path.'
    if (!fs.existsSync(path)) throw 'Provided path does not exist.'
    if (!fs.statSync(path).isDirectory()) throw 'Provided path is not a directory.'
}

// Takes the path to the Discord Chat Exporter CLI directory and returns the command to use
module.exports.returnDiscordChatExporterCLICommand = (path) => {
    this.ensureDirectory(path)
    const files = fs.readdirSync(path)
    if (!files.find(f => f == 'DiscordChatExporter.Cli.exe') || !files.find(f => f == 'DiscordChatExporter.Cli.dll')) {
        throw 'This directory does not contain the Discord Chat Exporter CLI.'
    }

    var command = `dotnet ${path}/DiscordChatExporter.Cli.dll`
    if (os.platform() != 'win32') {
        let hasDotnet = false
        try {
            hasDotnet = execSync('which dotnet').toString().trim().length > 0
        } catch (err) {

        }
        if (!hasDotnet) throw 'Please make sure the .NET Core runtime is installed. The command \'which dotnet\' should produce a path.'
    }
    return command
}

// Checks the provided path for existing Discord Chat Exports and returns their start and end dates
// Only considers directories that follow the naming convention 'YYYY-MM-DD hh.mm.ssZ (or start) to YYYY-MM-DD hh.mm.ssZ' for the start and end dates
module.exports.getExistingDiscordBackupDates = (path) => {
    this.ensureDirectory(path)
    return fs.readdirSync(path).map(d => {
        // Should be a directory
        const isDir = fs.statSync(`${path}/${d}`).isDirectory()

        // Directory name should be two dates (or 'start' and a date, date should be UTC Format /w colon replaced by dot: YYYY-MM-DD hh.mm.ssZ) separated by a 'to'
        let dates = d.split('to').map(d => d.trim().split('.').join(':')) // Grab the two strings separated by 'to' and replace dots with colons
        dates = dates.map(d => {
            try {
                if (d != 'start') {
                    d = new Date(d) // Try to convert the string to a date, set to null if failed
                }
            } catch (err) {
                d = null
            }
        })
        if (dates.length != 2 || dates.findIndex(d => d == null) >= 0) dates = null // Empty the date object if it contains nulls or more/less than 2 dates

        if (!isDir || !dates) return null // Return null if it is not valid
        return dates
    }).filter(b => !!b)
}

module.exports.dateToDateString = (date) => {
    return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()} ${date.getUTCHours()}:${date.getUTCMinutes()}:${date.getUTCSeconds()}Z`
}

module.exports.generateBackupCommand = (DCECLIPath, DCEBackupPath, DCEToken) => {
    const command = this.returnDiscordChatExporterCLICommand(DCECLIPath)
    const backups = this.getExistingDiscordBackupDates(DCEBackupPath)
    let startDate = null
    if (backups.length > 0) startDate = backups[backups.length][1]
    return `${command} exportall -t "${DCEToken}"${startDate ? ` --dateformat "u" --after "${this.dateToDateString(startDate)}" ` : ' '}-o "${DCEBackupPath}/${startDate ? this.dateToDateString(startDate).split(':').join('.') : 'start'} to ${this.dateToDateString(new Date()).split(':').join('.')}"`
}

try {
    console.log(this.generateBackupCommand(process.argv[2], process.argv[3], process.argv[4]))
} catch (err) {
    console.error(err)
    process.exit(-1)
}