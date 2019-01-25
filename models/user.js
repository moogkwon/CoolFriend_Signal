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

  constructor (socket, callback) {
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
    self.huntingListKey = 'huntingUserSet';
    if (socket && socket.request) {
      self.socket = socket.id;
      self.device = socket.de;
      self.getRedisKey();
      self.save(function (err) {
        self.device = socket.request.headers['device-id'];
        if (!self.device) {
          if (socket.request.headers['auth-token']) {
            self.device = 'deviceFor' + socket.request.headers['auth-token'];
          } else {
            require('crypto').randomBytes(32, function (ex, buf) {
              self.device = buf.toString('base64').replace(/\//g, '_').replace(/\+/g, '-');
            });
          }
        }
        if (callback) {
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
  authorize (token, callback) {
    var self = this;
    // Backend-based auth
    var url = config.backend.host + '/v1/user/check';
    var params = { 'hash': token };
    self.request(url, params, function (data) {
      try {
        var raw = JSON.parse(data);
        for (let i in raw.data) {
          self[i] = raw.data[i];
          if (i == 'id') {
            self[i] = parseInt(self[i]);
          }
        }
      } catch (e) {
        return callback('Can`t get user details');
      };
      if (!raw || !raw.data || !raw.data.id) {
        return callback('Login failed');
      }
      self.removeFromHuntingList();
      // Kick old devices with the same user
      Log.message('checking user already signed ' + raw.data.id)
      Server.server.redisClient.hget(Server.server.redisTokenList, raw.data.id, (error, data) => {
        try {
          data = JSON.parse(data)
        } catch (e) { }
        Log.message('User from redis? ' + !!data);
        if (data) {
          new User().load(data.id, (error, existsUser) => {
            //if (!error && existsUser && existsUser.socket && self.socket != self.socket && self.device != self.device) {
            if (!error && existsUser && existsUser.socket && existsUser.socket != self.socket) {
              // Log.message('----------------------------------------------------------------')
              Log.message('Device id: ' + self.device + ' ' + existsUser.device)
              if (existsUser.device != self.device) {
                Log.message('Old device going to be kicked off');
                new Result().emit(existsUser.socket, '/v1/user/disconnect', 410, { 'status': 410, 'message': 'User logged on with another device', 'old': existsUser.socket, 'new': self.socket, 'old-device': existsUser.device, 'new': self.device })
              }
            }
            Log.message('Going to login')
            self.loggedIn(raw.data.id, token, callback);
          });
        } else {
          self.loggedIn(raw.data.id, token, callback);
        }
      });
    }, function (code, message) {
      if (self.socketInstance) {
        self.socketInstance.disconnect(true);
        self.socketInstance = null;
      }
      //self.socket = null;
      self.delete();
      Log.error('Auth error');
      Log.error(code);
      callback(currentUser.apiMessage);
    });
  };

  loggedIn (id, token, callback) {
    var self = this;
    self.id = id - 0;
    self.token = token;
    self.authorized = true;
    self.call = null;
    // Save user
    self.save();

    // Add device to list of connected devices
    var toStore = { 'id': self.id, 'token': self.token, 'device': self.device };
    Log.message('Adding device to redis ' + toStore.id + ' ' + toStore.device)
    toStore = JSON.stringify(toStore);
    Server.server.redisClient.hset(Server.server.redisTokenList, self.id, toStore);
    callback(null, self);
  }

  /*
  * Notify backend about user disconnect
  *
  * @param callback       Function
  *
  * As we don't use backend now, this method just return "ok" for all requests
  *
  * @return bool
  */
  disconnect (callback) {
    Log.message('Removing user socket: ' + self.id)
    var self = this;
    Server.server.users[self.id] = null;
    self.removeFromHuntingList();
    if (self.id) {
      Server.server.redisClient.hdel(Server.server.redisTokenList, self.id);
      Server.server.redisClient.hdel(config.redis.huntingListKey, self.id);
    }
    // Request API
    var url = config.backend.host + '/v1/user/disconnected/';
    var params = { 'id': self.id };
    self.request(url, params, function (data) {
      self.id = null;
      self.call = null;
      self.authorized = false;
      self.save();
      callback(self);
    }, function (code, message) {
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
  goOffline () {
    var self = this;
    if (self.id) {
      Server.server.redisClient.hdel(Server.server.redisTokenList, self.id);
    }
    // Request API
    var url = config.backend.host + '/v1/user/disconnected/';
    var params = { 'hash': self.token };
    self.request(url, params, function (data) {
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
  makeCall (callee, type, callback) {
    var self = this;
    var url = config.backend.host + '/v1/call/start';
    var params = { 'hash': self.token, 'type': type, 'callee': callee };
    self.request(url, params, function (data) {
      callback(data);
    }, function (code, message) {
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
  accept (call, callback) {
    var self = this;
    var url = config.backend.host + '/v1/call/accepted';
    var params = { 'hash': self.token, 'call': call.id };
    //Log.message(params);
    self.request(url, params, function (data) {
      callback(data);
    }, function (code, message) {
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
  reject (call, callback) {
    var self = this;
    var url = config.backend.host + '/v1/call/rejected';
    var params = { 'hash': self.token, 'call': call.id };
    //Log.message(params);
    self.request(url, params, function (data) {
      callback(self, data);
    }, function (code, message) {
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
  hangup (call, callback) {
    var self = this;
    var url = config.backend.host + '/v1/call/finished';
    var params = { 'hash': self.token, 'call': call.id };
    self.request(url, params, function (data) {
      if (callback) {
        callback(self, data);
      }
    }, function (code, message) {
      Log.error('Error join');
      Log.error(code);
      if (callback) {
        callback(self, {});
      }
    });
  };

  addFriend (friend, callback) {
    var self = this;
    var url = config.backend.host + '/v1/friend/add';
    var params = { 'hash': self.token, 'friend': friend };
    self.request(url, params, function (data) {
      try {
        data = JSON.parse(data);
        if (callback) {
          callback(null, data.are_friends);
        }
      } catch (e) { };
    }, function (code, message) {
      Log.error('Error in friend add');
      Log.error(code);
      if (callback) {
        callback(self, {});
      }
    });
  };

  isFriend (friend, callback) {
    var self = this;
    var url = config.backend.host + '/v1/friend/check';
    var params = { 'hash': self.token, 'friend': friend };
    self.request(url, params, function (data) {
      if (callback) {
        callback(null, data.is_friend);
      }
    }, function (code, message) {
      Log.error('Error in friend check');
      Log.error(code);
      if (callback) {
        callback(self, {});
      }
    });
  };

  removeFriend (friend, callback) {
    var self = this;
    var url = config.backend.host + '/v1/friend/remove';
    var params = { 'hash': self.token, 'friend': friend };
    self.request(url, params, function (data) {
      try {
        data = JSON.parse(data);
        if (callback) {
          callback(null, data.are_friends);
        }
      } catch (e) { };
    }, function (code, message) {
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
  goHunting (callback) {
    var self = this;
    self.getHuntingList(function (error, list) {
      if (error || !list) {
        Log.error(error);
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
      //var somebodyFound = false;
      for (let i = 0; i < ids.length; i++) {
        userId = ids[i];
        if (self.huntedWith[userId]) {
          //huntedBefore = userId;
          continue;
        }
        self.checkHunting(userId, (err, exists) => {
          if (exists) {
            self.removeFromHuntingList(userId, function () {
              self.huntedWith[userId] = userId;
              return callback(false, userId);
            });
          } else {
            return callback();
          }
        })
        return false;
      }
      // If we spoke with all active users — start new call with somebody we spoke before
      /*
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
      */
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
  request (url, params, whatToDo, whatIfError) {
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
        if (typeof body.detail != 'undefined') {
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

  getRedisKey () {
    var self = this;
    self.redisKey = self.id ? 'storedUser' + self.id : false;
  }

  save (callback) {
    var self = this;
    if (!self.id) {
      if (callback) {
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
    for (let i in params) {
      toStore[i] = params[i];
    }
    toStore = JSON.stringify(toStore);
    Server.server.redisLock('userDetail', (unlock) => {
      Server.server.redisClient.set(self.redisKey, toStore, function () {
        unlock();
        if (callback) {
          callback();
        }
      });
    });
  }

  load (id, callback) {
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
      Server.server.redisClient.get(self.redisKey, function (error, data) {
        unlock();
        if (data) {
          try {
            data = JSON.parse(data);
          } catch (e) {
            var message = e.message ? e.message : e;
            callback(message, null);
            return error;
          }
          if (data) {
            for (let i in data) {
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

  delete (id) {
    var self = this;
    if (!id) {
      id = self.id;
    }
    if (!self.getRedisKey) {
      self.getRedisKey();
    }
    self.id = null;
    self.authorized = false;
    if (self.id) {
      Server.server.redisClient.hdel(Server.server.redisTokenList, self.id);
      Server.server.redisClient.hdel(config.redis.huntingListKey, self.id);
    }
    //Server.server.redisLock('userDetail', (unlock) => {
    self.load(id, function () {
      self.deleteIncomingCallForUser();
      Server.server.redisClient.del(self.redisKey);
      //unlock();
    });
    //});
  }

  deleteIncomingCallForUser () {
    var self = this;
    var key = 'incomingCallForUser' + self.id;
    Server.server.redisClient.del(key);
  }

  /*
  * Get list of hunting users
  *
  * @return bool
  */
  getHuntingList (callback) {
    var self = this;
    Server.server.redisClient.hgetall(self.huntingListKey, (error, data) => {
      return callback(false, data);
    });
  }

  /*
  * Check if user is hunting now
  *
  * @return bool
  */
  checkHunting (id, callback) {
    var self = this;
    Server.server.redisClient.hget(self.huntingListKey, id, function (error, data) {
      return callback(false, data);
    });
  }

  /*
  * Add user to online list
  *
  * @return bool
  */
  addToHuntingList (callback) {
    var self = this;
    Server.server.redisClient.hset(self.huntingListKey, self.id, self.id, () => {
      callback();
    });
  }

  /*
  * Remove user from online list
  *
  * @return bool
  */
  removeFromHuntingList (id, callback) {
    var self = this;
    id = id ? id : self.id;
    if (!id) {
      return callback(false);
    }
    callback = callback ? callback : () => { };
    Server.server.redisClient.hdel(self.huntingListKey, id, function (error, data) {
      return callback(false, data);
    });
  }

  getUserForSend () {
    var self = this;
    var user = {};
    for (let i in self) {
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
