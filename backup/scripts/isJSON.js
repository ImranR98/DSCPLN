const fs = require('fs');

if (process.argv[2]) {
    if (fs.existsSync(process.argv[2])) {
        if (fs.statSync(process.argv[2]).isFile()) {
            try {
                JSON.parse(fs.readFileSync(process.argv[2]).toString())
                console.log('true')
            } catch (err) {
                console.log('false')
            }
        } else {
            console.log('Path does not point to a file.')
        }
    } else {
        console.log('Path is not valid.')
    }
} else {
    console.log('No file path provided.')
}