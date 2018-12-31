var config = require('getconfig');
var firebase = require('firebase');
var admin = require('firebase-admin');
var request = require('request');
var serviceAccount = require('../config/serviceAccountKey.json');
// Log
var Log = require('./log.js');

class Firebase {
    constructor() {
        var self = this;
        self.enablePushes = true;

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: config.firebase.url
        });
    }

    /*
    * Store Firebase token
    *
    * @param token          String
    * @param callback       Function
    *
    * @return bool
    */
    storeToken(userHash, token, callback) {
        var self = this;
        var url = config.backend.host + '/v1/pushes/store';
        var params = {'hash': userHash, 'token': token};
        console.log(params);
        self.request(url, params, (err, data) => {
            console.log(data);
            callback(err);
        });
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
    sendPush(push, callback) {
        var self = this;
        //console.log('//////////////////////////////////');
        if (!self.enablePushes || !push.token) {
            return false;
        }
        var message = {
            notification: {
                title: String(push.title),
                body: String(push.content),
            },
            data: {
                type: String(push.type)
            },
            token: push.token
        };
        //console.log(message);
        admin.messaging().send(message)
          .then((response) => {
              console.log(response);
              callback(null, {responce: response, push: push});
          })
          .catch((error) => {
              console.log(error);
              callback(error);
          });
    }

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
    request (url, params, callback) {
        var self = this;
        var options = {
            method: 'POST',
            uri: url,
            headers: {
              'Authorization': 'Token ' + config.backend.token,
            },
            form: params
        };
        console.log(options);
        request.post(options, function (error, response, body) {
            if (!response) {
                Log.error('Empty response from backend at service function');
                callback('Empty response from backend at service function');
                return false;
            }
            console.log(error);
            console.log(response.statusCode);
            if (!error && response.statusCode === 200) {
                callback(null, body);
            } else {
                callback(error);
            }
        });
    }
}

module.exports = new Firebase();
