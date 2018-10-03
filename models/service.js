var config = require('getconfig');
//const shell = require('shelljs');
var fs = require('fs');
var AWS = require('aws-sdk');
AWS.config.update({region: config.aws.region});
// Server
var Server = require('../server.js');
// Log
var Log = require('../models/log.js');
// Result for socket.io requests
var Result = require('./result.js');

function Service() {
    var self = this;
    self.interval = null;
    self.intervalDaily = null;
    self.serviceInterval = 60; // in seconds
    self.serviceMidInterval = 180;
    self.oldIceHash = null;
}

/*
* Remove old user sessions
*
* @return bool
*/
Service.prototype.removeOldSessions = function() {
    var k;
    // Remove old disconnected users
    //return false;
    for (k in Server.users) {
        if (Server.users[k] &&
           !Server.users[k].socket &&
           Server.users[k].alive &&
           Server.users[k].alive < new Date(Date.now() - 1000 * 60)
        ) {
            var user = Server.users[k].id;
            Log.message('Service bot purged abandoned user ' + user.id);
            if (user.call) {
                user.hangup(function() {
                    Server.server.deleteUserById(user.id);
                });
            } else {
                Server.server.deleteUserById(user.id);
            }
        }
    }
};

/*
* Get turn server list from AWS
*
* @return bool
*/
Service.prototype.updateIceServers = function() {
    return false;

    // Create EC2 service object
    var ec2 = new AWS.EC2();

    /*
    * For future development
    *
    * You can get AWS monitoring data and change ice servers list
    * according to actual server load
    *
    var cw = new AWS.CloudWatch();
    var params = {
      MetricName: 'CPUUtilization',
      Namespace: 'AWS/Logs'
    };
    cw.listMetrics(params, function(err, data) {
        console.log(data);
      if (err) {
        console.log("Error", err);
      } else {
        console.log("Metrics", JSON.stringify(data.Metrics));
      }
    });
    */

    var activeServers = [];
    ec2.describeInstances(function(err, data) {
        if (err) {
            Log.error("AWS sync error")
            Log.error(err.stack);
        } else {
            for(let i in data.Reservations) {
                var reservgation = data.Reservations[i];
                for(let j in reservgation.Instances) {
                    var instance = reservgation.Instances[j];
                    //console.log(instance);
                    // Skip instances with status differing from 16:running
                    if (!instance.State && instance.State.Code == 16) {
                        continue;
                    }
                    // Skip instances without isTurnServer tag
                    var hasTurnTag = false;
                    for (let k in instance.Tags) {
                        var key = instance.Tags[k].Key;
                        if (key == 'isTurnServer') {
                            hasTurnTag = true;
                            break;
                        }
                    }
                    if (!hasTurnTag) {
                        continue;
                    }
                    activeServers.push(instance.PublicIpAddress); // PublicDnsName PublicIpAddress
                }
            }
        }
        if (activeServers) {
            var turns = [];
            var stuns = [];
            activeServers.forEach(function(server) {
                turns.push('turn:' + server + ':' + config.turnPort);
                stuns.push('stun:' + server + ':' + config.turnPort);
            });
            Server.server.iceServers[0].urls = turns;
            Server.server.iceServers[1].urls = stuns;
        }
        var iceHash = JSON.stringify(Server.server.iceServers);
        if (self.oldIceHash != iceHash) {
            self.oldIceHash = iceHash;
            var result = {'message': 'Ok', 'ice_servers': Server.server.iceServers};
            new Result().emitToAll('200', '/v1/ice-update', result);
        }
        //console.log(Server.server.iceServers);
    });
}

/*
* Regular tasks, execured by schedule
*
* @return bool
*/
Service.prototype.execute = function() {
    var self = this;
    self.removeOldSessions();
};

Service.prototype.executeMid = function() {
    var self = this;
    self.updateIceServers();
};

/*
* daily actions
*
* @return bool
*/
Service.prototype.daily = function() {
};

var Service = new Service();

// Execute once
module.exports.execute = function() {
    Service.execute();
};

// Schedule tasks
module.exports.schedule = function() {
    // Every x seconds
    Service.updateIceServers();
    Service.interval = setInterval(function() {
        Service.execute();
    }, Service.serviceInterval * 1000);
    Service.interval = setInterval(function() {
        Service.executeMid();
    }, Service.serviceMidInterval * 1000);
    // Every day task
    Service.intervalDaily = setInterval(function() {
        Service.daily();
    }, 86400 * 1000);
};
