// Default provider
// All providers must implement the getData and updateMonthlyBudget functions

// Reads expenses from a text file where each line is of the form '<amount> <description> <optional 'M D' date (if none, take from previous line)>'
// Stores the monthly budget as a single number in a text file
// Stores a "first week bias" as a single number on the second line of the monthly budget file

const fs = require('fs')
const path = require('path')

const defaultDataFile = path.resolve(`${__dirname}/../data.txt`)
const defaultBudgetFile = path.resolve(`${__dirname}/../budget.txt`)

process.env['TEXTFILE_DATA_PROVIDER_DATA_PATH'] = process.env['TEXTFILE_DATA_PROVIDER_DATA_PATH'] || `${__dirname}/../data.txt`
process.env['TEXTFILE_DATA_PROVIDER_BUDGET_PATH'] = process.env['TEXTFILE_DATA_PROVIDER_BUDGET_PATH'] || `${__dirname}/../budget.txt`

const dataFile = path.resolve(process.env['TEXTFILE_DATA_PROVIDER_DATA_PATH'])
const budgetFile = path.resolve(process.env['TEXTFILE_DATA_PROVIDER_BUDGET_PATH'])

const checkFile = (file, createIfIsThis, contentIfCreated = '') => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        if (file == createIfIsThis) {
            fs.writeFileSync(file, contentIfCreated)
        } else {
            throw `File does not exist: ${file}`
        }
    }
}

checkFile(dataFile, defaultDataFile, '')
checkFile(budgetFile, defaultBudgetFile,
    `${(process.env['TEXTFILE_BUDGET_INIT_AMT'] || '2400')}\n${(process.env['TEXTFILE_FIRST_WEEK_BIAS_INIT_AMT'] || '1400')}`
)

const getMonthNumber = (date = new Date()) => (date.getMonth() + 1)

const getFirstDateOfCalWeek = (date, includePartial = false) => {
    const givenDate = new Date(date)
    let tempDate = new Date(givenDate)
    const thisSatDay = new Date(tempDate.setDate(tempDate.getDate() - tempDate.getDay()))
    const dayOne = new Date(thisSatDay)
    dayOne.setDate(1)
    if (includePartial) {
        if (isPartialStartWeek(givenDate)) {
            return {
                date: dayOne,
                code: "partialStart"
            }
        } else if (isPartialEndWeek(givenDate)) {
            let d = new Date(thisSatDay)
            d.setDate(d.getDate() - 7)
            return {
                date: d,
                code: "partialEnd"
            }
        } else if (isNextWeekPartialEnd(givenDate)) {
            return {
                date: thisSatDay,
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
        date: thisSatDay,
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
    startOfWeek.setDate(firstDayOfMonth.getDate() + (7 - firstDayOfMonth.getDay()));

    // Get the last day of the month
    const lastDayOfMonth = new Date(inputDate.getFullYear(), inputDate.getMonth() + 1, 0);

    // Find the Saturday on or before the last day of the month
    const endOfWeek = new Date(lastDayOfMonth);
    endOfWeek.setDate(lastDayOfMonth.getDate() - lastDayOfMonth.getDay() + 6);

    // Calculate the number of full weeks
    const millisecondsInWeek = 7 * 24 * 60 * 60 * 1000;
    const numberOfWeeks = Math.floor((endOfWeek - startOfWeek) / millisecondsInWeek);
    return numberOfWeeks;
}

const getTotalExpensesFromLines = (expenseLines) => expenseLines.reduce((prev, curr) => {
    return prev + Number.parseFloat(curr.split(' ')[0])
}, 0)

// NOTE: A 'week' below is not a block of 7 days. It is one of:
// - A full week: A week starting on Sunday, ending on Saturday, where all days are in the same month
// - A full week + a preceding or upcoming partial week (partial weeks are Sun-Sat weeks that start or end in another month)
module.exports.getData = async (date = new Date()) => {
    const expenseLines = fs.readFileSync(dataFile).toString()
        .split('\r\n').join('\n').split('\n')
        .map(l => l.trim())
        .filter(l => l.match('^[0-9]+(\.[0-9]+)? '))
    const monthNum = getMonthNumber(date)
    const weekStart = getFirstDateOfCalWeek(date, true)
    const weekStartNum = weekStart.date.getDate()
    const weekSpecialCode = weekStart.code
    const firstMonthLineIndex = expenseLines.findIndex(l =>
        l.match(`${monthNum} [0-9]{1,2}$`)
    )
    const firstWeekLineIndex = expenseLines.findIndex(l =>
        l.match(`${monthNum} [0-9]{1,2}$`) &&
        Number.parseInt(l.split(' ').reverse()[0]) >= weekStartNum
    )
    var lastMonthLineIndex = expenseLines.findIndex((l, i) =>
        i > firstMonthLineIndex &&
        l.match(`[0-9]{1,2} [0-9]{1,2}$`) &&
        (
            !l.match(`${monthNum} [0-9]{1,2}$`) ||
            Number.parseInt(l.split(' ').reverse()[0]) > date.getDate() + 1
        )
    )
    if (lastMonthLineIndex < 0) {
        lastMonthLineIndex = undefined
    }
    var lastWeekLineIndex = expenseLines.findIndex((l, i) =>
        i > firstWeekLineIndex &&
        l.match(`[0-9]{1,2} [0-9]{1,2}$`) &&
        Number.parseInt(l.split(' ').reverse()[0]) > Math.min(date.getDate() + 1, weekStartNum + 7)
    )
    if (lastWeekLineIndex < 0) {
        lastWeekLineIndex = undefined
    }
    const thisMonthsExpenseLines = expenseLines.slice(firstMonthLineIndex, lastMonthLineIndex)
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
        weeksSpend: getTotalExpensesFromLines(expenseLines.slice(firstWeekLineIndex, lastWeekLineIndex)),
        extraData: thisMonthsExpenseLines
    }
}

module.exports.updateMonthlyBudget = async (monthlyBudget, firstWeekBias) => {
    fs.writeFileSync(budgetFile,
        `${Number.parseFloat(monthlyBudget || 0).toString()}\n${Number.parseFloat(firstWeekBias || 0).toString()}`
    )
}