var config = require('getconfig');
var firebase = require('firebase');
var admin = require('firebase-admin');
//var serviceAccount = require('../config/serviceAccountKey.json');
// Log
var Log = require('./log.js');

class Firebase {
    constructor() {
	return false;
        var self = this;
        self.enablePushes = false;

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: config.firebaseDatabaseUrl
        });
    }

    /*
    * Verify Firebase token
    *
    * @param token          String
    * @param callback       Function
    *
    * @return bool
    */
    verifyToken(token, callback) {
        var self = this;
        try {
            admin.auth().verifyIdToken(token)
                .then(function(decodedToken) {
                    var uid = decodedToken.uid;
                    var name = decodedToken.displayName != 'undefined' ? decodedToken.displayName : '';
                    var photo = decodedToken.photoURL != 'undefined' ? decodedToken.photoURL : '';

                    // Subscribe user to topic — required for pushes
                    var topic = 'tokenListForUser' + decodedToken.uid;
                    admin.messaging().subscribeToTopic(token, topic)
                        .then(function(response) {
                            Log.message('User was Successfully subscribed to topic ' + topic);
                            callback(false, uid, uid, name, photo);
                        })
                        .catch(function(error) {
                            Log.error('Error subscribing to topic:');
                            Log.error(error);
                            callback(false, uid, uid, name, photo);
                        });
                }).catch(function(error) {
                    Log.error('Invalid user token');
                    Log.error(error);
                    callback('Invalid user token', false);
                });
        } catch(error) {
            Log.error('Error in token verification');
            Log.error(error);
            callback('Error in token verification', false);
        }
    }

    /*
    * Sent push — new call
    *
    * @param recipientId    String
    * @param caller         User object
    * @param call           Call object
    *
    * @return bool
    */
    sendPushCall(recipientId, caller, call) {
        var self = this;
        if (!self.enablePushes) {
            return false;
        }
        var message = {
              data: {
                type: 'incomingCall',
                call_id: call.id.toString(),
                caller_id: caller.id,
                caller_name: caller.name,
                caller_photo: caller.photo ? caller.photo : '',
                call_type: (call.video ? "video" : "audio")
              },
              topic: 'tokenListForUser' + recipientId
        };
        Log.message(message);
        admin.messaging().send(message)
          .then((response) => {
              // Response is a message ID string.
              Log.message('Successfully sent message');
              Log.message(response);
          })
          .catch((error) => {
              Log.error('Error sending message');
              Log.error(error);
          });
    }

    /*
    * Sent push — call accepted
    *
    * @param user           User object
    * @param call           Call object
    *
    * @return bool
    */
    sendPushAccepted(user, call) {
        var self = this;
        if (!self.enablePushes) {
            return false;
        }
        var message = {
              data: {
                type: 'callAccepted',
                call_id: call.id.toString(),
              },
              topic: 'tokenListForUser' + user.id
        };
        admin.messaging().send(message)
          .then((response) => {
              // Response is a message ID string.
              Log.message('Successfully sent message accept');
              Log.message(response);
          })
          .catch((error) => {
              Log.error('Error sending message accept');
              Log.error(error);
          });
    }

    /*
    * Sent push — call rejected
    *
    * @param user           User object
    * @param call           Call object
    *
    * @return bool
    */
    sendPushRejected(user, call) {
        var self = this;
        if (!self.enablePushes) {
            return false;
        }
        var message = {
              data: {
                type: 'callRejected',
                call_id: call.id.toString(),
              },
              topic: 'tokenListForUser' + user.id
        };
        admin.messaging().send(message)
          .then((response) => {
              // Response is a message ID string.
              Log.message('Successfully sent message reject');
              Log.message(response);
          })
          .catch((error) => {
              Log.error('Error sending message reject');
              Log.error(error);
          });
    }
}

module.exports = new Firebase();
