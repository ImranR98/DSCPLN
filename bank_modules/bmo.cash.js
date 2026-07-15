export const extractEntries = (textItems) => {
    if (textItems.filter(t => t.str.indexOf('BMO Financial Group') >= 0).length > 0) {
        return extractEntriesOld(textItems)
    }
    return extractEntriesNew(textItems)
}

const extractEntriesOld = (textItems) => {
    const year = textItems.filter(t => /^For the period ending .+/.test(t.str))[0].str.slice(-4)
    textItems = textItems.slice(
        textItems.findIndex(t => t.str.indexOf('Opening balance') >= 0) + 4,
        textItems.findIndex(t => t.str.indexOf('Closing totals') >= 0) - 2
    )
    const finalItems = []
    for (let i = 0; i < textItems.length; i++) {
        if (/^[A-Z][a-z]{2} [0-9]{2}$/.test(textItems[i].str)) {
            const date = new Date(`${textItems[i].str} ${year}`)
            i += 2
            let description = ''
            while (textItems[i].str.trim().length > 0) {
                description += textItems[i].str
                i++
            }
            description = description.trim()
            i++
            const amount = parseFloat(textItems[i].str.split(',').join('')) * (textItems[i + 1].width > 100 ? -1 : 1)
            i++
            finalItems.push({ date, description, amount })
        }
    }
    return finalItems
}

const extractEntriesNew = (textItems) => {
    const year = textItems.filter(t => /^For the period ending .+/.test(t.str))[0].str.slice(-4)
    const dateRegex = /^[A-Z][a-z]{2} [0-9]{2}$/
    const amountRegex = /^[0-9,]+\.[0-9]{2}$/

    const entries = []

    for (let i = 0; i < textItems.length; i++) {
        if (!dateRegex.test(textItems[i].str)) continue
        if (textItems[i].transform[4] > 100) continue

        if (i + 2 < textItems.length) {
            const nextLabel = textItems[i + 2].str
            if (nextLabel == 'Opening balance' || nextLabel == 'Closing totals') continue
        }

        const date = new Date(`${textItems[i].str} ${year}`)
        i += 2

        let description = ''
        while (i < textItems.length && textItems[i].str.trim().length > 0) {
            description += textItems[i].str
            i++
        }
        description = description.trim()
        if (description.length == 0) continue

        while (i < textItems.length && textItems[i].str.trim().length == 0) {
            i++
        }

        if (i >= textItems.length || !amountRegex.test(textItems[i].str)) continue

        const amountStr = textItems[i].str
        const amountX = textItems[i].transform[4]
        const amount = parseFloat(amountStr.split(',').join(''))
        const signedAmount = amountX < 400 ? -amount : amount

        entries.push({ date, description, amount: signedAmount })
    }

    return entries
}

export const validateFile = (textItems) => {
    const isOldFormat = textItems.filter(t => t.str.indexOf('BMO Financial Group') >= 0).length > 0
    const isNewFormat = textItems.filter(t => t.str.indexOf('Your Everyday Banking statement') >= 0).length > 0

    if (!isOldFormat && !isNewFormat) {
        return null
    }

    const datePref = 'For the period ending '
    const dateStr = textItems.filter(t => t.str.indexOf(datePref) >= 0)[0].str.slice(datePref.length)

    if (isOldFormat) {
        let accItem = textItems.filter(t => t.str.indexOf(' Account # ') >= 0)[0]
        let accStr = null
        if (accItem) {
            const tempI = accItem.str.indexOf(' Account # ')
            accStr = `Account ${accItem.str.slice(tempI + 11)} (${accItem.str.slice(0, tempI)})`
        } else {
            accItem = textItems.filter(t => t.str.indexOf(' # ') >= 0)[0]
            if (!accItem) {
                return null
            }
            const tempI = accItem.str.indexOf(' # ')
            accStr = `Account ${accItem.str.slice(tempI + 4)} (${accItem.str.slice(0, tempI)})`
        }
        return {
            bank: 'BMO',
            account: accStr,
            date: new Date(dateStr)
        }
    }

    const primaryIdx = textItems.findIndex(t => t.str.indexOf('Primary Chequing Account') >= 0)
    let accStr = null
    if (primaryIdx >= 0) {
        const accNumItem = textItems.slice(primaryIdx + 1).find(t => t.str.indexOf('# ') >= 0)
        if (accNumItem) {
            accStr = `Account ${accNumItem.str.slice(2)} (Primary Chequing)`
        }
    }
    if (!accStr) {
        const accNumItem = textItems.find(t => /^# [0-9]/.test(t.str))
        if (accNumItem) {
            accStr = `Account ${accNumItem.str.slice(2)}`
        }
    }
    if (!accStr) {
        return null
    }

    return {
        bank: 'BMO',
        account: accStr,
        date: new Date(dateStr)
    }
}
