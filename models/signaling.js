var config = require('getconfig')
// Core module
var Server = require('../server.js')
// Result for socket.io requests
var Result = require('./result.js')
// Log
var Log = require('./log.js')
// Call
var Call = require('./call.js')
// User
var User = require('./user.js')
// Match
var Match = require('./match.js')
// Firebase
var Firebase = require('../models/firebase.js')

class Signaling {
  init (socket) {
    var self = this
    // Get current user for socket
    var fake = new User(socket, function (err, currentUser) {
      Log.message('Auth by header')
      var token = socket.request.headers['auth-token']
      Log.message(token)
      // Check if this device is connected
      self.login(currentUser, { token: token })
      // if (socket.request.headers['auth-token']) {
      // }

      // Catch all requests
      socket.use((packet, next) => {
        // Get command
        if (packet[0] == '/v1/alive') {
          socket.emit('/v1/alive', { 'message': 'Ok' })
          return false
        }
        var command = self.getCommand(packet, socket)
        if (!command) {
          return true
        }
        currentUser.load(false, function (error, caller) {
          if (!error && ((currentUser.authorized && currentUser.id) || command == 'user/login' || command == 'alive')) {
            self.processCommand(currentUser, command, packet)
          } else {
            //Log.message(error)
            //Log.message(currentUser)
            //Log.message(command)
            new Result().emit(currentUser.socket, 'errorMessage', 401, { 'status': 401, 'message': 'Unauthorized' })
          }
        })
      })

      socket.on('disconnect', function () {
        Log.message('User disconnected: ' + currentUser.id + ' ' + socket.id + ' ' + currentUser.token)
        currentUser.socket = null
        currentUser.goOffline()
        if (currentUser.id) {
          currentUser.removeFromHuntingList()
        }
        if (currentUser.call) {
          // currentUser.hangup(currentUser.call, function() {
          self.hangup(currentUser, { 'disconnected': true }, () => {
            Server.server.deleteUserById(currentUser.id)
          })
          /*
          setTimeout(function() {
              Server.server.deleteUserById(currentUser.id);
          }, 100);
          */
          // });
        } else {
          Server.server.deleteUserById(currentUser.id)
        }
      })

      // new Result().emit(currentUser.socket, '/v1/ready', 200, {'status': 200, 'message': 'Ok'});
    })
  }

  processCommand (currentUser, command, packet) {
    try {
      var self = this
      var data = packet[1]

      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch (e) {
          Log.error('Error parsing json')
          Log.error(e)
        }
      }

      // Kepp alive
      if (command == 'alive') {
        return self.alive(currentUser)
      }

      // Login
      if (command == 'user/login') {
        return self.login(currentUser, data)
      }

      // Logoff
      if (command == 'user/disconnect') {
        return self.disconnect(currentUser)
      }

      // Get new contacts
      if (command == 'contacts/preload') {
        return self.contacts(currentUser, data)
      }

      // Like profile
      if (command == 'profile/react') {
        return self.reactProfile(currentUser, data)
      }

      // Get new contacts
      if (command == 'hunting/start') {
        return self.goHunting(currentUser, data)
      }

      // Get new contacts
      if (command == 'hunting/stop') {
        return self.stopHunting(currentUser, data)
      }

      // Users matched in random mode - skip user
      if (command == 'matched/next') {
        return self.matchedNext(currentUser, data)
      }

      // Users matched in random mode - accept call
      if (command == 'matched/accept') {
        return self.matchedAccept(currentUser, data)
      }

      // Start call
      if (command == 'call/new') {
        return self.call(currentUser, data)
      }

      // Accept call
      if (command == 'call/accept') {
        return self.accept(currentUser, data)
      }

      // Reject call
      if (command == 'call/reject') {
        return self.reject(currentUser, data)
      }

      // Hangup call
      if (command == 'call/forget') {
        return self.forget(currentUser, data)
      }

      // Hangup call
      if (command == 'call/hangup') {
        return self.hangup(currentUser, data)
      }

      // Hold call
      if (command == 'call/hold') {
        return self.callHold(currentUser, data)
      }

      // Continue call
      if (command == 'call/continue') {
        return self.callContinue(currentUser, data)
      }

      // SDP offer
      if (command == 'sdp/offer') {
        return self.message('offer', currentUser, data)
      }

      // SDP answer
      if (command == 'sdp/answer') {
        return self.message('answer', currentUser, data)
      }

      // ICE
      if (command == 'sdp/ice') {
        return self.message('ice', currentUser, data)
      }

      if (command == 'call/reconnect') {
        return self.message('reconnect', currentUser, data)
      }

      if (command == 'user/list/online') {
        return self.userListOnline(currentUser, data)
      }

      if (command == 'friend/add') {
        return self.addFriend(currentUser, data)
      }
      if (command == 'friend/check') {
        return self.checkFriend(currentUser, data)
      }
      if (command == 'friend/remove') {
        return self.removeFriend(currentUser, data)
      }
      if (command == 'user/firebase-token') {
        return self.firebaseToken(currentUser, data)
      }
      if (command == 'payment/required') {
        return self.paymentMessage('required', currentUser, data)
      }
      if (command == 'payment/progress') {
        return self.paymentMessage('message', currentUser, data)
      }
      if (command == 'payment/done') {
        return self.paymentMessage('done', currentUser, data)
      }
    } catch (e) {
      var message = e.message ? e.message : e
      Log.error(message)
      new Result().emit(currentUser.socket, 'errorMessage', 500, { 'status': 500, 'message': message })
    }
  }

  /*
        * Alive ping/pong
        * Used to keep session active
        *
        * @param currentUser    User   Actual user
        */
  alive (currentUser) {
    new Result().emit(currentUser.socket, '/v1/alive', '200', { 'status': 200, 'message': 'Ok' })
  }

  /*
   * React profile
   *
   */
  reactProfile (currentUser, data) {
    Log.message('reaction', data)
    Server.server.getUserById(Number(data.id), function (error, target) {
      if (!error && target) {
        Log.message('reaction user found', target.id)
        new Result().emit(target.socket, '/v1/profile/react', '200', { 'status': 200, data })
        new Result().emit(currentUser.socket, '/v1/profile/reactSent', 200, { 'status': 200, 'message': 'Ok' })
      }
    })
  }

  /*
   * User login
   *
   * @param currentUser    User   Actual user
   * @param data           Array  Passed parameters
   *
   * @return bool
   */
  login (currentUser, data) {
    // if (currentUser.authorized || currentUser.authorizing) {
    //   Log.error('User is authorized ' + currentUser.socket + ' ' + currentUser.token)
    //   new Result().emit(currentUser.socket, '/v1/user/login', 400, { 'status': 400, 'message': 'User is authorized' })
    //   return false
    // }
    currentUser.authorizing = true
    if (!data.token) {
      currentUser.authorizing = false
      new Result().emit(currentUser.socket, '/v1/user/login', 400, { 'status': 400, 'message': 'No token passed' })
      return false
    }
    currentUser.authorize(data.token, function (err, user) {
      if (!currentUser.authorized) {
        currentUser.authorizing = false
        //Log.error('Authorization failed:' + currentUser.apiMessage)
        Log.error('User is authorized ' + currentUser.apiMessage + ' ' + currentUser.socket + ' ' + currentUser.token)
        new Result().emit(currentUser.socket, '/v1/user/login', 401, { 'status': 401, 'message': err, data });
        //'Incorrect auth token'
        return true;
      }
      //Log.message(user);
      Log.message('Authorized: ' + currentUser.id + ' ' + currentUser.socket + ' ' + currentUser.device)
      var result = { 'status': 200, 'message': 'Ok', 'user_id': currentUser.id, 'ice_servers': Server.server.iceServers }
      new Result().emit(currentUser.socket, '/v1/user/login', 200, result)
      currentUser.authorizing = false
      // Get incoming call
      var call = new Call()
      call.getIncomingCallForUser(currentUser.id, function (error, call) {
        if (!call || error) {
          // No incoming call or incoming call error
          return false
        }
        Server.server.getUserById(call.users[0], function (error, caller) {
          if (error) {
            // Caller not found for incoming call
            return false
          }
          caller.isFriend(currentUser.id, function (error, areFriends) {
            var result = {
              'status': 200,
              'message': 'Ok',
              'caller': Number(caller.id),
              'recipient': Number(currentUser.id),
              'call_id': Number(call.id),
              'video': call.video,
              'offer': call.offer,
              'user': caller.getUserForSend(),
              'is_friend': areFriends
            }
            new Result().emit(currentUser.socket, '/v1/call/incoming', 200, result)
            if (call.iceCaller) {
              call.iceCaller.forEach(function (ice) {
                result = { 'status': 200, 'ice': ice, 'call_id': call.id }
                new Result().emit(currentUser.socket, '/v1/sdp/ice', '200', result)
              })
            };
            call.iceCaller = []
          })
        })
      })
    })
  }

  /*
        * Logout
        *
        * @param currentUser    User   Actual user
        *
        * @return bool
        */
  disconnect (currentUser) {
    Log.message('kick user: ' + currentUser.id)
    currentUser.disconnect(function (user) {
      if (currentUser.socket) {
        // new Result().emit(currentUser.socket, '/v1/user/disconnect', 200, {'status': 200, 'message': 'Ok'});
        // currentUser.socket.disconnect(true);
      }
      currentUser.socket = null
      currentUser.alive = new Date()
    })
  }

  /*
        * Start p2p call
        *
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  /*
        contacts(currentUser, data) {
            var self = this;
            var location = data['location'];
            var result = null;
            // Incorrect or missing ID
            if (typeof location === 'undefined' || !location) {
                result = {'status': 400, 'message': 'No location passed'};
                new Result().emit(currentUser.socket, '/v1/contacts/preload', 400, result);
                return false;
            }
            var users = [];
            var k;
            for(k in Server.server.users) {
                var user = Server.server.users[k];
                if (user != currentUser.id) {
                    users.push({
                        'id': user.id,
                        'name': 'User ' + user.id,
                        'photo': '',
                        'video': ''
                    });
                }
            }
            var result = {
                'status': currentUser.apiCode,
                'message': currentUser.apiMessage,
                'users': users
            };
            new Result().emit(currentUser.socket, '/v1/contacts/preload', currentUser.apiCode, result);
            return true;
        }
        */

  /*
        * Free to chat in random mode
        *
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  goHunting (currentUser, data) {
    var self = this
    var result = null
    currentUser.load(false, function () {
        currentUser.checkHunting(currentUser.id, (err, exists) => {
            if (exists) {
                result = { 'status': 500, 'message': 'User is in hunting mode now' }
                new Result().emit(currentUser.socket, '/v1/hunting/start', 500, result)
                return true
            }
            currentUser.addToHuntingList(function () {
                self.goHuntingIteration(currentUser, data, 0)
                result = { 'status': 200, 'message': 'Ok' }
                new Result().emit(currentUser.socket, '/v1/hunting/start', 200, result)
            });
        })
    })
  }

  /*
    * Free to chat in random mode — signle iteration
    *
    * @param currentUser    User   Actual user
    * @param data           Array  Passed parameters
    *
    * @return bool
    */
  goHuntingIteration (currentUser, data, iteration) {
    var self = this
    if (iteration > 120) {
      var result = { 'status': 408, 'message': 'Timeout' }
      new Result().emit(currentUser.socket, '/v1/hunting/stop', 408, result)
      return false
    }

    var offer = data ? data['offer'] : '';
    currentUser.checkHunting(currentUser.id, function (error, isHunting) {
      if (!isHunting) {
        Log.message('user already in hunting mode')
        return false
      }
      currentUser.goHunting(function (error, prey) {
        if (error) {
          Log.error('Error in hunting at signal point: ' + error);
          currentUser.removeFromHuntingList();
          var result = { 'status': 500, 'message': error }
          new Result().emit(currentUser.socket, '/v1/hunting/start', 500, result)
          return false
        }
        if (prey) {
            currentUser.removeFromHuntingList();
            new User().load(prey, (err, preyObject) => {
                if (preyObject) {
                    new Match(currentUser.id, preyObject.id, offer);
                    Log.message('user found!!!')
                    //new User().load(prey, (err, userObject) => {
                        var result = {'status': 200, 'user': currentUser.getUserForSend()};
                        new Result().emit(preyObject.socket, '/v1/matched/new', 200, result);
                        var result = {'status': 200, 'user': preyObject.getUserForSend()};
                        new Result().emit(currentUser.socket, '/v1/matched/new', 200, result);
                    //});
                } else {
                    self.goHuntingIteration(currentUser, data, iteration + 1)
                }
            });
            return false
        }
        setTimeout(function () {
            self.goHuntingIteration(currentUser, data, iteration + 1)
        }, 500);
      })
    })
  }

  /*
        * Stop random mode
        *
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  stopHunting (currentUser, data) {
    var self = this
    currentUser.removeFromHuntingList();
    var result = { 'status': 200, 'message': 'Ok' }
    new Result().emit(currentUser.socket, '/v1/hunting/stop', 200, result)
  }

    matchedNext (currentUser, data) {
        var self = this;
     var user = data.user;
     if (typeof user === 'undefined' || !user) {
       result = { 'status': 400, 'message': 'No user ID passed', 'type': 'random' };
       new Result().emit(currentUser.socket, '/v1/matched/next', 400, result);
       return false;
     }
     new Match().delete(currentUser.id, data.user, err => {
         var result = { 'status': 200, 'message': 'Ok', 'type': 'random' }
         new Result().emit(currentUser.socket, '/v1/matched/next', 200, result);
         new User().load(user, (err, userObject) => {
             if (userObject && userObject.socket) {
                 var result = { 'status': 200, 'message': 'Ok', 'type': 'random' }
                 new Result().emit(userObject.socket, '/v1/matched/next', 200, result);
             }
         });
     });
   }

    matchedAccept (currentUser, data) {
        var self = this;
        var user = data.user;
        var offer = data.offer;
        if (typeof user === 'undefined' || !user) {
          result = { 'status': 400, 'message': 'No user ID passed', 'type': 'random' };
          new Result().emit(currentUser.socket, '/v1/matched/accept', 400, result);
          return false;
        }
        new Match().load(currentUser.id, data.user, (err, matchedObject) => {
            if (!matchedObject) {
                result = { 'status': 404, 'message': 'User had gone', 'type': 'random' };
                new Result().emit(currentUser.socket, '/v1/matched/accept', 404, result);
                return false;
            }
            if (!matchedObject.approved) {
                matchedObject.approved = true;
                matchedObject.save();
                var result = { 'status': 200, 'message': 'Waiting', 'type': 'random' }
                new Result().emit(currentUser.socket, '/v1/matched/accept', 200, result);
            } else {
                var callee = currentUser.id == matchedObject.caller ? matchedObject.callee : matchedObject.caller;
                new User().load(callee, (err, calleeObject) => {
                    new Match().delete(currentUser.id, calleeObject.id);
                    if (err) {
                        result = { 'status': 404, 'message': 'Callee is offline', 'type': 'random' }
                        return new Result().emit(currentUser.socket, '/v1/matched/accept', 200, result);
                    }
                    var result = { 'status': 200, 'message': 'Ok', 'type': 'random' }
                    new Result().emit(currentUser.socket, '/v1/matched/accept', 200, result);
                    offer = offer ? offer : matchedObject.offer;
                    var callData = {'user_id': calleeObject.id, 'offer': offer, 'user': calleeObject.getUserForSend(), 'type': 'random'};
                    self.call(currentUser, callData);
                });
            }
        });
    }

  /*
        * Start p2p call
        *
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  call (currentUser, data) {
    var self = this
    var calleeId = data['user_id']
    var offer = data['offer']
    var video = data['video'] ? data['video'] : true
    var type = data['type'] ? data['type'] : 'selective'
    var result = null
    // Incorrect or missing ID
    if (typeof calleeId === 'undefined' || !calleeId) {
      result = { 'status': 400, 'message': 'No recipient ID passed', 'type': type }
      new Result().emit(currentUser.socket, '/v1/call/new', 400, result)
      return false
    }
    if (currentUser.id == calleeId) {
      result = { 'status': 500, 'message': 'You can`t talk with yourself', 'callee': Number(calleeId), 'type': type }
      new Result().emit(currentUser.socket, '/v1/call/new', 500, result)
      return false
    }
    Server.server.getUserById(calleeId, function (error, callee) {
      if (error) {
        result = { 'status': 500, 'message': error, 'type': type }
        new Result().emit(currentUser.socket, '/v1/call/new', 500, result)
        return false
      }
      if (!callee.socket) {
        result = { 'status': 404, 'message': 'Callee is offline', 'type': type }
        new Result().emit(currentUser.socket, '/v1/call/new', 404, result)
        return false
      }
      /*
      if (callee && callee.call) {
          result = {'status': 417, 'message': 'Recipient is speaking now, disconnect first', 'recipient': calleeId};
          new Result().emit(currentUser.socket, '/v1/call/new', 417, result);
          return false;
      }
      */
      // Server.server.calls.push(call);

      currentUser.makeCall(calleeId, type, function (data) {
        try {
          data = JSON.parse(data)
        } catch (e) { }
        var call = new Call({
          'id': data.data.call_id,
          'users': [currentUser.id, calleeId],
          'offer': offer,
          'video': video,
          'type': type
        })
        currentUser.isFriend(calleeId, function (error, areFriends) {
          var result = {
            'status': Number(currentUser.apiCode),
            'message': currentUser.apiMessage,
            'caller': Number(currentUser.id),
            'recipient': Number(calleeId),
            'call_id': Number(call.id),
            'video': video,
            'type': type,
            'user': callee ? callee.getUserForSend() : null,
            'isFriend': areFriends
          }
          currentUser.call = call.id
          currentUser.save()
          new Result().emit(currentUser.socket, '/v1/call/new', currentUser.apiCode, result)
          if (callee && callee.socket) {
            result.offer = call.offer,
            result.user = currentUser.getUserForSend()
            new Result().emit(callee.socket, '/v1/call/incoming', 200, result)
          }
        })
      })
    })
  }

  /*
        * Accept p2p call
        *
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  accept (currentUser, data) {
    var callId = Number(data['call_id'])
    var answer = data['answer']
    var result = null
    // Incorrect or missing ID
    if (typeof callId === 'undefined' || !callId) {
      result = { 'status': 400, 'message': 'No call ID passed' }
      new Result().emit(currentUser.socket, '/v1/call/accept', 400, result)
      return false
    }
    Server.server.getCallById(callId, function (error, call) {
      if (error) {
        result = { 'status': 500, 'message': error, 'call_id': callId }
        new Result().emit(currentUser.socket, '/v1/call/accept', 500, result)
        return false
      }
      if (!call) {
        result = { 'status': 404, 'message': 'Call not found', 'call_id': callId, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/accept', 404, result)
        return false
      }
      if (call.status != 'new') {
        result = { 'status': 500, 'message': 'Incorrect call status', 'call_id': callId, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/accept', 500, result)
        return false
      }
      if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
        result = { 'status': 403, 'message': 'Forbidden for this user', 'call_id': callId, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/accept', 403, result)
        return false
      }
      if (call.users[0] == currentUser.id) {
        var callerId = call.users[1]
      } else {
        var callerId = call.users[0]
      }
      Server.server.getUserById(callerId, function (error, caller) {
        if (error) {
          result = { 'status': 500, 'message': error, 'call_id': callId, 'type': call.type }
          new Result().emit(currentUser.socket, '/v1/call/accept', 500, result)
          return false
        }
        if (!callerId || !caller.id || caller.id == currentUser.id) {
          result = { 'status': 403, 'message': 'Forbidden for this user', 'call_id': callId, 'type': call.type }
          new Result().emit(currentUser.socket, '/v1/call/accept', 403, result)
          return false
        }
        if (!caller.authorized) {
          result = { 'status': 417, 'message': 'Caller is offline', 'call_id': callId, 'type': call.type }
          new Result().emit(currentUser.socket, '/v1/call/accept', 417, result)
          return false
        }
        call.answer = answer
        currentUser.accept(call, function (data) {
          result = { 'status': Number(currentUser.apiCode), 'message': currentUser.apiMessage, 'call_id': callId, 'type': call.type }
          if (currentUser.apiCode == 200) {
            currentUser.apiCode = 200
            currentUser.apiMessage = 'Ok'
          } else {
            currentUser.call = null
            result.message = 'Internal server error, try again later, please'
            new Result().emit(currentUser.socket, '/v1/call/accept', currentUser.apiCode, result)
            return false
          }
          currentUser.call = call.id
          currentUser.save()
          call.removeConnectTimeout()
          call.updateStatus('active')
          new Result().emit(currentUser.socket, '/v1/call/accept', currentUser.apiCode, result)
          result.answer = call.answer
          new Result().emit(caller.socket, '/v1/call/accepted', currentUser.apiCode, result)
          // Firebase.sendPushAccepted(currentUser, call);
        })
      })
    })
  }

  /*
        * Reject incoming call
        *
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  reject (currentUser, data) {
    var callId = Number(data['call_id'])
    var result = null
    // Incorrect or missing ID
    if (typeof callId === 'undefined' || !callId) {
      result = { 'status': 400, 'message': 'No call ID passed' }
      new Result().emit(currentUser.socket, '/v1/call/reject', 400, result)
      return false
    }
    Server.server.getCallById(callId, function (error, call) {
      if (error) {
        result = { 'status': 500, 'message': error, 'call_id': callId }
        new Result().emit(currentUser.socket, '/v1/call/reject', 500, result)
        return false
      }
      if (!call) {
        result = { 'status': 404, 'message': 'Call not found', 'call_id': callId }
        new Result().emit(currentUser.socket, '/v1/call/reject', 404, result)
        return false
      }
      if (call.status != 'new') {
        result = { 'status': 500, 'message': 'Incorrect call status', 'call_id': callId, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/reject', 500, result)
        return false
      }
      if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
        result = { 'status': 403, 'message': 'Forbidden for this user', 'call_id': callId, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/reject', 403, result)
        return false
      }
      if (call.users[0] == currentUser.id) {
        var callerId = call.users[1]
      } else {
        var callerId = call.users[0]
      }
      Server.server.getUserById(callerId, function (error, caller) {
        if (error) {
          result = { 'status': 500, 'message': error, 'call_id': callId, 'type': call.type }
          new Result().emit(currentUser.socket, '/v1/call/reject', 500, result)
          return false
        }
        currentUser.reject(call, function (data) {
          result = {
            'status': Number(currentUser.apiCode),
            'message': currentUser.apiMessage,
            'call_id': Number(call.id),
            'type': call.type
          }
          if (currentUser.apiCode == 200) {
            currentUser.call = null
            currentUser.apiCode = 200
            currentUser.apiMessage = 'Ok'
          } else {
            currentUser.call = null
          }
          if (caller && caller.socket) {
            new Result().emit(caller.socket, '/v1/call/rejected', currentUser.apiCode, result)
            caller.call = null
            caller.save()
          }
          currentUser.call = null
          currentUser.save()
          call.removeConnectTimeout()
          call.updateStatus('rejected')
          new Result().emit(currentUser.socket, '/v1/call/reject', currentUser.apiCode, result)
          Server.server.deleteCallById(call.id, function (error) {
            if (error) {
              result = { 'status': 500, 'message': error, 'call_id': callId, 'type': call.type }
              new Result().emit(currentUser.socket, '/v1/call/reject', 500, result)
            }
          })
          // Firebase.sendPushRejected(currentUser, call);
        })
      })
    })
  }

  /*
        * Cancell p2p call from caller before callee accepted it
        *
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  forget (currentUser, data, callback) {
    var result = null
    if (!currentUser.call) {
      result = { 'status': 200, 'message': 'Ok' }
      new Result().emit(currentUser.socket, '/v1/call/forget', 200, result)
      return false
    }
    callback = callback || (() => { })
    Server.server.getCallById(currentUser.call, function (error, call) {
      if (!call) {
        currentUser.call = null
        result = { 'status': 200, 'message': 'Ok' }
        new Result().emit(currentUser.socket, '/v1/call/forget', 200, result)
        callback()
        return false
      }
      call.id = Number(call.id)
      if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
        result = { 'status': 403, 'message': 'Forbidden for this user', 'call_id': call.id, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/forget', 403, result)
        callback()
        return false
      }
      if (call.users[0] == currentUser.id) {
        var callerId = call.users[1]
      } else {
        var callerId = call.users[0]
      }
      if (!callerId) {
        result = { 'status': 500, 'message': error, 'call_id': call.id, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/forget', 500, result)
        callback()
        return false
      }
      Server.server.getUserById(callerId, function (error, caller) {
        if (error) {
          result = { 'status': 500, 'message': error, 'call_id': call.id, 'type': call.type }
          new Result().emit(currentUser.socket, '/v1/call/forget', 500, result)
          callback()
          return false
        }
        currentUser.hangup(call, function (data) {
          call.removeConnectTimeout()
          call.updateStatus('finished')
          if (currentUser.apiCode == 200) {
            currentUser.call = null
            currentUser.apiCode = 200
            currentUser.apiMessage = 'Ok'
          } else {
            currentUser.call = null
          }
          currentUser.save()
          result = { 'status': currentUser.apiCode, 'message': currentUser.apiMessage, 'call_id': call.id, 'type': call.type }

          if (caller) {
            caller.load(false, function () {
              caller.call = null
              caller.save()
            })
            if (caller.socket) {
              if (data.disconnected) {
                result.disconnected = true
                // result.disconnected = data.disconnected ? true : false;
              }
              new Result().emit(caller.socket, '/v1/call/forget', currentUser.apiCode, result)
            }
          }
          new Result().emit(currentUser.socket, '/v1/call/forget', currentUser.apiCode, result)
          Server.server.deleteCallById(call.id, function (error) {
            if (error) {
              result = { 'status': 500, 'message': error, 'call_id': call.id, 'type': call.type }
              new Result().emit(currentUser.socket, '/v1/call/forget', 500, result)
            }
            callback()
          })
        })
      })
    })
  }

  /*
        * Hangup p2p call
        *
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  hangup (currentUser, data, callback) {
    var result = null
    if (!currentUser.call) {
      result = { 'status': 200, 'message': 'Ok' }
      new Result().emit(currentUser.socket, '/v1/call/hangup', 200, result)
      return false
    }
    callback = callback || (() => { })
    Server.server.getCallById(currentUser.call, function (error, call) {
      // if (error) {
      //    result = {'status': 500, 'message': error};
      //    new Result().emit(currentUser.socket, '/v1/call/hangup', 500, result);
      //    return false;
      // }
      if (!call) {
        currentUser.call = null
        result = { 'status': 200, 'message': 'Ok' }
        new Result().emit(currentUser.socket, '/v1/call/hangup', 200, result)
        // result = {'status': 404, 'message': 'Call not found'};
        // new Result().emit(currentUser.socket, '/v1/call/hangup', 404, result);
        callback()
        return false
      }
      if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
        result = { 'status': 403, 'message': 'Forbidden for this user', 'call_id': call.id, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/hangup', 403, result)
        callback()
        return false
      }
      if (call.users[0] == currentUser.id) {
        var callerId = call.users[1]
      } else {
        var callerId = call.users[0]
      }
      if (!callerId) {
        result = { 'status': 500, 'message': error, 'call_id': call.id, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/hangup', 500, result)
        callback()
        return false
      }
      Server.server.getUserById(callerId, function (error, caller) {
        if (error) {
          result = { 'status': 500, 'message': error, 'call_id': call.id, 'type': call.type }
          new Result().emit(currentUser.socket, '/v1/call/hangup', 500, result)
          callback()
          return false
        }
        call.id = Number(call.id)
        currentUser.hangup(call, function (data) {
          call.removeConnectTimeout()
          call.updateStatus('finished')
          if (currentUser.apiCode == 200) {
            currentUser.call = null
            currentUser.apiCode = 200
            currentUser.apiMessage = 'Ok'
          } else {
            currentUser.call = null
          }
          currentUser.save()
          result = { 'status': currentUser.apiCode, 'message': currentUser.apiMessage, 'call_id': call.id, 'type': call.type }

          if (caller) {
            caller.load(false, function () {
              caller.call = null
              caller.save()
            })
            if (caller.socket) {
              if (data.disconnected) {
                result.disconnected = true
                // result.disconnected = data.disconnected ? true : false;
              }
              new Result().emit(caller.socket, '/v1/call/hangup', currentUser.apiCode, result)
            }
          }
          new Result().emit(currentUser.socket, '/v1/call/hangup', currentUser.apiCode, result)
          Server.server.deleteCallById(call.id, function (error) {
            if (error) {
              result = { 'status': 500, 'message': error, 'call_id': call.id, 'type': call.type }
              new Result().emit(currentUser.socket, '/v1/call/hangup', 500, result)
            }
            callback()
          })
        })
      })
    })
  }

  /*
        * Hold p2p call
        *
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  callHold (currentUser, data) {
    var result = null
    var offer = data['message']
    Server.server.getCallById(currentUser.call, function (error, call) {
      if (error) {
        result = { 'status': 500, 'message': error }
        new Result().emit(currentUser.socket, '/v1/call/hold', 500, result)
        return false
      }
      if (!call) {
        currentUser.call = null
        result = { 'status': 404, 'message': 'Call not found', 'call_id': call.id }
        new Result().emit(currentUser.socket, '/v1/call/hold', 404, result)
        return false
      }
      call.id = Number(call.id)
      if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
        result = { 'status': 403, 'message': 'Forbidden for this user', 'call_id': call.id }
        new Result().emit(currentUser.socket, '/v1/call/hold', 403, result)
        return false
      }
      if (call.users[0] == currentUser.id) {
        var callerId = call.users[1]
      } else {
        var callerId = call.users[0]
      }
      Server.server.getUserById(callerId, function (error, caller) {
        if (error) {
          result = { 'status': 500, 'message': error, 'call_id': call.id }
          new Result().emit(currentUser.socket, '/v1/call/hold', 500, result)
          return false
        }
        call.updateStatus('hold')
        result = { 'status': 200, 'message': 'Ok', 'call_id': call.id, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/hold', currentUser.apiCode, result)
        result.offer = offer
        new Result().emit(caller.socket, '/v1/call/get_hold', 200, result)
      })
    })
  }

  /*
        * Continue p2p call
        *
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  callContinue (currentUser, data) {
    var result = null
    var offer = data['message']
    Server.server.getCallById(currentUser.call, function (error, call) {
      if (error) {
        result = { 'status': 500, 'message': error }
        new Result().emit(currentUser.socket, '/v1/call/hold', 500, result)
        return false
      }
      if (!call) {
        currentUser.call = null
        result = { 'status': 404, 'message': 'Call not found' }
        new Result().emit(currentUser.socket, '/v1/call/continue', 404, result)
        return false
      }
      call.id = Number(call.id)
      if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
        result = { 'status': 403, 'message': 'Forbidden for this user', 'call_id': call.id }
        new Result().emit(currentUser.socket, '/v1/call/continue', 403, result)
        return false
      }
      if (call.users[0] == currentUser.id) {
        var callerId = call.users[1]
      } else {
        var callerId = call.users[0]
      }
      Server.server.getUserById(callerId, function (error, caller) {
        if (error) {
          result = { 'status': 500, 'message': error, 'call_id': call.id }
          new Result().emit(currentUser.socket, '/v1/call/continue', 500, result)
          return false
        }
        call.updateStatus('active')
        result = { 'status': 200, 'message': 'Ok', 'call_id': call.id, 'call_id': call.id, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/call/continue', currentUser.apiCode, result)
        result.offer = offer
        if (caller) {
          new Result().emit(caller.socket, '/v1/call/get_continue', 200, result)
        }
      })
    })
  }

  /*
        * SDP message
        *
        * @param apiCode        String Message type (offer / answer / candidate / ...)
        * @param currentUser    User   Actual user
        * @param data           Array  Passed parameters
        *
        * @return bool
        */
  message (code, currentUser, data) {
    var message = data['message']
    var callId = data['call_id'] ? data['call_id'] : currentUser.call
    var result = null
    // Incorrect or missing ID
    if (typeof message === 'undefined' || !message) {
      result = { 'status': 400, 'message': 'No message passed', 'call_id': call.id }
      new Result().emit(currentUser.socket, '/v1/sdp/' + code, 400, result)
      return false
    }
    if (!callId) {
      result = { 'status': 404, 'message': 'There is no call for this user', 'call_id': call.id }
      new Result().emit(currentUser.socket, '/v1/sdp/' + code, 404, result)
      return false
    }
    Server.server.getCallById(callId, function (error, call) {
      if (error) {
        result = { 'status': 500, 'message': error }
        new Result().emit(currentUser.socket, '/v1/sdp/' + code, 500, result)
        return false
      }
      if (!call) {
        currentUser.call = null
        result = { 'status': 404, 'message': 'Call not found', 'call_id': call.id }
        new Result().emit(currentUser.socket, '/v1/sdp/' + code, 404, result)
        return false
      }
      call.id = Number(call.id)
      if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
        result = { 'status': 403, 'message': 'Forbidden for this user', 'call_id': call.id }
        new Result().emit(currentUser.socket, '/v1/sdp/' + code, 403, result)
        return false
      }
      if (call.users[0] == currentUser.id) {
        var callerId = call.users[1]
      } else {
        var callerId = call.users[0]
      }
      Server.server.getUserById(callerId, function (error, caller) {
        if (error) {
          result = { 'status': 500, 'message': error, 'call_id': call.id }
          new Result().emit(currentUser.socket, '/v1/sdp/' + code, 500, result)
          return false
        }
        result = { 'status': 200, 'message': 'Ok', 'call_id': call.id }
        new Result().emit(currentUser.socket, '/v1/sdp/' + code, 200, result)
        if (caller && caller.socket) {
          switch (code) {
            case 'offer': result.offer = message; break
            case 'answer': result.answer = message; break
            case 'ice': result.ice = message; break
          }
          new Result().emit(caller.socket, '/v1/sdp/get_' + code, 200, result)
        } else {
          switch (code) {
            case 'offer':
              call.offer = message
              break
            case 'answer':
              call.answer = message
              break
            case 'ice':
              call.iceCaller.push(message)
              break
          }
        }
      })
    })
  }

  /*
        * Add friend
        *
        *
        * @return bool
        */
  addFriend (currentUser, data) {
    var friendId = Number(data['friend'])
    currentUser.addFriend(friendId, function (error, areFriends) {
      var result = { 'status': 200, 'message': 'Ok' }
      new Result().emit(currentUser.socket, '/v1/friend/add', 200, result)
      if (areFriends) {
        var result = { 'status': 200, 'message': 'Ok', 'friend': friendId }
        new Result().emit(currentUser.socket, '/v1/friend/become', 200, result)
        Server.server.getUserById(friendId, function (error, friend) {
          if (friend) {
            var result = { 'status': 200, 'message': 'Ok', 'friend': Number(currentUser.id) }
            new Result().emit(friend.socket, '/v1/friend/become', 200, result)
          }
        })
      }
    })
  }

  /*
        * Check friend
        *
        *
        * @return bool
        */
  checkFriend (currentUser, data) {
    var friendId = Number(data['friend'])
    currentUser.isFriend(friendId, function (error, areFriends) {
      var result = { 'status': 200, 'message': 'Ok', 'friend': areFriends }
      new Result().emit(currentUser.socket, '/v1/friend/check', 200, result)
    })
  }

  /*
        * Add friend
        *
        *
        * @return bool
        */
  removeFriend (currentUser, data) {
    var friendId = Number(data['friend'])
    currentUser.removeFriend(friendId, function (error, areFriends) {
      var result = { 'status': 200, 'message': 'Ok' }
      new Result().emit(currentUser.socket, '/v1/friend/remove', 200, result)
    })
  }

  /*
        * Store firebase token
        *
        *
        * @return bool
        */
  firebaseToken (currentUser, data) {
    var token = data['token']
    Firebase.storeToken(currentUser.token, token, (err, done) => {
      var code = (err ? 500 : 200)
      var result = { 'status': code, 'message': (err || 'Ok') }
      new Result().emit(currentUser.socket, '/v1/user/firebase-token', code, result)
    })
  }

  /*
        * Payment for sender is required, just notify interlocutor about it
        *
        *
        * @return bool
        */
  paymentMessage (type, currentUser, data) {
    var result = null
    Server.server.getCallById(currentUser.call, function (error, call) {
      if (error) {
        result = { 'status': 500, 'message': error }
        new Result().emit(currentUser.socket, '/v1/payment/' + type, 500, result)
        return false
      }
      if (!call) {
        currentUser.call = null
        result = { 'status': 404, 'message': 'Call not found', 'call_id': call.id }
        new Result().emit(currentUser.socket, '/v1/payment/' + type, 404, result)
        return false
      }
      call.id = Number(call.id)
      if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
        result = { 'status': 403, 'message': 'Forbidden for this user', 'call_id': call.id }
        new Result().emit(currentUser.socket, '/v1/payment/' + type, 403, result)
        return false
      }
      if (call.users[0] == currentUser.id) {
        var callerId = call.users[1]
      } else {
        var callerId = call.users[0]
      }
      Server.server.getUserById(callerId, function (error, caller) {
        if (error) {
          result = { 'status': 500, 'message': error, 'call_id': call.id }
          new Result().emit(currentUser.socket, '/v1/payment/' + type, 500, result)
          return false
        }
        result = { 'status': 200, 'message': 'Ok', 'call_id': call.id, 'type': call.type }
        new Result().emit(currentUser.socket, '/v1/payment/' + type, 200, result)
        result = { 'status': 200, 'message': 'Ok', 'call_id': call.id, 'type': call.type }
        new Result().emit(caller.socket, '/v1/payment/get_' + type, 200, result)
      })
    })
  }

  /*
        * Get list of online users
        *
        *
        * @return bool
        */
  userListOnline (currentUser, data) {
    var users = Object.values(Server.server.users)
    /*
            for(var i in Server.server.users) {
                var user = Server.server.users[i];
                if (user && user.socket && user.socket.id) {
                    users.push(user.id);
                }
            }
            */
    var usersToSend = []
    for (let i in users) {
      if (users[i] && users[i].socket) {
        usersToSend.push(users[i])
      }
    }
    var result = { 'status': 200, 'message': 'Ok', 'users': usersToSend }
    new Result().emit(currentUser.socket, '/v1/user/list/online', 200, result)
  }

  /*
        * Get current command
        *
        * @param string    packet   Incoming packet
        *
        * @return string   command  Recognized command to execute
        */
  getCommand (packet, socket) {
    var self = this
    var command = packet[0]
    if (!packet) {
      Log.error('Empty packet!')
      return null
    }
    if (!command) {
      return null
    }
    command = command.replace(/^\/v1/, '').trim()
    command = command.replace(/^\//, '').trim()
    command = command.replace(/\/$/, '').trim()
    if (command != 'alive') {
      Log.message('Command: ' + command + ', params: ' + JSON.stringify(packet), socket.id)
    }
    return command
  }
}

module.exports = new Signaling()
