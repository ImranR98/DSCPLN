// Uses the Node requests and util module to provide functions for simple get/post http requests

const request = require('request')
const util = require('util')

module.exports.simpleHttpGet = async (url, headers = null, httpAuthCreds = null) => {
    let options = {
        url: url
    }
    if (headers) {
        options.headers = headers
    }
    return await util.promisify(request.get)(options)
}

module.exports.simpleHttpPost = async (url, body, headers = null) => {
    let options = {
        url: url,
        form: body
    }
    if (headers) {
        options.headers = headers
    }
    return await util.promisify(request.post)(options)
}