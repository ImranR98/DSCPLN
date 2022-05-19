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
// Throws an error if the command cannot be run
module.exports.returnDiscordChatExporterCLICommand = (dir) => {
    this.ensureDirectory(dir)
    const files = fs.readdirSync(dir)
    if (!files.find(f => f == 'DiscordChatExporter.Cli.exe') || !files.find(f => f == 'DiscordChatExporter.Cli.dll')) {
        throw 'This directory does not contain the Discord Chat Exporter CLI.'
    }

    var command = `dotnet ${dir}/DiscordChatExporter.Cli.dll`
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
// Only considers directories that follow the naming convention 'YYYY-MM-DD hh.mm.ssZ (or 'start') to YYYY-MM-DD hh.mm.ssZ' for the start and end dates
module.exports.getExistingDiscordBackupDatesForServer = (backupDir) => {
    this.ensureDirectory(backupDir)
    return fs.readdirSync(backupDir).map(d => {
        // Should be a directory
        const isDir = fs.statSync(`${backupDir}/${d}`).isDirectory()

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
            return d
        })
        if (dates.length != 2 || dates.findIndex(d => d == null) >= 0) dates = null // Empty the date object if it contains nulls or more/less than 2 dates

        if (!isDir || !dates) return null // Return null if it is not valid
        return dates
    }).filter(b => !!b)
}

// Turns a single digit number into a string with two digits
module.exports.doubleDigitNumber = (num) => {
    num = num.toString().trim()
    if (num.length < 2) num = '0' + num
    return num
}

// Turns a date into a UTC string of the form accepted by DiscordChatExporter.CLI
module.exports.dateToDateString = (date) => {
    return `${date.getUTCFullYear()}-${this.doubleDigitNumber(date.getUTCMonth() + 1)}-${this.doubleDigitNumber(date.getUTCDate())} ${this.doubleDigitNumber(date.getUTCHours())}:${this.doubleDigitNumber(date.getUTCMinutes())}:${this.doubleDigitNumber(date.getUTCSeconds())}Z`
}

// Generate a command to backup the latest messages from a server (also creates a new backup directory if it doesn't exist)
module.exports.generateBackupCommandForServer = (DCECLIPath, DCEToken, DCEBackupPath, serverID, serverName) => {
    // Trim some args
    if (serverName) serverName = serverName.trim().split('/').join('-')

    // Get the correct command to use
    const command = this.returnDiscordChatExporterCLICommand(DCECLIPath)

    // Generate a folder for the server or find the existing one
    let backupDir = `${DCEBackupPath}/${serverName} - ${serverID}`
    const existingBackupDir = fs.readdirSync(DCEBackupPath).filter(file => file.endsWith(` - ${serverID}`))[0]
    if (existingBackupDir && fs.statSync(`${DCEBackupPath}/${existingBackupDir}`).isDirectory())
        backupDir = `${DCEBackupPath}/${existingBackupDir}`

    // Generate the server folder if it does not exist
    try {
        this.ensureDirectory(backupDir)
    } catch (err) {
        fs.mkdirSync(backupDir)
    }

    // Get any existing backups for this server and firgure out the start date for the new backup (if no backups previous exist, start date is undefined)
    const backups = this.getExistingDiscordBackupDatesForServer(backupDir)
    let startDate = null
    if (backups.length > 0) startDate = backups[backups.length - 1][1]
    if (backups.length > 1) startDate = backups[backups.length - 2][1]

    // Create a directory for the new backup
    let dirPath = `${backupDir}/${startDate ? this.dateToDateString(startDate).split(':').join('.') : 'start'} to ${this.dateToDateString(new Date()).split(':').join('.')}`
    fs.mkdirSync(dirPath)

    // Generate and return the backup command to run
    return `${command} exportguild -g "${serverID}" -t "${DCEToken}"${startDate ? ` --dateformat "u" --after "${this.dateToDateString(startDate)}" ` : ' '}-o "${dirPath}" --media`
}

// Generate a command to return a list of accessible servers
module.exports.generateServerListCommand = (DCECLIDir, DCEToken) => {
    const command = this.returnDiscordChatExporterCLICommand(DCECLIDir)
    return `${command} guilds -t "${DCEToken}"`
}