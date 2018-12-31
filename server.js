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

        self.redisTokenList = 'tokenList';
        self.iceServers = config.iceServers;

        self.redisClient = redis.createClient({host: config.redis.host, port: config.redis.port});
        self.redisClient.select(1-(config.server.port == 8890), function() {
            self.redisLock = require("redis-lock")(self.redisClient);
        });
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
            Service.singleCore();
            // Master code
            self.httpServer.once('listening', function() {
                console.log('Server started on ' + config.server.port + ' port');
            });
            // HTTP responder for load balancing
            http.createServer(function (req, res) {
                res.write('I`m here'); //write a response to the client
                res.end(); //end the response
            }).listen(config.server.portHttp);
            console.log('Monitoring responder started at ' + config.server.portHttp + ' port');
        } else {
            // Worker code
            Service.schedule();
            self.io = require('socket.io')();
            self.io.adapter(redisAdapter({host: config.redis.host, port: config.redis.port}));
            self.io.set('origins', '*:*');
            self.io.listen(self.httpServer, {'pingInterval': 2000, 'pingTimeout': 7000}); // , { path: '/'}

            self.io.sockets.on('connection', function(socket) {
                // Send hello to user
                //new Result().emit(socket.id, 'hello', 200, {'message': 'Ok'});

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
        if (!callback) {
            callback = function() {};
        }
        if (!id) {
            callback('No call ID passed', null);
        }
        var user = new User();
        user.load(id, function(error, user) {
            if (error) {
                callback(error);
                return false;
            }
            if (!user) {
                return callback();
                return false;
            }
            if (user.call) {
                self.getCallById(user.call, function(error, call) {
                    if (call) {
                        var result = {'status': 200, 'message': 'Ok', 'call_id': call.id};
                        if (call.users[0] == currentUser.id) {
                            var recipientId = call.users[1];
                        } else {
                            var recipientId = call.users[0];
                        }
                        if (recipientId) {
                            Server.server.getUserById(recipientId, function(error, recipient) {
                                if (recipient) {
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
            user.authorized = false;
            user.save(function() {
                setTimeout(function() {
                    user.load(false, function(error, user) {
                        try {
                            if (!user) {
                                callback(error);
                                return false;
                            } else if (!user.authorized) {
                                user.delete(id, function(error) {
                                    callback(error);
                                });
                            }
                        } catch(e) {
                            callback(e.message);
                        }
                    });
                }, 5000);
            });
        });
    }
}

var ServerInstance = new Server();
module.exports.server = ServerInstance;
