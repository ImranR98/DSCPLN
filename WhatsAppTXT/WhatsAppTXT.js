const fs = require('fs')

// Finds text files in a dir
const getTxts = (dir) => fs.readdirSync(dir).filter(fil => !fs.statSync(`${dir}/${fil}`).isDirectory() && fil.toLowerCase().endsWith('.txt'))

// Given a list of files in a dir, removes common prefixes from those files and return the result
const cleanFileNames = (dir, txts) => txts.map(txt => {
    let regexRes1 = /^WhatsApp Chat with /.exec(txt) // Android Export
    let regexRes2 = /^[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[1-2][0-9]|3[0-1]) - /.exec(txt) // Previous Backup
    let regexRes3 = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}-/.exec(txt) // iPhone Export
    let res = regexRes1 ? regexRes1 : regexRes2 ? regexRes2 : regexRes3 ? regexRes3 : null
    const finalName = res && txt.length > res[0].length + 4 ? txt.slice(res[0].length) : txt
    if (finalName !== txt) fs.renameSync(`${dir}/${txt}`, `${dir}/${finalName}`)
    return finalName
})

// Returns a numerical value for the given line if it is a "date line", else return null
const returnDateLineIfValid = (line) => {
    line = line.normalize('NFKD') // Some versions use weird nbsp
    const androidRegex = /^[0-9]{4}-[0-9]{2}-[0-9]{2}, [0-9]{1,2}:[0-9]{1,2} [a-p]\.[a-p]\. /.exec(line)
    const newAndroidRegex = /^[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2}, [0-9]{1,2}:[0-9]{1,2} [A-P]{2}/.exec(line)
    const iphoneRegex = /^\[[0-9]{4}-[0-9]{2}-[0-9]{2}, [0-9]{1,2}:[0-9]{1,2}:[0-9]{1,2} [A-P]{2}\] /.exec(line)
    const resultString = androidRegex ? androidRegex[0].slice(0, -1).replace('.m', 'm') : iphoneRegex ? iphoneRegex[0].slice(1, -2) : newAndroidRegex ? newAndroidRegex[0] : null
    return resultString ? new Date(resultString).valueOf() : null
}

// Returns a 2-item array with the values of the first and last date lines for the given lines array (returns null if no values found)
const returnFirstLastDates = (lines) => {
    let result = []
    lines.forEach((line, i) => {
        let temp = returnDateLineIfValid(line)
        if (temp) {
            if (result.length == 0) {
                result.push(temp)
                result.push(temp)
            } else {
                if (temp < result[0]) result[0] = temp
                if (temp > result[1]) result[1] = temp
            }
        }
    })
    return result.length == 2 ? result : null
}

// Merge two TXT files
// - Find the first and last "date lines" of both files
// - If one has both older start date AND newer end date, return that (if both equal, return cont1)
// - Else, start copying whichever has the older start date until it's end. Then, go to that end date in the other file and copy from there until end.
const mergeContents = (cont1, cont2) => {
    const [lines1, lines2] = [cont1.split('\n'), cont2.split('\n')]
    const [dates1, dates2] = [returnFirstLastDates(lines1), returnFirstLastDates(lines2)]
    if (!dates1 && !dates2) throw 'Date 1 and Date 2 both null!'
    if (dates1 == null) return [cont2, dates2[1]]
    if (dates2 == null) return [cont1, dates1[1]]
    if (dates1[0] <= dates2[0] && dates1[1] >= dates2[1]) return [cont1, dates1[1]]
    if (dates2[0] < dates1[0] && dates2[1] > dates1[1]) return [cont2, dates2[1]]
    const didStartWithCont1 = dates1[0] <= dates2[0]
    const otherFile = didStartWithCont1 ? lines2 : lines1
    let ind = -1
    for (let i = 0; i < otherFile.length && ind < 0; i++) {
        let num = returnDateLineIfValid(otherFile[i])
        if (num && num > (didStartWithCont1 ? dates1[1] : dates2[1])) ind = i
    }
    return [(didStartWithCont1 ? lines1 : lines2).concat(otherFile.slice(ind)).join('\n'), didStartWithCont1 ? dates2[1] : dates1[1]]
}

// Gets a YYYYMMDD string from a timestamp
const ts2ds = (ts) => {
    const twoDigits = (num) => (num <= 9 ? '0' : '') + num.toString()
    const dat = new Date(ts)
    return `${dat.getFullYear()}${twoDigits(dat.getMonth() + 1)}${twoDigits(dat.getDate())}`
}

// Main function
const main = (dirs) => {
    // NOTE: FIRST DIR IN ARRAY IS TREATED DIFFERENTLY - Previous files are deleted and new ones placed there

    // Construct the map of each file name to an array of folders which have that file name
    const files = new Map()
    dirs.forEach((dir, i) => {
        cleanFileNames(dir, getTxts(dir)).forEach(txt => {
            if (files.has(txt)) {
                files.get(txt).push(dir)
            } else {
                files.set(txt, [dir])
            }
        })
    })
    
    // For each file in the map, merge all versions of it from all folders that contain it and save as a new timestamped file, deleting any old ones
    files.forEach((ds, txt) => {
        let content = ''
        ds.forEach(folder => {
            try {
                [content, timestamp] = mergeContents(content, fs.readFileSync(`${folder}/${txt}`).toString())
            } catch (e) {
                throw { txt, e }
            }
        })
        if (timestamp == null) throw 'Timestamp is null!'
        if (fs.existsSync(`${dirs[0]}/${txt}`)) {
            fs.unlinkSync(`${dirs[0]}/${txt}`)
        }
        fs.writeFileSync(`${dirs[0]}/${ts2ds(timestamp)} - ${txt}`, content)
    })
}

// Actual run
try {
    if (process.argv.length < 3) throw `Usage: [command] [WhatsApp TXT backup directory] [additional directory to merge TXT files from (optional)] [additional directory 2 (optional)] ...`
    const dirs = process.argv.slice(2)
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) throw `Directory does not exist: ${dir}`
    })
    main(dirs)
} catch (err) {
    console.error(err)
    process.exit(-1)
}


