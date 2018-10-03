/*
Small note: usually signaling servers comunicate with backend to notify about events
As we use firebase and don't need notifications, all backend-based stuff is left as is
and just returns "ok" insead of making backend API requests
*/
var request = require('request');
var config = require('getconfig');
var fs = require('fs');
// Emit result to client
var Result = require('./result.js');
// Main module
var Server = require('../server.js');
// Log
var Log = require('../models/log.js');
// Firebase
var Firebase = require('../models/firebase.js');

class User {

    constructor(socket) {
        var self = this;
        self.id = null;
        self.token = null;
        self.name = null;
        self.photo = null;
        self.video = null;
        self.alive = false;
        self.authorized = null;
        self.isHunting = false;
        self.huntingInterval = false;
        self.huntedWith = [];
        self.call = null;
        self.apiCode = null;
        self.apiMessage = null;
        self.socket = null;
        self.socketInstance = null;
        //this.socketId = null;
        self.redisKey = '';
        self.huntingListKey = 'huntingUserList';
        if (socket) {
            self.socket = socket.id;
            self.getRedisKey();
        } else {
            self.socket = null;
        }
    }

    /*
    * Authorize user
    *
    * @param id             String
    * @param password       String      Password or Firebase token
    * @param callback       Function
    *
    * @return bool
    */
    authorize(token, callback) {
        var self = this;
        // Backend-based auth
        var url = config.backend.host + '/v1/user/check';
        var params = {'hash': token};
        self.request(url, params, function(data) {
            console.log(data);
            if (data.status == 200) {
                Log.error('Auth error');
                Log.error(data);
                self.delete();
                callback(self);
                return false;
            }
            self.id = Math.round(Math.random() * 100000);
            self.token = token;
            /*
            self.name = data.data.name;
            self.photo = data.data.avatar;
            self.video = data.data.video;
            */
            self.authorized = true;
            self.call = null;
            self.save();
            callback(self);
        }, function(code, message) {
            self.authorized = false;
            self.call = null;
            if (self.socketInstance) {
                self.socketInstance.disconnect(true);
                self.socketInstance = null;
            }
            //self.socket = null;
            self.delete();
            Log.error('Auth error');
            Log.error(code);
            callback(self);
        });
    };

    /*
    * Notify backend about user disconnect
    *
    * @param callback       Function
    *
    * As we don't use backend now, this method just return "ok" for all requests
    *
    * @return bool
    */
    disconnect(callback) {
        var self = this;
        Server.server.users[self.id] = null;
        self.removeFromHuntingList();
        // Request API
        var url = config.backend.host + '/user/disconnected/';
        var params = {'id': self.id};
        self.request( url, params, function(data) {
            self.id = null;
            self.call = null;
            self.authorized = false;
            self.save();
            callback(self);
        }, function(code, message) {
            self.id = null;
            self.call = null;
            self.authorized = false;
            self.delete();
            Log.error('Error');
            Log.error(code);
            callback(self);
        });
    };

    /*
    * Request to backend about new call
    *
    * @param recipientId    String
    * @param callId         Int
    * @param callback       Function
    *
    * As we don't use backend now, this method just return "ok" for all requests
    *
    * @return bool
    */
    makeCall(recipientId, callId, callback) {
        var self = this;
        var url = config.backend.host + '/call/start';
        var params = {'user': self.id, 'recipient': recipientId, 'call': callId};
        self.request( url, params, function(data) {
            callback(data);
        }, function(code, message) {
            Log.error('Error join');
            Log.error(code);
            callback({});
        });
    };


    /*
    * Notify backend about accepted call
    *
    * @param call           Int
    * @param callback       Function
    *
    * As we don't use backend now, this method just return "ok" for all requests
    *
    * @return bool
    */
    accept(call, callback) {
        var self = this;
        var url = config.backend.host + '/v1/call/accepted';
        var params = {'user': self.id, 'call': call.id};
        //Log.message(params);
        self.request( url, params, function(data) {
            callback(data);
        }, function(code, message) {
            Log.error('Error join');
            Log.error(code);
            callback({});
        });
    };

    /*
    * Notify backend about rejected call
    *
    * @param call           Int
    * @param callback       Function
    *
    * As we don't use backend now, this method just return "ok" for all requests
    *
    * @return bool
    */
    reject(call, callback) {
        var self = this;
        var url = config.backend.host + '/v1/call/rejected';
        var params = {'user': self.id, 'call': call.id};
        //Log.message(params);
        self.request( url, params, function(data) {
            callback(self, data);
        }, function(code, message) {
            Log.error('Error join');
            Log.error(code);
            callback(self, {});
        });
    };

    /*
    * Notify backend about hangup
    *
    * @param call           Int
    * @param callback       Function
    *
    * As we don't use backend now, this method just return "ok" for all requests
    *
    * @return bool
    */
    hangup(call, callback) {
        var self = this;
        var url = config.backend.host + '/v1/call/finished';
        var params = {'user': self.id, 'call': call.id};
        //Log.message(params);
        self.request( url, params, function(data) {
            callback(self, data);
        }, function(code, message) {
            Log.error('Error join');
            Log.error(code);
            callback(self, {});
        });
    };

    /*
    * Get user for random mode
    *
    * @param callback function
    *
    * @return User object
    */
    goHunting(callback) {
        var self = this;
        if (!self.isHunting) {
            callback('User not in hunting mode');
            return false;
        }
        self.getHuntingList(function(error, list) {
            if (error) {
                callback(error);
                return false;
            }
            var found = false;
            delete list[self.id];
            var ids = Object.keys(list);
            if (!ids.length) {
                return false;
            }
            var userId = false;
            var huntedBefore = false;
            for (let i = ids.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [ids[i], ids[j]] = [ids[j], ids[i]];
            }
            console.log(ids);
            var somebodyFound = false;
            for (let i = 0; i < ids.length; i++) {
                userId = ids[i];
                console.log('>> 1 ' + userId);
                if (somebodyFound) {
                    return false;
                }
                Server.server.getUserById(userId, function(error, user) {
                    console.log('>> 2 ' + userId);
                    if (somebodyFound) {
                        return false;
                    }
                    console.log('>> 3 ' + userId);
                    if (user) {
                        console.log(user.id + ' - ' + user.isHunting);
                    }
                    if (error || !user || !user.isHunting) {
                        if (user && user.id) {
                            user.removeFromHuntingList();
                        }
                        return false;
                    }
                    console.log('>> 4 ' + userId);
                    if (self.huntedWith[userId]) {
                        console.log('>> 5 ' + userId);
                        huntedBefore = userId;
                        return false;
                    }
                    //console.log(user);
                    console.log('>> 6 ' + userId);
                    if (!somebodyFound) {
                        console.log('>> 7 ' + userId);
                        somebodyFound = true;
                        self.huntedWith[userId] = userId;
                        callback(false, user);
                        return false;
                    }
                });
            }
            /*
            do {
                userId = ids[Math.floor(Math.random()*ids.length)];
                delete ids[userId];
                Server.server.getUserById(userId, function(error, user) {
                    if (user) {
                        console.log(user.id + ' - ' + user.isHunting);
                    }
                    if (error || !user || !user.isHunting) {
                        if (user && user.id) {
                            user.removeFromHuntingList();
                        }
                        //callback(false, false);
                        return false;
                    }
                    if (self.huntedWith[userId]) {
                        huntedBefore = userId;
                        return false;
                    }
                    //console.log(user);
                    console.log('++++++++++++++++++++++++++');
                    self.huntedWith[userId] = userId;
                    callback(false, user);
                });
                found = true;
                console.log(ids.length);
            } while(ids.length);
            */
            // If we spoke with all active users — start new call with somebody we spoke before
            //console.log(userId);
            if (huntedBefore) {
                Server.server.getUserById(huntedBefore, function(error, user) {
                    if (error || !user || !user.isHunting) {
                        callback(false, false);
                    } else {
                        callback(false, user);
                    }
                });
            }
        });
    }

    /*
    * Make request to backend
    *
    * @param url            String
    * @param params         Object
    * @param whatToDo       Function    Callback function for successfull response
    * @param whatIfError    Function    Callback function for failed response
    *
    * As we don't use backend now, this method just return "ok" for all requests
    *
    * @return bool
    */
    request(url, params, whatToDo, whatIfError) {
        var self = this;
        // Just return "Ok"
        self.apiCode = 200;
        self.apiMessage = 'Ok';
        whatToDo('');
        return false;
        var options = {
            method: 'POST',
            uri: url,
            headers: {
              'Authorization': 'Token ' + config.backend.token,
            },
            json: params
        };
        console.log(options);
        request.post(options, function (error, response, body) {
            if (response) {
                self.apiCode = response.statusCode;
                self.apiMessage = '';
            } else {
                self.apiCode = 500;
                self.apiMessage = 'Backend connection refused';
                whatIfError(self);
                return false;
            }
            if (!error && response.statusCode === 200) {
                whatToDo(body);
            } else {
                var message = 'API requerst error: ' + response.statusCode;
                if( typeof body.detail != 'undefined' ) {
                    message += '<br />' + body.detail;
                }
                message += '<br />request: ' + JSON.stringify(options);
                self.apiMessage = message;
                if (whatIfError) {
                    whatIfError(self);
                } else if (self.socket) {
                    new Result().emit(self.socket, 'errorMessage', response.statusCode, self.apiMessage);
                }
            }
        });
    }

    getRedisKey() {
        var self = this;
        self.redisKey = self.id ? 'storedUser' + self.id : false;
    }

    save() {
        var self = this;
        if (!self.id) {
            return false;
        }
        self.getRedisKey();
        if (!self.redisKey) {
            return false;
        }
        var toStore = {
            'id': self.id,
            'token': self.token,
            'name': self.name,
            'photo': self.photo,
            'alive': self.alive,
            'authorized': self.authorized,
            'call': self.call,
            'isHunting': self.isHunting,
            'huntedWith': self.huntedWith,
            'socket': self.socket // ? self.socket.id : null
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
        if (!self.redisKey) {
            callback(null, self);
            return false;
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
                    self.token = data.token;
                    self.name = data.name;
                    self.photo = data.photo;
                    self.alive = data.alive;
                    self.authorized = data.authorized;
                    self.call = data.call;
                    self.socket = data.socket;
                    self.isHunting = data.isHunting;
                    self.huntedWith = data.huntedWith;

                    callback(null, self);
                } else {
                    Log.error('Error parsing user from redis: ' + id);
                    callback('Error parsing user from redis: ' + id, null);
                }
            } else {
                Log.error('Error reading user info from redis: ' + id);
                callback('Error reading user info from redis: ' + id, null);
            }
        });
    }

    delete(id) {
        var self = this;
        self.load(id, function() {
            self.deleteIncomingCallForUser();
            Server.server.redisClient.del(self.redisKey);
        });
    }

    deleteIncomingCallForUser() {
        var self = this;
        var key = 'incomingCallForUser' + self.id;
        Server.server.redisClient.del(key);
    }

    /*
    * Get list of hunting users
    *
    * @return bool
    */
    getHuntingList(callback) {
        var self = this;
        Server.server.redisClient.get(self.huntingListKey, function(error, data) {
            if (data) {
                try {
                    data = JSON.parse(data);
                } catch(e) {}
                if (data) {
                    var i;
                    var users = {};
                    for (var i in data) {
                        if (data[i]) {
                            users[i] = data[i];
                        }
                    }
                }
            }
            if (!users) {
                users = {};
            }
            callback(false, users);
        });
    }

    /*
    * Add user to online list
    *
    * @return bool
    */
    addToHuntingList() {
        var self = this;
        self.getHuntingList(function(error, users) {
            users[self.id] = self.id;
            var toStore = JSON.stringify(users);
            Server.server.redisClient.set(self.huntingListKey, toStore, function(){});
        })
    }

    /*
    * Remove user from online list
    *
    * @return bool
    */
    removeFromHuntingList() {
        var self = this;
        self.getHuntingList(function(error, users) {
            users[self.id] = null;
            var toStore = JSON.stringify(users);
            Server.server.redisClient.set(self.huntingListKey, toStore, function(){});
        })
    }
}

module.exports = User;
