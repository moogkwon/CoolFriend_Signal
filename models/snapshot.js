var fs = require('fs');
var Server = require('../server.js');
// Log
var Log = require('../models/log.js');

class Snapshot {

    constructor() {
        var self = this;
        self.snapshot = null;
        self.toStore = ['users'];
    }

    /*
    * Take actual server snapshot before storing
    *
    * @return bool
    */
    takeSnapshot() {
        var self = this;
        self.snapshot = {};
        var k,m,n;
        var cnt = 1000000;
        for (k in Server.server) {
            for (m in self.toStore) {
                if (k == self.toStore[m]) {
                    //self.snapshot[k] = Server.server[k];
                    if (k == 'users') {
                        self.snapshot.users = [];
                        for (n in Server.server[k]) {
                            var user = Server.server.users[n];
                            if (!user) {
                                continue;
                            }
                            if (user.socket || true) {
                                self.snapshot.users.push({
                                    'id': user.id,
                                    'token': user.token,
                                    'squad': user.squad,
                                    'squadPrivate': user.squadPrivate,
                                    'call': user.call,
                                    'deviceId': user.deviceId,
                                    'socketId': (user.socket ? user.socket.id : cnt++)
                                });
                            }
                        }
                    } else {
                        self.snapshot[k] = Server.server[k];
                    }
                }
            }
        }
    }

    /*
    * Save current snapshot
    *
    *
    * @return bool
    */
    save() {
        var self = this;
        self.takeSnapshot();
        var cache = [];
        var json = JSON.stringify(self.snapshot);
        fs.writeFile(__dirname + "/../snapshots/save.json", json, function(err) {
            if(err) {
                return console.log(err);
            }
        });
    }

    /*
    * Restore server data from snapshot
    *
    *
    * @return bool
    */
    restore() {
        var self = this;
        return false;
        fs.readFile(__dirname + "/../snapshots/save.json", function(err, json) {
            if(err) {
                return console.log(err);
            }
            try {
                var data = JSON.parse(json);
            } catch(e) {
                return false;
            }
            var k,n;
            for (k in data) {
                if (k == 'users') {
                    for (n in data[k]) {

                        Server.server.users[data[k][n].socketId] = {
                            'id': data[k][n].id,
                            'token': data[k][n].token,
                            'squad': data[k][n].squad,
                            'squadPrivate': data[k][n].squadPrivate,
                            'call': data[k][n].call,
                            'deviceId': data[k][n].deviceId,
                            'alive': new Date()
                        };
                    }
                } else {
                    Server.server[k] = data[k];
                }
            }
        });
    }
}

module.exports = new Snapshot();
