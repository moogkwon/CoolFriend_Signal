var config = require('getconfig');
var request = require('request');
// Log
var Log = require('./log.js');
var Server = require('../server.js');
var Result = require('./result.js');

class Call {

    constructor(data) {
        var self = this;
        self.id = null;
        self.status = 'new'; // 'answered', 'rejected', 'active', 'finished'
        self.video = null;
        self.users = [];
        self.offer = null;
        self.answer = null;
        self.iceCaller = [];
        self.iceRecipient = [];
        self.connectTimeout = false;
        self.redisKey = '';

        // Fill new call data
        if (data) {
            self.id = data.id ? data.id : (10000000 + Math.floor(Math.random() * 89999999));
            self.users.push(data.users[0]);
            self.users.push(data.users[1]);
            self.offer = data.offer;
            self.video = data.video;
            self.getRedisKey();
            self.save();
            // Add users to
            // Create a timeout for call
            self.connectTimeout = setTimeout(function() {
                self.load(self.id, function(error, data) {
                    // Call was deleted / not in "new" status? Don't send timeout
                    if(error || !data.id || data.status != 'new') {
                        return false;
                    }
                    var result = {'status': 200, 'message': 'Ok', 'call_id': self.id};
                    for(var k in self.users) {
                        if (self.users[k]) {
                            Server.server.getUserById(self.users[k], function(error, user) {
                                if (error) {
                                    Log.error('User not found for timeout: ' + self.users[k]);
                                }
                                if (user) {
                                    new Result().emit(user.socket, '/v1/call/call_timeout', 200, result);
                                }
                            });
                        }
                    }
                    Server.server.deleteCallById(self.id, function(error) {});
                });
            }, config.connectTimeout * 1000);
        }
    }

    getRedisKey() {
        var self = this;
        self.redisKey = 'storedCall' + self.id;
    }

    // remove call timeout if call was answered / rejected / hanguped
    removeConnectTimeout() {
        var self = this;
        clearTimeout(self.connectTimeout);
    }

    saveIncomingCallForUser() {
        var self = this;
        if (self.users[1]) {
            var key = 'incomingCallForUser' + self.users[1];
            Server.server.redisClient.set(key, self.id);
        }
    }

    getIncomingCallForUser(id, callback) {
        var self = this;
        if (id) {
            self.id = id;
            self.getRedisKey();
        }
        var key = 'incomingCallForUser' + self.users[1];
        Server.server.redisClient.get(key, function(error, id) {
            if (id) {
                self.load(id, function() {
                    return callback(null, self);
                });
            } else {
                callback(null, null);
            }
        });
    }

    deleteIncomingCallForUser() {
        var self = this;
        if (self.users[1]) {
            var key = 'incomingCallForUser' + self.users[1];
            Server.server.redisClient.del(key, key);
        }
    }

    save() {
        var self = this;
        var toStore = {
            'id': self.id,
            'users': self.users,
            'offer': self.offer,
            'answer': self.answer,
            'iceCaller': self.iceCaller,
            'video': self.video,
            'status': self.status
        };
        toStore = JSON.stringify(toStore);
        Server.server.redisClient.set(self.redisKey, toStore, function(){});
    }

    load(id, callback) {
        var self = this;
        if (id) {
            self.id = id;
            self.getRedisKey();
        }
        Server.server.redisClient.get(self.redisKey, function(error, data) {
            if (data) {
                try {
                    data = JSON.parse(data);
                } catch(e) {
                    var message = e.message ? e.message : e;
                    Log.error(message);
                    callback(message, null);
                    return error;
                }
                if (data) {
                    self.users = data.users;
                    self.offer = data.offer;
                    self.answer = self.answer;
                    self.iceCaller = self.iceCaller;
                    self.offer = data.offer;
                    self.status = data.status;
                    callback(null, self);
                } else {
                    Log.error('Error parsing call from redis: ' + id);
                    callback('Error parsing call from redis: ' + id, null);
                }
            } else {
                Log.error('Error reading call info from redis: ' + id);
                callback('Error reading call info from redis: ' + id, null);
            }
        });
    }

    updateStatus(status) {
        var self = this;
        self.deleteIncomingCallForUser();
        self.load(null, function() {
            self.status = status;
            self.save();
        });
    }

    delete(id, callback) {
        var self = this;
        self.load(id, function(error, call) {
            if (error) {
                callback(error);
            }
            self.deleteIncomingCallForUser();
            Server.server.redisClient.del(self.redisKey);
            callback(null);
        });
    }
}


module.exports = Call;
