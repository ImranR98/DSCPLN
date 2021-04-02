// Import required modules
const XLSX = require('xlsx')
const fs = require('fs')

// Removes any text in brackets in the string - incomplete or nested bracket pairs may break this function
removeBrackets = (string) => {
    let i1 = 1
    let i2 = 1
    let i1b = 1
    let i2b = 1
    let stillBrackets = true
    while (i1 >= 0 && i2 >= 0 && i1b >= 0 && i2b >= 0 && stillBrackets) {
        stillBrackets = false
        i1 = string.indexOf('(')
        i2 = string.indexOf(')')
        if (i2 > i1) {
            stillBrackets = true
            let temp1 = string.slice(0, i1).trim()
            let temp2 = string.slice(i2 + 1).trim()
            string = temp1 + ' ' + temp2
        }
        i1b = string.lastIndexOf('(')
        i2b = string.lastIndexOf(')')
        if (i2b > i1b) {
            stillBrackets = true
            let temp1 = string.slice(0, i1b).trim()
            let temp2 = string.slice(i2b + 1).trim()
            string = temp1 + ' ' + temp2
        }
    }
    return string
}

// Capitalizes the first letter of every word in the string
titleCase = (str) => {
    let splitStr = str.toLowerCase().split(' ')
    for (let i = 0; i < splitStr.length; i++) {
        splitStr[i] = splitStr[i].charAt(0).toUpperCase() + splitStr[i].substring(1)
    }
    return splitStr.join(' ')
}

convertGoogleKeepHTMLtoLines = (googleKeepHTMLFilePath) => {
    let line = fs.readFileSync(googleKeepHTMLFilePath).toString().split('\n').filter(line => line.indexOf('<div class="content">') == 0)[0].substr(21)
    line = line.substr(0, line.length - 7)
    return line.split('<br>')
}

getLinesFromMD = (MDFilePath) => fs.readFileSync(MDFilePath).toString().split('\n').filter((line, index) => !!line.trim() && index > 0)

// Takes a single line of text and outputs an item
processLine = (line) => {
    try {
        if (typeof line == 'string') {
            line = line.trim()
            if (line.length > 0) {
                let sign = null
                if (line[0] == '+' || line[0] == '=' || '0123456789'.indexOf(line[0]) >= 0) {
                    if (line[0] == '+' || line[0] == '=') {
                        sign = line.slice(0, 1)
                        line = line.slice(1, line.length).trim()
                    }
                    let amount = Number.parseFloat(line.slice(0, line.indexOf(' ')))
                    let restOfString = line.slice(line.indexOf(' ')).trim()
                    let dateString = null
                    let dateIndex = restOfString.search("[0-9]{1,2} [0-9]{1,2}$")
                    if (dateIndex > 0) {
                        dateString = restOfString.slice(dateIndex).trim()
                        restOfString = restOfString.slice(0, dateIndex).trim()
                    } else {
                        dateIndex = restOfString.search("[0-9]{1,2} [0-9]{1,2} [0-9]{2,4}$")
                        if (dateIndex > 0) {
                            dateString = restOfString.slice(dateIndex).trim()
                            restOfString = restOfString.slice(0, dateIndex).trim()
                        }
                    }
                    if (restOfString.toLowerCase().indexOf('to') == 0 && restOfString.toLowerCase().indexOf('for') > 0) {
                        tempCut = restOfString.slice(0, restOfString.toLowerCase().indexOf('for')).trim()
                        if (tempCut.split(' ').length == 2) {
                            restOfString = restOfString.slice(restOfString.toLowerCase().indexOf('for') + 3)
                        }
                    }
                    if (restOfString.toLowerCase().indexOf('for') == 0 && restOfString.toLowerCase().indexOf('to') > 0) {
                        tempCut = restOfString.slice(0, (restOfString.toLowerCase().indexOf('to') + 2)).trim()
                        tempCut = tempCut.slice(3).trim()
                        tempCut = tempCut.slice(0, tempCut.toLowerCase().indexOf('to')).trim()
                        restOfString = tempCut
                    }
                    restOfString = removeBrackets(restOfString)
                    let date = null
                    if (dateString) {
                        dateString = dateString.trim()
                        dateString = dateString.replace(' ', '/')
                        if (dateString.split('/').length == 2) {
                            dateString += '/' + new Date().getFullYear()
                        }
                        date = new Date(dateString)
                    }
                    let item = {
                        details: titleCase(restOfString.trim()),
                        amount: amount,
                        date: date,
                        sign: sign
                    }
                    if (!item.amount || !item.details) return null
                    if (item.sign == '=') {
                        return null
                    }
                    if (item.sign == '+') item.amount *= -1
                    return item
                } else {
                    return null
                }
            }
        } else {
            return null
        }
    } catch (err) {
        console.log(err)
        return null
    }

}

// Takes an array of strings and outputs an array of items - if an item does not have a date, the last item's date is used
processLines = (lines) => {
    let items = []
    lines.forEach(line => items.push(processLine(line)))
    items = items.filter(item => !!item)
    items.forEach((item, index) => {
        if (!item.date) {
            if (items[index - 1]) item.date = items[index - 1].date
            if (index == 0) item.date = new Date()
        }
    })
    return items
}

// Finds the first empty cell in the given column letter and returns it's row number
findFirstEmptyCellInColumn = (column, worksheet) => {
    let rowNum = 0, emptyCellFound = false
    while (!emptyCellFound) !worksheet[column + ++rowNum] ? emptyCellFound = true : emptyCellFound = false
    return rowNum
}

// Takes a date object and returns a string of yyyy-mm-dd
formatDate = (date) => {
    if (date) {
        if (date.getTime) {
            date = date
            date = new Date(date)
            let dayString = (date.getDate()) + ''
            if (dayString.length == 1) {
                dayString = '0' + dayString
            }

            let monthString = (date.getMonth() + 1) + ''
            if (monthString.length == 1) {
                monthString = '0' + monthString
            }

            let year = date.getFullYear()

            return `${year}-${monthString}-${dayString}`
        }
    }
    return null
}

// Takes an array of items and writes them to an ExcelJS sheet
convertItemsToExcelReadyText = (items) => {
    let text = ''
    items.forEach((item) => {
        text += `${formatDate(item.date)}\t${item.details}\t`
        if (item.amount >= 0) text += "\t"
        text += `${item.amount < 0 ? item.amount * -1 : item.amount}\n`
    })
    return text
}

// Checks for the date of the last entry in the specified worksheet and filters out all items older than it
filterItemsByLastXLSXEntry = (items, worksheet) => {
    let lastRow = findFirstEmptyCellInColumn('A', worksheet)
    let lastDateCell = worksheet['A' + (lastRow - 1)]
    let latestDate = null
    if (lastDateCell) {
        try {
            latestDate = new Date(lastDateCell.w)
        } catch (err) {
            latestDate = null
        }
    }

    if (latestDate) {
        items = items.filter(item => item.date >= latestDate)
        let sameDate = true
        let currRow = lastRow

        let latestDateCount = 1
        let latestDateString = latestDate.getUTCFullYear() + '/' + latestDate.getUTCMonth() + '/' + latestDate.getUTCDate()
        while (sameDate) {
            currRow--
            if (currRow >= 0) {
                tempDate = new Date(worksheet['A' + currRow].w)
                if (typeof tempDate == 'object') {
                    tempDateString = tempDate.getUTCFullYear() + '/' + tempDate.getUTCMonth() + '/' + tempDate.getUTCDate()
                    if (tempDateString != latestDateString) {
                        sameDate = false
                    } else {
                        latestDateCount++
                    }
                } else {
                    sameDate = false
                }
            } else {
                sameDate = false
            }
        }
        let deletedCount = 0
        items = items.filter((item) => {
            itemDateString = item.date.getUTCFullYear() + '/' + item.date.getUTCMonth() + '/' + item.date.getUTCDate()
            if (itemDateString == latestDateString && deletedCount < latestDateCount) {
                deletedCount++
                return false
            } else {
                return true
            }
        })
    }
    return items
}

// Actual run
if (process.argv.length <= 3) {
    console.log('Please provide the path of the Acc.md and Balance.xlsx files as arguments, in that order.')
    process.exit()
}
let MDFilePath = process.argv[2]
let balanceXLSXLocation = process.argv[3]
console.log('Using Acc.md to generate text to paste into Balance.xlsx...')
console.log(convertItemsToExcelReadyText(
    filterItemsByLastXLSXEntry(
        processLines(
            getLinesFromMD(MDFilePath)
        ),
        XLSX.readFile(balanceXLSXLocation).Sheets['Transactions']
    )
))