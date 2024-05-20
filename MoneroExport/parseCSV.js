const fs = require('fs')

const transactions = fs.readFileSync(process.argv[2]).toString().trim().split('\n').map(line => line.split(',').map(p => p.trim()))

for (let i = 0; i < transactions.length; i++) {
    const dateStr = transactions[i][3].split(' ')[0]
    const description = transactions[i][1] === 'block' ? 'Monero Mining Dust' : transactions[i][1] === 'in' ? 'Monero Money In' : 'Monero Spent'
    const isExpense = transactions[i][1] === 'out'
    const type = isExpense ? 'Other Extra Expense' : 'Other Money In'
    const amount = transactions[i][4]
    console.log(`${dateStr}\t${description}${isExpense ? '\t\t' : '\t'}${amount}${isExpense ? '\t' : '\t\t'}XMR\t${type}`)
}