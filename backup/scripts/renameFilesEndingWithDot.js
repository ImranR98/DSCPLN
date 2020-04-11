const fs = require('fs');

let getAllFiles = (path) => {
    let results = [];
    fs.readdirSync(path).forEach((fileName) => {
        file = path + '/' + fileName;
        var stat = fs.statSync(file);
        stat && stat.isDirectory() ? results = results.concat(getAllFiles(file)) : results.push(file);
    });
    return results;
}

let renameDotFilesAndFolders = async (path) => {
    let allFiles = getAllFiles(path);
    let dotFolders = Array.from(new Set(allFiles.filter(file => file.indexOf('./') >= 0).map(file => file.substring(0, file.indexOf('./') + 1))))
    let dotFiles = allFiles.filter(file => file.endsWith('.'));
    let all = dotFiles.concat(dotFolders)
    for (let i = 0; i < all.length; i++) {
        let newPath = all[i].substring(0, all[i].lastIndexOf('.'));
        console.log(`Renaming ${all[i]} to ${newPath}`)
        await fs.rename(all[i], newPath, err => { if (err) throw err; else console.log('Renamed.') })
    }
}

if (!process.argv[2]) {
    throw 'No path given!'
}
renameDotFilesAndFolders(process.argv[2]).then(() => {

}).catch((err) => {
    throw err;
})