const fs = require('fs')

const simpleRequests = require('./simpleRequests')

const apiUrl1 = 'https://oauth.reddit.com/api/v1'
const apiUrl2 = 'https://oauth.reddit.com/user'

try {
    accessCreds = JSON.parse(fs.readFileSync('./access.json').toString())
} catch (err) {
    console.log('Could not read Access tokens.')
    process.exit()
}

let headers = {
    'Authorization': 'Bearer ' + accessCreds.access_token,
    'User-Agent': 'dydr/1.0 by Imran Remtulla'
}

const urlsToSave = [
    { url: 'me', api: apiUrl1 },
    { url: 'Webninja98/overview', api: apiUrl2 },
    { url: 'Webninja98/submitted', api: apiUrl2 },
    { url: 'Webninja98/comments', api: apiUrl2 },
    { url: 'Webninja98/upvoted', api: apiUrl2 },
    { url: 'Webninja98/downvoted', api: apiUrl2 },
    { url: 'Webninja98/hidden', api: apiUrl2 },
    { url: 'Webninja98/saved', api: apiUrl2 },
    { url: 'Webninja98/gilded', api: apiUrl2 }
]

const mergeListings = (listing1, listing2) => {
    let final = JSON.parse(JSON.stringify(listing1))
    listing2.data.children.forEach(item1 => {
        let found = false
        listing1.data.children.forEach(item2 => {
            if (item1.data.id == item2.data.id) found = true
        })
        if (!found) final.data.children.push(item2)
    })
    return final
}

const deleteDuplicatesFromListing = (listing) => {
    let final = JSON.parse(JSON.stringify(listing))
    final.data.children = []
    listing.data.children.forEach(item1 => {
        let found = false
        final.data.children.forEach(item2 => {
            if (item1.data.id == item2.data.id) found = true
        })
        if (!found) final.data.children.push(item1)
    })
    return final
}

const save = async (url, api, fileStoredIn) => {
    let filename = url.split('/').map(el => el.trim()).join('-')
    let res = JSON.parse((await simpleRequests.simpleHttpGet(`${api}/${url}`, headers)).body)
    if (res.message && res.error) {
        throw res
    }
    if (res.kind == 'Listing') {
        let subsequentResList = []
        while (res.data.after) {
            subsequentResList.push(JSON.parse((await simpleRequests.simpleHttpGet(`${api}/${url}?after=${res.data.after}`, headers)).body))
            res.data.after = subsequentResList[subsequentResList.length - 1].data.after
        }
        subsequentResList.forEach(sr => res.data.children.concat(sr.data.children))
    }
    res = {
        data: res,
        time: new Date().toISOString().replace(':', '-')
    }
    if (res.data.kind == 'Listing') {
        console.log('Recieved data of \'Listing\' type.')
        console.log('Saving to /Latest...')
        fs.writeFileSync(`${fileStoredIn}/Latest/${filename}.json`, JSON.stringify(res, null, '\t'))
        if (!fs.existsSync(`${fileStoredIn}/Oldest/${filename}.json`)) {
            console.log('Saving to /Oldest as it does not exist currently...')
            fs.writeFileSync(`${fileStoredIn}/Oldest/${filename}.json`, JSON.stringify(res, null, '\t'))
        }
        if (fs.existsSync(`${fileStoredIn}/${filename}-cumulative.json`)) {
            console.log('* cumulative file exists, will add new data to it...')
            res.data = mergeListings(JSON.parse(fs.readFileSync(`${fileStoredIn}/${filename}-cumulative.json`).toString()).data, res.data)
            res.data = deleteDuplicatesFromListing(res.data)
        }
        console.log('Saving to current directory...')
        fs.writeFileSync(`${fileStoredIn}/${filename}-cumulative.json`, JSON.stringify(res, null, '\t'))
    } else {
        console.log('Saving to /Latest...')
        fs.writeFileSync(`${fileStoredIn}/Latest/${filename}.json`, JSON.stringify(res, null, '\t'))
        if (!fs.existsSync(`${fileStoredIn}/Oldest/${filename}.json`)) {
            console.log('Saving to /Oldest as it does not exist currently...')
            fs.writeFileSync(`${fileStoredIn}/Oldest/${filename}.json`, JSON.stringify(res, null, '\t'))
        }
        console.log('Saving to current directory...')
        fs.writeFileSync(`${fileStoredIn}/${filename}.json`, JSON.stringify(res, null, '\t'))
    }
}

const run = async () => {
    if (process.argv.length <= 2) {
        console.log('Please provide the path to save files in the arguments.')
        process.exit()
    }
    let fileStoredIn = process.argv[2]
    let errs = false
    for (let i = 0; i < urlsToSave.length; i++) {
        console.log(`Getting '${urlsToSave[i].url}'...`)
        try {
            await save(urlsToSave[i].url, urlsToSave[i].api, fileStoredIn)
        } catch (err) {
            errs = true
            console.log(err)
        }
    }
    return errs
}

run().then(errs => errs ? console.log('Done with some errors (see above)') : console.log('Done.')).catch(err => console.log(err))