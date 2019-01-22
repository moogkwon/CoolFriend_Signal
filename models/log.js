var fs = require('fs');

class Log {
    /*
    * Store message in log
    *
    * @param message        String
    * @param ip             String
    *
    * @return bool
    */
    message(message, ip) {
        if (message && typeof message === 'object') {
            var cache = [];
            message = JSON.stringify(message, function(key, value) {
                if (typeof value === 'object' && value !== null) {
                    if (cache.indexOf(value) !== -1) {
                        // Circular reference found, discard key
                        return;
                    }
                    // Store value in our collection
                    cache.push(value);
                }
                return value;
            });
            cache = null; // Enable garbage collection
            //message = JSON.stringify(message);
        }
        message = typeof message == "string" ? message.substr(0, 1000) : '';
        var row = new Date().toISOString() + '\t' + (ip ? ip : '') + '\t' + message;
        console.log(row);
        // fs.appendFile(__dirname + "/../logs/server.log", row + "\r\n", function(err) {
        //     if(err) {
        //         return console.log(err);
        //     }
        // });
    }

    /*
    * Store error in log and duplicate it to message log
    *
    * @param message        String
    * @param ip             String
    *
    * @return bool
    */
    error(message, ip) {
        //TODO: Mark errors
        this.message(message, ip);
        if (message && typeof message === 'object') {
            var cache = [];
            message = JSON.stringify(message, function(key, value) {
                if (typeof value === 'object' && value !== null) {
                    if (cache.indexOf(value) !== -1) {
                        // Circular reference found, discard key
                        return;
                    }
                    // Store value in our collection
                    cache.push(value);
                }
                return value;
            });
            cache = null; // Enable garbage collection
            //message = JSON.stringify(message);
        }
        message = typeof message == "string" ? message.substr(0, 1000) : '';
        var row = new Date().toISOString() + '\t' + (ip ? ip : '') + '\t' + message;
        console.log(row);
        // fs.appendFile(__dirname + "/../logs/error.log", row + "\r\n", function(err) {
        // });
    }
}

module.exports = new Log();
