// Default provider
// All providers must implement the getData and updateMonthlyBudget functions

// Reads expenses from a text file where each line is of the form '<amount> <description> <optional 'M D' date (if none, take from previous line)>'
// Stores the monthly budget as a single number in a text file
// Stores a "first week bias" as a single number on the second line of the monthly budget file

const fs = require('fs')
const path = require('path')

const defaultDataFile = path.resolve(`${__dirname}/../data.txt`)

process.env['TEXTFILE_DATA_PROVIDER_DATA_PATH'] = process.env['TEXTFILE_DATA_PROVIDER_DATA_PATH'] || `${__dirname}/../data.txt`
process.env['TEXTFILE_DATA_PROVIDER_BUDGET_PATH'] = process.env['TEXTFILE_DATA_PROVIDER_BUDGET_PATH'] || `${__dirname}/../budget.txt`

const dataFile = path.resolve(process.env['TEXTFILE_DATA_PROVIDER_DATA_PATH'])
const budgetFile = path.resolve(process.env['TEXTFILE_DATA_PROVIDER_BUDGET_PATH'])

const checkFile = (file, createIfMissing, contentIfCreated = '') => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        if (createIfMissing) {
            fs.writeFileSync(file, contentIfCreated)
        } else {
            throw new Error(`File does not exist: ${file}`)
        }
    }
}

checkFile(dataFile, dataFile == defaultDataFile, '')
checkFile(budgetFile, true,
    `${(process.env['TEXTFILE_BUDGET_INIT_AMT'] || '2400')}\n${(process.env['TEXTFILE_FIRST_WEEK_BIAS_INIT_AMT'] || '1400')}`
)

const getMonthNumber = (date = new Date()) => (date.getMonth() + 1)

const getFirstDateOfCalWeek = (date, includePartial = false) => {
    const givenDate = new Date(date)
    let tempDate = new Date(givenDate)
    const thisSunday = new Date(tempDate.setDate(tempDate.getDate() - tempDate.getDay()))
    const dayOne = new Date(givenDate.getFullYear(), givenDate.getMonth(), 1)
    if (includePartial) {
        if (isPartialStartWeek(givenDate)) {
            return {
                date: dayOne,
                code: "partialStart"
            }
        } else if (isPartialEndWeek(givenDate)) {
            let d = new Date(thisSunday)
            d.setDate(d.getDate() - 7)
            return {
                date: d,
                code: "partialEnd"
            }
        } else if (isNextWeekPartialEnd(givenDate)) {
            return {
                date: thisSunday,
                code: "beforePartial"
            }
        } else if (wasLastWeekPartialStart(givenDate)) {
            return {
                date: dayOne,
                code: "afterPartial"
            }
        }
    }
    return {
        date: thisSunday,
        code: null
    }
}

const isPartialStartWeek = (date) => {
    const givenDate = new Date(date)
    const lastSat = getFirstDateOfCalWeek(date, false).date
    return lastSat.getMonth() < givenDate.getMonth() || lastSat.getFullYear() < givenDate.getFullYear()
}
const isPartialEndWeek = (date) => {
    const givenDate = new Date(date)
    const d = new Date(getFirstDateOfCalWeek(date, false).date)
    d.setDate(d.getDate() + 6)
    return d.getMonth() > givenDate.getMonth() || d.getFullYear() > givenDate.getFullYear()
}
const wasLastWeekPartialStart = (date) => {
    const d = new Date(getFirstDateOfCalWeek(date, false).date)
    d.setDate(d.getDate() - 1)
    return isPartialStartWeek(d)
}
const isNextWeekPartialEnd = (date) => {
    const d = new Date(getFirstDateOfCalWeek(date, false).date)
    d.setDate(d.getDate() + 7)
    return isPartialEndWeek(d)
}

function countFullWeeksInMonth(inputDate) {
    // Ensure the input is a valid Date object
    if (!(inputDate instanceof Date) || isNaN(inputDate)) {
        throw new Error('Invalid date input');
    }

    // Get the first day of the month
    const firstDayOfMonth = new Date(inputDate.getFullYear(), inputDate.getMonth(), 1);

    // Find the Sunday on or after the first day of the month
    const startOfWeek = new Date(firstDayOfMonth);
    startOfWeek.setDate(firstDayOfMonth.getDate() + ((7 - firstDayOfMonth.getDay()) % 7));

    // Get the last day of the month
    const lastDayOfMonth = new Date(inputDate.getFullYear(), inputDate.getMonth() + 1, 0);

    // Find the Saturday on or before the last day of the month
    const endOfWeek = new Date(lastDayOfMonth);
    endOfWeek.setDate(lastDayOfMonth.getDate() - ((lastDayOfMonth.getDay() + 1) % 7));

    // Calculate the number of full weeks
    const millisecondsInDay = 24 * 60 * 60 * 1000;
    const numberOfWeeks = Math.floor(Math.round((endOfWeek - startOfWeek) / millisecondsInDay) / 7) + 1;
    return numberOfWeeks;
}

const getTotalExpensesFromLines = (expenseLines) => expenseLines.reduce((prev, curr) => {
    return prev + Math.round(Number.parseFloat(curr.split(' ')[0]) * 100)
}, 0) / 100

// NOTE: A 'week' below is not a block of 7 days. It is one of:
// - A full week: A week starting on Sunday, ending on Saturday, where all days are in the same month
// - A full week + a preceding or upcoming partial week (partial weeks are Sun-Sat weeks that start or end in another month)
module.exports.getData = async (date = new Date()) => {
    const expenseLines = fs.readFileSync(dataFile).toString()
        .split('\r\n').join('\n').split('\n')
        .map(l => l.trim())
        .filter(l => l.match('^[0-9]+(\.[0-9]+)? '))
    const monthNum = getMonthNumber(date)
    const monthLinePattern = new RegExp(`(?:^| )${monthNum} [0-9]{1,2}$`)
    const weekStart = getFirstDateOfCalWeek(date, true)
    const weekStartNum = weekStart.date.getDate()
    const weekSpecialCode = weekStart.code
    const firstMonthLineIndex = expenseLines.findIndex(l =>
        l.match(monthLinePattern)
    )
    const firstWeekLineIndex = expenseLines.findIndex(l =>
        l.match(monthLinePattern) &&
        Number.parseInt(l.split(' ').reverse()[0]) >= weekStartNum
    )
    var lastMonthLineIndex = expenseLines.findIndex((l, i) =>
        i > firstMonthLineIndex &&
        l.match(`[0-9]{1,2} [0-9]{1,2}$`) &&
        (
            !l.match(monthLinePattern) ||
            Number.parseInt(l.split(' ').reverse()[0]) > date.getDate() + 1
        )
    )
    if (lastMonthLineIndex < 0) {
        lastMonthLineIndex = undefined
    }
    var lastWeekLineIndex = expenseLines.findIndex((l, i) =>
        i > firstWeekLineIndex &&
        l.match(`[0-9]{1,2} [0-9]{1,2}$`) &&
        (
            !l.match(monthLinePattern) ||
            Number.parseInt(l.split(' ').reverse()[0]) > Math.min(date.getDate() + 1, weekStartNum + 7)
        )
    )
    if (lastWeekLineIndex < 0) {
        lastWeekLineIndex = undefined
    }
    const thisMonthsExpenseLines = firstMonthLineIndex < 0 ? [] : expenseLines.slice(firstMonthLineIndex, lastMonthLineIndex)
    const thisWeeksExpenseLines = firstWeekLineIndex < 0 ? [] : expenseLines.slice(firstWeekLineIndex, lastWeekLineIndex)
    const budgetData = fs.readFileSync(budgetFile).toString().trim().split('\n').map(l => Number.parseFloat(l || 0))
    const monthlyBudget = budgetData[0] || 0
    const firstWeekBias = budgetData[1] || 0
    const normalWeeklyBudget = (monthlyBudget - firstWeekBias) / countFullWeeksInMonth(date)
    return {
        monthlyBudget,
        firstWeekBias,
        weeklyBudget: weekStartNum == 1 ?
            firstWeekBias + normalWeeklyBudget :
            normalWeeklyBudget,
        weekSpecialCode,
        monthsSpend: getTotalExpensesFromLines(thisMonthsExpenseLines),
        weeksSpend: getTotalExpensesFromLines(thisWeeksExpenseLines),
        extraData: thisMonthsExpenseLines
    }
}

module.exports.updateMonthlyBudget = async (monthlyBudget, firstWeekBias) => {
    const budget = Number.parseFloat(monthlyBudget)
    const bias = Number.parseFloat(firstWeekBias)
    if (!Number.isFinite(budget) || budget < 0 || !Number.isFinite(bias) || bias < 0) {
        throw new Error('Invalid budget values')
    }
    const tempBudgetFile = `${budgetFile}.tmp`
    fs.writeFileSync(tempBudgetFile, `${budget.toString()}\n${bias.toString()}`)
    fs.renameSync(tempBudgetFile, budgetFile)
}