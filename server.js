var config = require('getconfig');
if (config.useSSL) {
    var http = require('https');
} else {
    var http = require('http');
}
var fs = require('fs');
var express = require('express');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
//var sticky = require('socketio-sticky-session');
var sticky = require('sticky-session');
const redisAdapter = require('socket.io-redis');

var redis = require("redis");

// User model
var User = require('./models/user.js');
// Call model
var Call = require('./models/call.js');
// Result for socket.io requests
var Result = require('./models/result.js');
// Service functions
var Service = require('./models/service.js');
// Signaling server
var Signaling = require('./models/signaling.js');
// Log
var Log = require('./models/log.js');

class Server {

    constructor() {
        var self = this;

        self.users = {};
        self.iceServers = config.iceServers;

        self.redisClient = redis.createClient({host: config.redis.host, port: config.redis.port});
        self.app = express();

        if (config.useSSL) {
            var credentials = {
                key: fs.readFileSync(config.server.key, 'utf8'),
                cert: fs.readFileSync(config.server.cert, 'utf8'),
                ca: fs.readFileSync(config.server.ca, 'utf8')
            };
            self.httpServer = http.createServer(credentials, self.app);
        } else {
            self.httpServer = http.createServer(self.app);
        }

        self.redisClient.on("error", function (error) {
            var message = 'Can`t connect to Redis: ' + error;
            Log.error(message);
        });
        self.redisClient.on("connect", function (message) {
            Log.error('Connected to Redis');
        });

        if (!sticky.listen(self.httpServer, config.server.port)) {
            // Master code
            self.httpServer.once('listening', function() {
                console.log('Server started on ' + config.server.port + ' port');
            });
            // HTTP responder for load balancing
            http.createServer(function (req, res) {
                res.write('Hello World!'); //write a response to the client
                res.end(); //end the response
            }).listen(config.server.portHttp);
            console.log('Monitoring responder started at ' + config.server.portHttp + ' port');
        } else {
            // Worker code
            Service.schedule();
            self.io = require('socket.io')();
            self.io.adapter(redisAdapter({host: config.redis.host, port: config.redis.port}));
            self.io.set('origins', '*:*');
            self.io.listen(self.httpServer, {'pingInterval': 2000, 'pingTimeout': 6500}); // , { path: '/'}

            self.io.sockets.on('connection', function(socket) {
                // Send hello to user
                new Result().emit(socket.id, 'hello', 200, {'message': 'Ok'});

                // Socket connection error
                socket.on('error', (error) => {
                    new Result().emit(socket.id, 500, '/v1/error', {'status': 500, 'message': error});
                    Log.error('Socket error:' + error);
                });
                // Start signaling server
                try {
                    Signaling.init(socket);
                } catch(e) {
                    var message = e.message ? e.message : e;
                    Log.error(message);
                    console.log(e);
                    new Result().emit(socket.id, 500, '/v1/error', {'status': 500, 'message': message});
                }
            });
        }
    }

    /*
    * Get call by ID
    *
    * @param id             Int
    *
    * @return Call object
    */
    getCallById(id, callback) {
        if (!id) {
            if (callback) {
                callback('No call ID passed', null);
            }
        }
        var call = new Call();
        call.load(id, function(error, call) {
            if (callback) {
                if (error) {
                    callback(error, call);
                }
                callback(error, call);
            }
        });
    }

    /*
    * Delete call by ID
    *
    * @param id             Int
    *
    * @return bool
    */
    deleteCallById(id, callback) {
        if (!id) {
            if (callback) {
                callback('No call ID passed', null);
            }
            return false;
        }
        var call = new Call();
        call.delete(id, function(error) {
            if (callback) {
                callback(error);
            }
        });
    }

    /*
    * Get user by ID
    *
    * @param id             String
    *
    * @return User object
    */
    getUserById(id, callback) {
        if (!id) {
            if (callback) {
                callback('No call ID passed', null);
            }
            return false;
        }
        var user = new User();
        user.load(id, function(error, user) {
            if (callback) {
                if (error) {
                    callback(error, user);
                }
                callback(error, user);
            }
        });
    }

    /*
    * Delete user by ID
    *
    * @param id             Int
    *
    * @return bool
    */
    deleteUserById(id, callback) {
        var self = this;
        if (!id) {
            if (callback) {
                callback('No call ID passed', null);
            }
        }
        var user = new User();
        user.load(id, function(error, user) {
            if (callback) {
                if (error) {
                    callback(error);
                }
            }
            console.log('---1');
            if (user.call) {
                console.log('---2');
                self.getCallById(getCallById, function(error, call) {
                    console.log('---3');
                    if (call) {
                        console.log('---4');
                        result = {'status': 200, 'message': 'Ok', 'call_id': call.id};
                        if (call.users[0] == currentUser.id) {
                            var recipientId = call.users[1];
                        } else {
                            var recipientId = call.users[0];
                        }
                        if (recipientId) {
                            console.log('---5' + recipientId);
                            Server.server.getUserById(recipientId, function(error, recipient) {
                                console.log('---6');
                                if (recipient) {
                                    console.log('---7');
                                    new Result().emit(recipient.socket, '/v1/call/hangup', 200, result);
                                    recipient.call = null;
                                    recipient.save();
                                }
                                Server.server.deleteCallById(call.id);
                            });
                        } else {
                            Server.server.deleteCallById(call.id);
                        }
                    }
                });
            }
            user.delete(id, function(error) {
                if (callback) {
                    callback(error);
                }
            });
        });
    }
}

var ServerInstance = new Server();
module.exports.server = ServerInstance;
