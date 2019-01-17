var config = require('getconfig')
// Core module
var Server = require('../server.js')

class Match {

    constructor(caller, callee, offer) {
        var self = this;
        self.caller = caller;
        self.callee = callee;
        self.offer = offer;
        self.approved = false;
        self.alive = new Date();
        self.redisKey = null;
        self.getRedisKey(caller, callee);
        self.save();
    }

    getRedisKey(userA, userB) {
        var self = this;
        if (userA > userB) {
            self.redisKey = 'storedMatch-' + userA + '-' + userB;
        } else {
            self.redisKey = 'storedMatch-' + userB + '-' + userA;
        }

    }

    save() {
        var self = this;
        var toStore = {
            'caller': self.caller,
            'callee': self.callee,
            'offer': self.offer,
            'approved': self.approved,
            'alive': self.alive
        };
        toStore = JSON.stringify(toStore);
        Server.server.redisClient.set(self.redisKey, toStore, function(){});
    }

    load(userA, userB, callback) {
        var self = this;
        self.getRedisKey(userA, userB);
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
                    self.caller = data.caller;
                    self.callee = data.callee;
                    self.offer = data.offer;
                    self.approved = data.approved;
                    self.alive = data.alive;
                    callback(null, self);
                } else {
                    Log.error('Error parsing call from redis: ' + self.redisKey);
                    callback('Error parsing call from redis: ' + self.redisKey, null);
                }
            } else {
                //Log.error('Error reading call info from redis: ' + self.redisKey);
                callback('Error reading call info from redis: ' + self.redisKey, null);
            }
        });
    }

    delete(userA, userB, callback) {
        var self = this;
        callback = callback ? callback : () => {};
        self.getRedisKey(userA, userB);
        self.load(userA, userB, function(error, call) {
            if (error) {
                callback(error);
            }
            Server.server.redisClient.del(self.redisKey);
            callback(null);
        });
    }
}


module.exports = Match;
