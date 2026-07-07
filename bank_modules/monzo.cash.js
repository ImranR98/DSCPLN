export const extractEntries = (textItems) => {
    textItems = textItems.filter(t => t.str.trim().length > 0)

    const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/
    const amountRegex = /^-?\d+\.\d{2}$/
    const skipPhrases = ['This relates to a previous transaction']

    const entries = []

    for (let i = 0; i < textItems.length; i++) {
        const item = textItems[i]
        if (dateRegex.test(item.str) && Math.abs(item.transform[4] - 70.5) < 5) {
            const parts = item.str.split('/')
            const date = new Date(parts[2], parts[1] - 1, parts[0])
            i++

            let description = ''
            while (i < textItems.length && !amountRegex.test(textItems[i].str)) {
                const s = textItems[i].str.trim()
                if (s.length > 0 && !skipPhrases.includes(s)) {
                    description += (description.length > 0 ? ' ' : '') + s
                }
                i++
            }

            if (i < textItems.length) {
                const amount = parseFloat(textItems[i].str)
                i++
                if (i < textItems.length && amountRegex.test(textItems[i].str)) {
                    i++
                }

                entries.push({ date, description: description.trim(), amount })
                i--
            }
        }
    }

    return entries
}

export const validateFile = (textItems) => {
    if (textItems.filter(t => t.str.indexOf('Personal Account statement') >= 0).length == 0) {
        return null
    }

    const accIdx = textItems.findIndex(t => t.str.indexOf('Account number:') >= 0)
    if (accIdx < 0) {
        return null
    }
    const accNumberItem = textItems.slice(accIdx + 1).find(t => /^\d{8}$/.test(t.str))
    if (!accNumberItem) {
        return null
    }

    const dateRangeItem = textItems.find(t => /\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}/.test(t.str))
    if (!dateRangeItem) {
        return null
    }
    const endDateStr = dateRangeItem.str.split(' - ')[1]
    const parts = endDateStr.split('/')

    return {
        bank: 'Monzo',
        account: `Account ${accNumberItem.str} (Personal)`,
        date: new Date(parts[2], parts[1] - 1, parts[0])
    }
}
