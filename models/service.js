var config = require('getconfig');
const request = require('request');
var fs = require('fs');
var AWS = require('aws-sdk');
AWS.config.update({region: config.aws.region});
// Server
var Server = require('../server.js');
// Log
var Log = require('../models/log.js');
// Result for socket.io requests
var Result = require('./result.js');
// Firebase
var Firebase = require('./firebase.js');

function Service() {
    var self = this;
    self.interval = null;
    self.intervalDaily = null;
    self.serviceInterval = 10; // in seconds
    self.serviceMidInterval = 180;
    self.oldIceHash = null;
}


/*
* Remove old user sessions
*
* @return bool
*/
Service.prototype.removeOldSessions = function() {
    /*
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
    */
};

/*
* Get turn server list from AWS
*
* @return bool
*/
Service.prototype.updateIceServers = function() {
    //return false;

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
    var self = this;
    var activeServers = [];
    ec2.describeInstances(function(err, data) {
        if (err) {
            return false;
            //Log.error("AWS sync error")
            //Log.error(err.stack);
        } else {
            for(let i in data.Reservations) {
                var reservgation = data.Reservations[i];
                for(let j in reservgation.Instances) {
                    var instance = reservgation.Instances[j];
                    // Skip instances with status differing from 16:running
                    if (!instance.State && instance.State.Code == 16) {
                        continue;
                    }
                    // Skip instances without isTurnServer tag
                    var hasTurnTag = false;
                    for (let k in instance.Tags) {
                        var key = instance.Tags[k].Key;
                        if (instance.Tags[k].Key == 'type' && instance.Tags[k].Value == 'turnServer') {
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
* Send scheduled pushes to users
*
* @return bool
*/
Service.prototype.sendPushes = function() {
return false;
    var self = this;
    var url = config.backend.host + '/v1/pushes/list';
    //console.log('Going to send pushes');
    self.request(url, {}, (err, data) => {
        try {
            data = JSON.parse(data);
        } catch(e) {
            console.log(data);
            console.log(e);
        }
        if (!data) {
            return false;
        }
        var pushes = data.data;
        for (let i in pushes) {
            var push = pushes[i];
            Firebase.sendPush(push, (err, data) => {
                if(err) {
                    return false;
                }
                var url = config.backend.host + '/v1/pushes/sent';
                var data = {'user_id': push.user_id, 'id': push.id, 'error': err};
                //console.log(data);
                self.request(url, data, (err, data) => {
                    //console.log(err);
                    //console.log(data);
                });
            });
        }
    });
};

/*
* Make request to backend
*
* @param url            String
* @param params         Object
* @param callback       Function    Callback function for successfull response
*
* As we don't use backend now, this method just return "ok" for all requests
*
* @return bool
*/
Service.prototype.request = function(url, params, callback) {
    var self = this;
    var options = {
        method: 'POST',
        uri: url,
        headers: {
          'Authorization': 'Token ' + config.backend.token,
        },
        form: params
    };
    request.post(options, function (error, response, body) {
        if (!response) {
            Log.error('Empty response from backend at service function');
            callback('Empty response from backend at service function');
            return false;
        }
        if (!error && response.statusCode === 200) {
            callback(null, body);
        } else {
            callback(error);
        }
    });
}

module.exports.singleCore = function() {
    Service = new Service();
    // Every x seconds
    Service.interval = setInterval(function() {
        //Service.sendPushes();
    }, Service.serviceInterval * 1000);
}

// Schedule tasks
module.exports.schedule = function() {
    Service = new Service();
    // Every x seconds
    Service.interval = setInterval(function() {
        //Service.sendPushes();
    }, Service.serviceInterval * 1000);

    // Middle interval
    Service.intervalMiddle = setInterval(function() {
        Service.updateIceServers();
    }, Service.serviceMidInterval * 1000);

    // Every day task
    Service.intervalDaily = setInterval(function() {
    }, 86400 * 1000);

    setTimeout(() => {
        Service.updateIceServers();
    }, 1000);
};
