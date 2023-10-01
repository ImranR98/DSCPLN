// Default provider
// All providers must implement the getData and updateMonthlyBudget functions

// Reads expenses from a text file where each line is of the form '<amount> <description> <optional 'M D' date (if none, take from previous line)>'
// Stores the monthly budget as a single number in a text file

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
checkFile(budgetFile, defaultBudgetFile, '1000')

const getCurrentMonthNumber = () => new Date().getMonth() + 1
const getFirstDayOfCurrentWeek = () => {
    var curr = new Date()
    return new Date(curr.setDate(curr.getDate() - curr.getDay())).getDate()
}

const getTotalExpensesFromLines = (expenseLines) => expenseLines.reduce((prev, curr) => {
    return prev + Number.parseFloat(curr.split(' ')[0])
}, 0)

module.exports.getData = async () => {
    const expenseLines = fs.readFileSync(dataFile).toString()
        .split('\r\n').join('\n').split('\n')
        .map(l => l.trim())
        .filter(l => l.match('^[0-9]+(\.[0-9]+)? '))
    const monthNum = getCurrentMonthNumber()
    const weekStartNum = getFirstDayOfCurrentWeek()
    const firstMonthLineIndex = expenseLines.findIndex(l =>
        l.match(`${monthNum} [0-9]{1,2}$`)
    )
    const firstWeekLineIndex = expenseLines.findIndex(l =>
        l.match(`${monthNum} [0-9]{1,2}$`) &&
        Number.parseInt(l.split(' ').reverse()[0]) >= weekStartNum
    )
    const thisMonthsExpenseLines = expenseLines.slice(firstMonthLineIndex)
    return {
        monthlyBudget: Number.parseFloat(fs.readFileSync(budgetFile).toString().trim()),
        monthsSpend: getTotalExpensesFromLines(thisMonthsExpenseLines),
        weeksSpend: getTotalExpensesFromLines(expenseLines.slice(firstWeekLineIndex)),
        extraData: thisMonthsExpenseLines
    }
}

module.exports.updateMonthlyBudget = async (monthlyBudget) => {
    fs.writeFileSync(budgetFile, Number.parseFloat(monthlyBudget).toString())
}