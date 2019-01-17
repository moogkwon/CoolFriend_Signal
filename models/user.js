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

    constructor(socket, callback) {
        var self = this;
        self.id = null;
        self.token = null;
        self.hash = null;
        self.name = null;
        self.photo = null;
        self.video = null;
        self.alive = false;
        self.authorized = null;
        self.authorizing = false;
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
        if (socket && socket.request) {
            self.socket = socket.id;
            self.device = socket.de;
            self.getRedisKey();
            self.save(function(err) {
                self.device = socket.request.headers['device-id'];
                if (!self.device) {
                    if (socket.request.headers['auth-token']) {
                        self.device = 'deviceFor' + socket.request.headers['auth-token'];
                    } else {
                        require('crypto').randomBytes(32, function(ex, buf) {
                            self.device = buf.toString('base64').replace(/\//g,'_').replace(/\+/g,'-');
                        });
                    }
                }
                if(callback) {
                    callback(null, self);
                }
            });
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
            //self.delete();
            if (data.status == 200) {
                Log.error('Auth error');
                Log.error(data);
                self.delete();
                callback(self);
                return false;
            }
            //self.id = Math.round(Math.random() * 100000);
            try {
                var raw = JSON.parse(data);
                for(let i in raw.data) {
                    self[i] = raw.data[i];
                    if (i == 'id') {
                        self[i] = parseInt(self[i]);
                    }
                }
            } catch(e) {
                console.log(e);
            };
            self.token = token;
            self.id = self.id - 0;
            if (!self.id) {
                Log.error('Auth error');
                Log.error(data);
                self.delete();
                callback(self);
                return false;
            }
            // Add device to list of connected devices
            var toStore = {'id': self.id, 'token': token, 'device': self.device};
            toStore = JSON.stringify(toStore);
            Server.server.redisClient.hset(Server.server.redisTokenList, token, toStore);

            /*
            self.name = data.data.name;
            self.photo = data.data.avatar;
            self.video = data.data.video;
            */
            self.authorized = true;
            self.call = null;
            // Save user
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
        if (self.token) {
            Server.server.redisClient.hdel(Server.server.redisTokenList, self.token);
        }
        // Request API
        var url = config.backend.host + '/v1/user/disconnected/';
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
    * Notify backend about user disconnect — light version
    *
    * @param callback       Function
    *
    * @return bool
    */
    goOffline() {
        var self = this;
        if (self.token) {
            Server.server.redisClient.hdel(Server.server.redisTokenList, self.token);
        }
        // Request API
        var url = config.backend.host + '/v1/user/disconnected/';
        var params = {'hash': self.token};
        self.request( url, params, function(data) {
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
    makeCall(callee, type, callback) {
        var self = this;
        var url = config.backend.host + '/v1/call/start';
        var params = {'hash': self.token, 'type': type, 'callee': callee};
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
        var params = {'hash': self.token, 'call': call.id};
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
        var params = {'hash': self.token, 'call': call.id};
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
        var params = {'hash': self.token, 'call': call.id};
        self.request( url, params, function(data) {
            if (callback) {
                callback(self, data);
            }
        }, function(code, message) {
            Log.error('Error join');
            Log.error(code);
            if (callback) {
                callback(self, {});
            }
        });
    };

    addFriend(friend, callback) {
        var self = this;
        var url = config.backend.host + '/v1/friend/add';
        var params = {'hash': self.token, 'friend': friend};
        self.request(url, params, function(data) {
            try {
                data = JSON.parse(data);
                if (callback) {
                    callback(null, data.are_friends);
                }
            } catch(e){};
        }, function(code, message) {
            Log.error('Error in friend add');
            Log.error(code);
            if (callback) {
                callback(self, {});
            }
        });
    };

    isFriend(friend, callback) {
        var self = this;
        var url = config.backend.host + '/v1/friend/check';
        var params = {'hash': self.token, 'friend': friend};
        self.request(url, params, function(data) {
            if (callback) {
                callback(null, data.is_friend);
            }
        }, function(code, message) {
            Log.error('Error in friend check');
            Log.error(code);
            if (callback) {
                callback(self, {});
            }
        });
    };

    removeFriend(friend, callback) {
        var self = this;
        var url = config.backend.host + '/v1/friend/remove';
        var params = {'hash': self.token, 'friend': friend};
        self.request(url, params, function(data) {
            try {
                data = JSON.parse(data);
                if (callback) {
                    callback(null, data.are_friends);
                }
            } catch(e){};
        }, function(code, message) {
            Log.error('Error in friend remove');
            Log.error(code);
            if (callback) {
                callback(self, {});
            }
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
            self.removeFromHuntingList(self.id, function() {
                console.error('You`re not hunting now');
                callback('User not in hunting mode');
            });
            return false;
        }
        self.getHuntingList(function(error, list) {
            if (error) {
                console.error('No hunting users', error);
                return callback(error);
            }
            var found = false;
            delete list[self.id];
            var ids = Object.keys(list);
            if (!ids.length) {
                return callback();
            }
            var userId = false;
            var huntedBefore = false;
            for (let i = ids.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [ids[i], ids[j]] = [ids[j], ids[i]];
            }
            var somebodyFound = false;
            for (let i = 0; i < ids.length; i++) {
                userId = ids[i];
                if (somebodyFound) {
                    break;
                }
                if (self.huntedWith[userId]) {
                    huntedBefore = userId;
                    continue;
                }
                somebodyFound = true;
                Server.server.getUserById(userId, function(error, user) {
                    if (error || !user || !user.isHunting) {
                        self.removeFromHuntingList(userId, function() {
                            return callback();
                        });
                    } else {
                        self.huntedWith[userId] = userId;
                        return callback(false, user);
                    }
                });
                return false;
            }
            // If we spoke with all active users — start new call with somebody we spoke before
            if (!somebodyFound && huntedBefore) {
                Server.server.getUserById(huntedBefore, function(error, user) {
                    if (error || !user || !user.isHunting) {
                        self.removeFromHuntingList(huntedBefore, function() {
                            return callback();
                        });
                    } else {
                        return callback(false, user);
                    }
                });
            } else {
                return callback();
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
        /*
        self.apiCode = 200;
        self.apiMessage = 'Ok';
        whatToDo('');
        return false;
        */
        var options = {
            method: 'POST',
            uri: url,
            headers: {
              'Authorization': 'Token ' + config.backend.token,
            },
            form: params
        };
        request.post(options, function (error, response, body) {
            if (response) {
                self.apiCode = response.statusCode;
                self.apiMessage = 'Ok';
            } else {
                self.apiCode = 500;
                self.apiMessage = 'Backend connection refused';
                whatIfError(self);
                return false;
            }
            if (!error && response.statusCode === 200) {
                whatToDo(body);
            } else {
                var message = 'API requerst error: ' + response.statusCode + ' / ' + error;
                if( typeof body.detail != 'undefined' ) {
                    message += '\n' + body.detail;
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

    save(callback) {
        var self = this;
        if (!self.id) {
            if(callback) {
                callback('No user ID set');
            }
            return false;
        }
        self.getRedisKey();
        if (!self.redisKey) {
            callback('No user ID set');
            return false;
        }
        var toStore = {
            //'id': self.id,
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
        var params = self.getUserForSend();
        for(let i in params) {
            toStore[i] = params[i];
        }
        toStore = JSON.stringify(toStore);
        Server.server.redisLock('userDetail', (unlock) => {
            Server.server.redisClient.set(self.redisKey, toStore, function(){
                unlock();
                if (callback) {
                    callback();
                }
            });
        });
    }

    load(id, callback) {
        var self = this;
        if (id) {
            self.id = id;
            self.getRedisKey();
        }
        if (!self.id || !self.redisKey) {
            callback(null, self);
            return false;
        }
        Server.server.redisLock('userDetail', (unlock) => {
            Server.server.redisClient.get(self.redisKey, function(error, data) {
                unlock();
                if (data) {
                    try {
                        data = JSON.parse(data);
                    } catch(e) {
                        var message = e.message ? e.message : e;
                        callback(message, null);
                        return error;
                    }
                    if (data) {
                        for(let i in data) {
                            self[i] = data[i];
                        }
                        return callback(null, self);
                    } else {
                        Log.error('Error parsing user from redis: ' + self.id);
                        callback('Error parsing user from redis: ' + self.id, null);
                    }
                } else {
                    //Log.error('Error reading user info from redis: ' + self.id);
                    callback('Error reading user info from redis: ' + self.id, null);
                }
            });
        });
    }

    delete(id) {
        var self = this;
        if (!id) {
            id = self.id;
        }
        if (!self.getRedisKey) {
            self.getRedisKey();
        }
        self.id = null;
        self.authorized = false;
        if (self.token) {
            Server.server.redisClient.hdel(Server.server.redisTokenList, self.token);
        }
        //Server.server.redisLock('userDetail', (unlock) => {
            self.load(id, function() {
                self.deleteIncomingCallForUser();
                Server.server.redisClient.del(self.redisKey);
                //unlock();
            });
        //});
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
            return callback(false, users);
        });
    }

    /*
    * Add user to online list
    *
    * @return bool
    */
    addToHuntingList(callback) {
        var self = this;
        Server.server.redisLock('huntingList', (unlock) => {
            self.getHuntingList(function(error, users) {
                users[self.id] = self.id;
                var toStore = JSON.stringify(users);
                Server.server.redisClient.set(self.huntingListKey, toStore, function(){
                    unlock();
                    return callback();
                });
            });
        });
    }

    /*
    * Remove user from online list
    *
    * @return bool
    */
    removeFromHuntingList(id, callback) {
        var self = this;
        id = id ? id : self.id;
        if (!id) {
            return false;
        }
        Server.server.redisLock('huntingList', (unlock) => {
            self.getHuntingList(function(error, users) {
                delete users[id];
                var toStore = JSON.stringify(users);
                Server.server.redisClient.set(self.huntingListKey, toStore, function(){
                    unlock();
                    if (callback) {
                        return callback();
                    }
                });
            });
        });
    }

    getUserForSend() {
        var self = this;
        var user = {};
        for(let i in self) {
            if (i == 'socket' || i == 'socketInstance' || i == 'token' || i == 'isHunting'
             || i == 'huntingInterval' || i == 'huntedWith' || i == 'apiCode' || i == 'apiMessage'
             || i == 'redisKey' || i == 'huntingListKey') {
                continue;
            }
            user[i] = self[i];
        }
        if (user.id) {
            user.id = Number(user.id);
        }
        return user;
    }
}

module.exports = User;
