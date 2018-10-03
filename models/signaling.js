var config = require('getconfig');
// Core module
var Server = require('../server.js');
// Result for socket.io requests
var Result = require('./result.js');
// Log
var Log = require('./log.js');
// Call
var Call = require('./call.js');
// User
var User = require('./user.js');
// Firebase
var Firebase = require('../models/firebase.js');

class Signaling {
    init(socket) {
        var self = this;

        // Get current user for socket
        var currentUser = new User(socket);

        // Catch all requests
        socket.use((packet, next) => {
            // Get command
            var command = self.getCommand(packet);
            if (!command) {
                return true;
            }
            if (true || currentUser.authorized || command == 'user/login' || command == 'alive') {
                self.processCommand(currentUser, command, packet);
            } else {
                new Result().emit(currentUser.socket, 'errorMessage', 401, {'status': 401, 'message': 'Unauthorized'} );
            }
        });

        socket.on('disconnect', function () {
            Log.message('User disconnected');
            currentUser.socket = null;
            if (currentUser.id) {
                currentUser.removeFromHuntingList();
                Server.server.deleteUserById();
            }
        });

        socket.on('alive', function () {
            new Result().emit(currentUser.socket, 'alive', '200', {'status': 200, 'message': 'Ok'} );
            return true;
        });
    }

    processCommand(currentUser, command, packet) {
        try {
            var self = this;
            var data = packet[1];

            if (typeof data == 'string') {
                try {
                    data = JSON.parse(data);
                } catch(e) {
                    Log.error('Error parsing json');
                    Log.error(e);
                }
            }

            // Kepp alive
            if (command == 'alive') {
                return self.alive(currentUser);
            }

            // Login
            if (command == 'user/login') {
                return self.login(currentUser, data);
            }

            // Logoff
            if (command == 'user/disconnect') {
                return self.disconnect(currentUser);
            }

            // Get new contacts
            if (command == 'contacts/preload') {
                return self.contacts(currentUser, data);
            }

            // Get new contacts
            if (command == 'hunting/start') {
                return self.goHunting(currentUser, data);
            }

            // Get new contacts
            if (command == 'hunting/stop') {
                return self.stopHunting(currentUser, data);
            }

            // Start call
            if (command == 'call/new') {
                return self.call(currentUser, data);
            }

            // Accept call
            if (command == 'call/accept') {
                return self.accept(currentUser, data);
            }

            // Reject call
            if (command == 'call/reject') {
                return self.reject(currentUser, data);
            }

            // Hangup call
            if (command == 'call/hangup') {
                return self.hangup(currentUser, data);
            }

            // Hold call
            if (command == 'call/hold') {
                return self.callHold(currentUser, data);
            }

            // Continue call
            if (command == 'call/continue') {
                return self.callContinue(currentUser, data);
            }

            // SDP offer
            if (command == 'sdp/offer') {
                return self.message('offer', currentUser, data);
            }

            // SDP answer
            if (command == 'sdp/answer') {
                return self.message('answer', currentUser, data);
            }

            // ICE
            if (command == 'sdp/ice') {
                return self.message('ice', currentUser, data);
            }

            if (command == 'call/reconnect') {
                return self.message('reconnect', currentUser, data);
            }

            if (command == 'user/list/online') {
                return self.userListOnline(currentUser, data);
            }
        } catch(e) {
            var message = e.message ? e.message : e;
            Log.error(message);
            console.log(e);
            new Result().emit(currentUser.socket.id, 500, '/v1/' + command, {'status': 500, 'message': message});
        }
    }

    /*
    * Alive ping/pong
    * Used to keep session active
    *
    * @param currentUser    User   Actual user
    */
    alive(currentUser) {
        new Result().emit(currentUser.socket, 'alive', '200', {'status': 200, 'message': 'Ok'} );
        return true;
    }

    /*
    * User login
    *
    * @param currentUser    User   Actual user
    * @param data           Array  Passed parameters
    *
    * @return bool
    */
    login(currentUser, data) {
        /*
        if (!data.type) {
            new Result().emit(currentUser.socket, '/v1/user/login', 400, {'status': 400, 'message': 'No auth type passed'});
            return false;
        }
        */
        if (!data.token) {
            new Result().emit(currentUser.socket, '/v1/user/login', 400, {'status': 400, 'message': 'No token passed'});
            return false;
        }
        currentUser.authorize(data.token, function(user) {
            if (!currentUser.authorized) {
                Log.error('Authorization failed:' + currentUser.apiMessage);
                new Result().emit(currentUser.socket, '/v1/user/login', 401, {'status': 401, 'message': "Incorrect auth token"});
                return true;
            }
            Log.message('Authorized: ' + currentUser.id);
            var result = {'status': 200, 'message':'Ok', 'user_id': currentUser.id, 'ice_servers': Server.server.iceServers};
            new Result().emit(currentUser.socket, '/v1/user/login', 200, result);
            // Get incoming call
            var call = new Call();
            call.getIncomingCallForUser(currentUser.id, function(error, call) {
                if (!call || error) {
                    // No incoming call or incoming call error
                    return false;
                }
                Server.server.getUserById(call.users[0], function(error, caller) {
                    if (error) {
                        // Caller not found for incoming call
                        return false;
                    }
                    var result = {
                        'status': 200,
                        'message': 'Ok',
                        'caller': caller.id,
                        'recipient': currentUser.id,
                        'call_id': call.id,
                        'video': call.video,
                        'offer': call.offer,
                        'user': {
                            'id': caller.id,
                            'name': caller.name,
                            'photo': caller.photo
                        }
                    };
                    new Result().emit(currentUser.socket, '/v1/call/incoming', 200, result);
                    if (call.iceCaller) {
                        call.iceCaller.forEach(function(ice) {
                            result = {'status': 200, 'ice': ice, 'call_id': call.id};
                            new Result().emit(recipient.socket, '/v1/sdp/ice', '200', result);
                        });
                    };
                    call.iceCaller = [];
                });
            });
        });
    }

    /*
    * Logout
    *
    * @param currentUser    User   Actual user
    *
    * @return bool
    */
    disconnect(currentUser) {
        Log.message('User disconnected: ' + currentUser.id);
        currentUser.disconnect(function(user) {
            if (currentUser.socket) {
                //new Result().emit(currentUser.socket, '/v1/user/disconnect', 200, {'status': 200, 'message': 'Ok'});
                //currentUser.socket.disconnect(true);
            }
            currentUser.socket = null;
            currentUser.alive = new Date();
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

    /*
    * Free to chat in random mode
    *
    * @param currentUser    User   Actual user
    * @param data           Array  Passed parameters
    *
    * @return bool
    */
    goHunting(currentUser, data) {
        var self = this;
        var offer = data['offer'];
        var result = null;
        currentUser.isHunting = true;
        currentUser.save();
        currentUser.addToHuntingList();
        currentUser.huntingInterval = setInterval(function() {
            currentUser.goHunting(function(error, prey) {
                if (error) {
                    result = {'status': 500, 'message': error};
                    new Result().emit(currentUser.socket, '/v1/hunting/start', 500, result);
                    self.stopHunting(currentUser, {});
                    return false;
                }
                if (prey && currentUser.isHunting && prey.isHunting) {
                    self.stopHunting(currentUser, {});
                    self.stopHunting(prey, {});
                    var data = {'user_id': prey.id, 'offer': offer};
                    self.call(currentUser, data);
                }
            });
        }, 1000); // Every 1 sec
        result = {'status': 200, 'message': 'Ok'};
        new Result().emit(currentUser.socket, '/v1/hunting/start', 200, result);
        return true;
    }

    /*
    * Stop random mode
    *
    * @param currentUser    User   Actual user
    * @param data           Array  Passed parameters
    *
    * @return bool
    */
    stopHunting(currentUser, data) {
        var self = this;
        clearInterval(currentUser.huntingInterval);
        currentUser.isHunting = false;
        currentUser.save();
        currentUser.removeFromHuntingList();
        if (!data.silent) {
            var result = {'status': 200, 'message': 'Ok'};
            new Result().emit(currentUser.socket, '/v1/hunting/stop', 200, result);
        }
        return true;
    }

    /*
    * Start p2p call
    *
    * @param currentUser    User   Actual user
    * @param data           Array  Passed parameters
    *
    * @return bool
    */
    call(currentUser, data) {
        var self = this;
        var recipientId = data['user_id'];
        var offer = data['offer'];
        var video = data['video'] ? data['video'] : true;
        var result = null;
        // Incorrect or missing ID
        if (typeof recipientId === 'undefined' || !recipientId) {
            result = {'status': 400, 'message': 'No recipient ID passed'};
            new Result().emit(currentUser.socket, '/v1/call/new', 400, result);
            return false;
        }
        if (currentUser.id == recipientId) {
            result = {'status': 500, 'message': 'You can`t talk with yourself', 'recipient': recipientId};
            new Result().emit(currentUser.socket, '/v1/call/new', 500, result);
            return false;
        }
        Server.server.getUserById(recipientId, function(error, recipient) {
            if (error) {
                result = {'status': 500, 'message': error};
                new Result().emit(currentUser.socket, '/v1/call/new', 500, result);
                return false;
            }
            if (recipient && recipient.call) {
                result = {'status': 417, 'message': 'Recipient is speaking now, disconnect first', 'recipient': recipientId};
                new Result().emit(currentUser.socket, '/v1/call/new', 417, result);
                return false;
            }
            var call = new Call({
                'users': [currentUser.id, recipientId],
                'offer': offer,
                'video': video
            });
            //Server.server.calls.push(call);
            currentUser.makeCall(recipientId, call.id, function(data) {
                var result = {
                    'status': currentUser.apiCode,
                    'message': currentUser.apiMessage,
                    'caller': currentUser.id,
                    'recipient': recipientId,
                    'call_id': call.id,
                    'video': video
                };
                currentUser.call = call.id;
                currentUser.save();
                call.save();
                new Result().emit(currentUser.socket, '/v1/call/new', currentUser.apiCode, result);
                //if (currentUser.apiCode == 200 && recipient && recipient.socket) {
                if (recipient && recipient.socket) {
                    result.offer = call.offer,
                    result.user = {'id': currentUser.id, 'name': currentUser.name, 'photo': currentUser.photo};
                    new Result().emit(recipient.socket, '/v1/call/incoming', 200, result);
                }
                /*
                if(recipient) {
                    Firebase.sendPushCall(recipientId, currentUser, call);
                }
                */
            });
        });
        return true;
    }

    /*
    * Accept p2p call
    *
    * @param currentUser    User   Actual user
    * @param data           Array  Passed parameters
    *
    * @return bool
    */
    accept(currentUser, data) {
        var callId = data['call_id'];
        var answer = data['answer'];
        var result = null;
        // Incorrect or missing ID
        if (typeof callId === 'undefined' || !callId) {
            result = {'status': 400, 'message': 'No call ID passed'};
            new Result().emit(currentUser.socket, '/v1/call/accept', 400, result);
            return false;
        }
        Server.server.getCallById(callId, function(error, call) {
            if (error) {
                result = {'status': 500, 'message': error};
                new Result().emit(currentUser.socket, '/v1/call/accept', 500, result);
                return false;
            }
            if (!call) {
                result = {'status': 404, 'message': 'Call not found'};
                new Result().emit(currentUser.socket, '/v1/call/accept', 404, result);
                return false;
            }
            if (call.status != 'new') {
                result = {'status': 500, 'message': 'Incorrect call status'};
                new Result().emit(currentUser.socket, '/v1/call/accept', 500, result);
                return false;
            }
            if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
                result = {'status': 403, 'message': 'Forbidden for this user'};
                new Result().emit(currentUser.socket, '/v1/call/accept', 403, result);
                return false;
            }
            if (call.users[0] == currentUser.id) {
                var recipientId = call.users[1];
            } else {
                var recipientId = call.users[0];
            }
            Server.server.getUserById(recipientId, function(error, recipient) {
                if (error) {
                    result = {'status': 500, 'message': error};
                    new Result().emit(currentUser.socket, '/v1/call/accept', 500, result);
                    return false;
                }
                if (!recipient || !recipient.id || recipient.id == currentUser.id) {
                    result = {'status': 403, 'message': 'Forbidden for this user'};
                    new Result().emit(currentUser.socket, '/v1/call/accept', 403, result);
                    return false;
                }
                if (!recipient.authorized) {
                    result = {'status': 403, 'message': 'Caller is offline'};
                    new Result().emit(currentUser.socket, '/v1/call/accept', 403, result);
                    return false;
                }
                call.answer = answer;
                currentUser.accept(call, function(data) {
                    result = {'status': currentUser.apiCode, 'message': currentUser.apiMessage, 'call_id': call.id};
                    if (currentUser.apiCode == 200) {
                        currentUser.apiCode = 200;
                        currentUser.apiMessage = 'Ok';
                    } else {
                        currentUser.call = null;
                        result.message = 'Internal server error, try again later, please';
                        new Result().emit(currentUser.socket, '/v1/call/accept', currentUser.apiCode, result);
                        return false;
                    }
                    currentUser.call = call.id;
                    currentUser.save();
                    call.removeConnectTimeout();
                    call.updateStatus('active');
                    //call.status = 'active';
                    new Result().emit(currentUser.socket, '/v1/call/accept', currentUser.apiCode, result);
                    result.answer = call.answer;
                    new Result().emit(recipient.socket, '/v1/call/accepted', currentUser.apiCode, result);
                    Firebase.sendPushAccepted(currentUser, call);
                });
            });
        });
        return true;
    }

    /*
    * Reject incoming call
    *
    * @param currentUser    User   Actual user
    * @param data           Array  Passed parameters
    *
    * @return bool
    */
    reject(currentUser, data) {
        var callId = data['call_id'];
        var result = null;
        // Incorrect or missing ID
        if (typeof callId === 'undefined' || !callId) {
            result = {'status': 400, 'message': 'No call ID passed'};
            new Result().emit(currentUser.socket, '/v1/call/reject', 400, result);
            return false;
        }
        Server.server.getCallById(callId, function(error, call) {
            if (error) {
                result = {'status': 500, 'message': error};
                new Result().emit(currentUser.socket, '/v1/call/reject', 500, result);
                return false;
            }
            if (!call) {
                result = {'status': 404, 'message': 'Call not found'};
                new Result().emit(currentUser.socket, '/v1/call/reject', 404, result);
                return false;
            }
            if (call.status != 'new') {
                result = {'status': 500, 'message': 'Incorrect call status'};
                new Result().emit(currentUser.socket, '/v1/call/reject', 500, result);
                return false;
            }
            if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
                result = {'status': 403, 'message': 'Forbidden for this user'};
                new Result().emit(currentUser.socket, '/v1/call/reject', 403, result);
                return false;
            }
            if (call.users[0] == currentUser.id) {
                var recipientId = call.users[1];
            } else {
                var recipientId = call.users[0];
            }
            Server.server.getUserById(recipientId, function(error, recipient) {
                if (error) {
                    result = {'status': 500, 'message': error};
                    new Result().emit(currentUser.socket, '/v1/call/reject', 500, result);
                    return false;
                }
                currentUser.reject(call, function(data) {
                    result = {'status': currentUser.apiCode,
                              'message': currentUser.apiMessage,
                              'call_id': call.id
                             };
                    if (currentUser.apiCode == 200) {
                        currentUser.call = null;
                        currentUser.apiCode = 200;
                        currentUser.apiMessage = 'Ok';
                    } else {
                        currentUser.call = null;
                    }
                    if (recipient && recipient.socket) {
                        new Result().emit(recipient.socket, '/v1/call/rejected', currentUser.apiCode, result);
                        recipient.call = null;
                        recipient.save();
                    }
                    currentUser.call = null;
                    currentUser.save();
                    call.removeConnectTimeout();
                    call.updateStatus('rejected');
                    //call.status = 'rejected';
                    new Result().emit(currentUser.socket, '/v1/call/reject', currentUser.apiCode, result);
                    Server.server.deleteCallById(call.id, function(error) {
                        if (error) {
                            result = {'status': 500, 'message': error};
                            new Result().emit(currentUser.socket, '/v1/call/reject', 500, result);
                        }
                    });
                    Firebase.sendPushRejected(currentUser, call);
                });
            });
        });
        return true;
    }

    /*
    * Hangup p2p call
    *
    * @param currentUser    User   Actual user
    * @param data           Array  Passed parameters
    *
    * @return bool
    */
    hangup(currentUser, socket) {
        var result = null;
        Server.server.getCallById(currentUser.call, function(error, call) {
            if (error) {
                result = {'status': 500, 'message': error};
                new Result().emit(currentUser.socket, '/v1/call/hangup', 500, result);
                return false;
            }
            if (!call) {
                currentUser.call = null;
                result = {'status': 404, 'message': 'Call not found'};
                new Result().emit(currentUser.socket, '/v1/call/hangup', 404, result);
                return false;
            }
            if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
                result = {'status': 403, 'message': 'Forbidden for this user'};
                new Result().emit(currentUser.socket, '/v1/call/hangup', 403, result);
                return false;
            }
            if (call.users[0] == currentUser.id) {
                var recipientId = call.users[1];
            } else {
                var recipientId = call.users[0];
            }
            if (!recipientId) {
                result = {'status': 500, 'message': error};
                new Result().emit(currentUser.socket, '/v1/call/hangup', 500, result);
                return false;
            }
            Server.server.getUserById(recipientId, function(error, recipient) {
                if (error) {
                    result = {'status': 500, 'message': error};
                    new Result().emit(currentUser.socket, '/v1/call/hangup', 500, result);
                    return false;
                }
                currentUser.hangup(call, function(data) {
                    call.removeConnectTimeout();
                    call.updateStatus('finished');
                    //call.status = 'finished';
                    result = {'status': currentUser.apiCode, 'message': currentUser.apiMessage, 'call_id': call.id};
                    if (currentUser.apiCode == 200) {
                        currentUser.call = null;
                        currentUser.apiCode = 200;
                        currentUser.apiMessage = 'Ok';
                    } else {
                        currentUser.call = null;
                    }
                    currentUser.save();
                    if (recipient && recipient.socket) {
                        new Result().emit(recipient.socket, '/v1/call/hangup', currentUser.apiCode, result);
                        recipient.call = null;
                        recipient.save();
                    }
                    new Result().emit(currentUser.socket, '/v1/call/hangup', currentUser.apiCode, result);
                    Server.server.deleteCallById(call.id, function(error) {
                        if (error) {
                            result = {'status': 500, 'message': error};
                            new Result().emit(currentUser.socket, '/v1/call/hangup', 500, result);
                        }
                    });
                });
            });
        });
        return true;
    }

    /*
    * Hold p2p call
    *
    * @param currentUser    User   Actual user
    * @param data           Array  Passed parameters
    *
    * @return bool
    */
    callHold(currentUser, data) {
        var result = null;
        var offer = data['offer'];
        Server.server.getCallById(currentUser.call, function(error, call) {
            if (error) {
                result = {'status': 500, 'message': error};
                new Result().emit(currentUser.socket, '/v1/call/hold', 500, result);
                return false;
            }
            if (!call) {
                currentUser.call = null;
                result = {'status': 404, 'message': 'Call not found'};
                new Result().emit(currentUser.socket, '/v1/call/hold', 404, result);
                return false;
            }
            if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
                result = {'status': 403, 'message': 'Forbidden for this user'};
                new Result().emit(currentUser.socket, '/v1/call/hold', 403, result);
                return false;
            }
            if (call.users[0] == currentUser.id) {
                var recipientId = call.users[1];
            } else {
                var recipientId = call.users[0];
            }
            Server.server.getUserById(recipientId, function(error, recipient) {
                if (error) {
                    result = {'status': 500, 'message': error};
                    new Result().emit(currentUser.socket, '/v1/call/hold', 500, result);
                    return false;
                }
                call.updateStatus('hold');
                result = {'status': 200, 'message': 'Ok', 'call_id': call.id};
                new Result().emit(currentUser.socket, '/v1/call/hold', currentUser.apiCode, result);
                result.offer = offer;
                new Result().emit(recipient.socket, '/v1/call/get_hold', 200, result);
            });
        });
        return true;
    }

    /*
    * Continue p2p call
    *
    * @param currentUser    User   Actual user
    * @param data           Array  Passed parameters
    *
    * @return bool
    */
    callContinue(currentUser, data) {
        var result = null;
        var offer = data['offer'];
        Server.server.getCallById(currentUser.call, function(error, call) {
            if (error) {
                result = {'status': 500, 'message': error};
                new Result().emit(currentUser.socket, '/v1/call/hold', 500, result);
                return false;
            }
            if (!call) {
                currentUser.call = null;
                result = {'status': 404, 'message': 'Call not found'};
                new Result().emit(currentUser.socket, '/v1/call/continue', 404, result);
                return false;
            }
            if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
                result = {'status': 403, 'message': 'Forbidden for this user'};
                new Result().emit(currentUser.socket, '/v1/call/continue', 403, result);
                return false;
            }
            if (call.users[0] == currentUser.id) {
                var recipientId = call.users[1];
            } else {
                var recipientId = call.users[0];
            }
            Server.server.getUserById(recipientId, function(error, recipient) {
                if (error) {
                    result = {'status': 500, 'message': error};
                    new Result().emit(currentUser.socket, '/v1/call/continue', 500, result);
                    return false;
                }
                call.updateStatus('active');
                result = {'status': 200, 'message': 'Ok', 'call_id': call.id};
                new Result().emit(currentUser.socket, '/v1/call/continue', currentUser.apiCode, result);
                result.offer = offer;
                if (recipient) {
                    new Result().emit(recipient.socket, '/v1/call/get_continue', 200, result);
                }
            });
        });
        return true;
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
    message(code, currentUser, data) {
        var message = data['message'];
        var result = null;
        // Incorrect or missing ID
        if (typeof message === 'undefined' || !message) {
            result = {'status': 400, 'message': 'No message passed'};
            new Result().emit(currentUser.socket, '/v1/sdp/' + code, 400, result);
            return false;
        }
        if (!currentUser.call) {
            result = {'status': 404, 'message': 'There is no call for this user'};
            new Result().emit(currentUser.socket, '/v1/sdp/' + code, 404, result);
            return false;
        }
        Server.server.getCallById(currentUser.call, function(error, call) {
            if (error) {
                result = {'status': 500, 'message': error};
                new Result().emit(currentUser.socket, '/v1/call/hold', 500, result);
                return false;
            }
            if (!call) {
                currentUser.call = null;
                result = {'status': 404, 'message': 'Call not found'};
                new Result().emit(currentUser.socket, '/v1/sdp/' + code, 404, result);
                return false;
            }
            if (call.users[0] != currentUser.id && call.users[1] != currentUser.id) {
                result = {'status': 403, 'message': 'Forbidden for this user'};
                new Result().emit(currentUser.socket, '/v1/sdp/' + code, 403, result);
                return false;
            }
            if (call.users[0] == currentUser.id) {
                var recipientId = call.users[1];
            } else {
                var recipientId = call.users[0];
            }
            Server.server.getUserById(recipientId, function(error, recipient) {
                if (error) {
                    result = {'status': 500, 'message': error};
                    new Result().emit(currentUser.socket, '/v1/call/continue', 500, result);
                    return false;
                }
                result = {'status': 200, 'message': 'Ok', 'call_id': call.id};
                new Result().emit(currentUser.socket, '/v1/sdp/' + code, 200, result);
                if (recipient && recipient.socket) {
                    switch (code) {
                        case 'offer': result.offer = message; break;
                        case 'answer': result.answer = message; break;
                        case 'ice': result.ice = message; break;
                    }
                    new Result().emit(recipient.socket, '/v1/sdp/get_' + code, 200, result);
                } else {
                    switch (code) {
                        case 'offer':
                            call.offer = message;
                            break;
                        case 'answer':
                            call.answer = message;
                            break;
                        case 'ice':
                            call.iceCaller.push(message);
                            break;
                    }
                }
            });
        });
        return true;
    }

    /*
    * Get list of online users
    *
    *
    * @return bool
    */
    userListOnline(currentUser, data) {
        var users = Object.values(Server.server.users);
        /*
        for(var i in Server.server.users) {
            var user = Server.server.users[i];
            if (user && user.socket && user.socket.id) {
                users.push(user.id);
            }
        }
        */
        var usersToSend = [];
        for(let i in users) {
            if (users[i] && users[i].socket) {
                usersToSend.push(users[i]);
            }
        }
        var result = {'status': 200, 'message': 'Ok', 'users': usersToSend};
        new Result().emit(currentUser.socket, '/v1/user/list/online', 200, result);
    }

    /*
    * Get current command
    *
    * @param string    packet   Incoming packet
    *
    * @return string   command  Recognized command to execute
    */
    getCommand(packet) {
        var self = this;
        var command = packet[0];
        if (!packet) {
            Log.error('Empty packet!');
            return null;
        }
        if( !command ) {
            return null;
        }
        command = command.replace(/^\/v1/, '').trim();
        command = command.replace(/^\//, '').trim();
        command = command.replace(/\/$/, '').trim();
        if ( command != 'alive' && command != 'load' ) {
            Log.message('Command: ' + command);
        }
        return command;
    }
}

module.exports = new Signaling();
