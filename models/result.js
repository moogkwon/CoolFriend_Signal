var fs = require('fs');
// Main module
var Server = require('../server.js');
// Log
var Log = require('../models/log.js');

class Result {
    constructor() {
        var self = this;
        self.code = 200;
        self.message = '';
        self.sessionId = '';
    }

    /*
    * Emit message to all connected users
    *
    * @param command        String
    * @param code           String
    * @param message        String / Object
    * @param sessionId      Int
    *
    * @return bool
    */
    emitToAll(command, code, message, sessionId) {
        var self = this;
        Server.server.io.sockets.adapter.clients(function(error, users) {
            users.forEach(function(socket) {
                self.emit(socket, command, code, message, sessionId);
            });
        });
    }

    /*
    * Emit message to socket
    *
    * @param socket         Socket.io instance
    * @param command        String
    * @param code           String
    * @param message        String / Object
    * @param sessionId      Int
    *
    * @return bool
    */
    emit(socket, command, code, message, sessionId) {
        console.log('Emit to' + socket);
        if (!socket) {
            return false;
        }
        // get user IP for logging
        var ip = null; // (socket && socket.handshake & socket.handshake.address) ? socket.handshake.address : null;
        // For all commands except alive — log responce
        if (command !== 'alive') {
            var logMessage = message;
            // Prepare object to save it to log
            if (logMessage && typeof logMessage === 'object') {
                var cache = [];
                logMessage = JSON.stringify(logMessage, function(key, value) {
                    if (typeof value === 'object' && value !== null) {
                        if (cache.indexOf(value) !== -1) {
                            return;
                        }
                        cache.push(value);
                    }
                    return value;
                });
                cache = null;
                logMessage = JSON.stringify(logMessage);
            }
            // Reduce logged message length
            logMessage = typeof logMessage == "string" ? logMessage.substr(0, 1000) : '';
            Log.message(command + ': ' + code + ' ' + logMessage, ip);
        }
        // Emit it
        if(Server.server.io.sockets.connected[socket]) {
            Server.server.io.sockets.connected[socket].emit(command, {'code': code, 'message': message, 'sessionId': sessionId });
        } else {
            Log.error('User with socket ' + socket + ' not connected');
        }
        //socket.emit(command, {'code': code, 'message': message, 'sessionId': sessionId });
    }
}

module.exports = Result;
