var Promise = require('bluebird');
var request = require('sync-request');
var fs = Promise.promisifyAll(require('react-native-fs'));
var aesDecrypter = require('aes-decrypter').Decrypter;
var path = require('path');

var writeFile = function(file, content) {
  return fs.mkdir(path.dirname(file), { NSURLIsExcludedFromBackupKey: true }).then(function() {
    return fs.writeFile(file, content);
  }).then(function() {
    console.log('Finished: ' + path.relative('.', file));
  });
};

var requestFile = function(uri) {
  var options = {
    uri: uri,
    timeout: 60000, // 60 seconds timeout
    encoding: null, // treat all responses as a buffer
    headers
  };
  return new Promise(function(resolve, reject) {
    request(options, function(err, response, body) {
      if (err) {
        return reject(err);
      }
      return resolve(body);
    });
  });
};

var toArrayBuffer = function(buffer) {
  var ab = new ArrayBuffer(buffer.length);
  var view = new Uint8Array(ab);
  for (var i = 0; i < buffer.length; ++i) {
    view[i] = buffer[i];
  }
  return ab;
};

var decryptFile = function(content, encryption) {
  return new Promise(function(resolve, reject) {
    var d = new aesDecrypter(new DataView(toArrayBuffer(content)), encryption.bytes, encryption.iv, function(err, bytes) {
      return resolve(new Buffer(bytes));
    });
  });
};

var WriteData = function(decrypt, concurrency, resources, headers) {
  var inProgress = [];
  var operations = [];

  resources.forEach(function(r) {
    if (r.content) {
      operations.push(function() { return writeFile(r.file, r.content); });
    } else if (r.key && decrypt) {
      operations.push(function() {
        return requestFile(r.uri, headers).then(function(content) {
          return decryptFile(content, r.key);
        }).then(function(content) {
          return writeFile(r.file, content);
        });
      });
    } else if (inProgress.indexOf(r.uri) === -1) {
      operations.push(function() {
        return requestFile(r.uri, headers).then(function(content) {
          return writeFile(r.file, content);
        });
      });
      inProgress.push(r.uri);
    }
  });

  return Promise.map(operations, function(o) {
    return Promise.join(o());
  }, {concurrency: concurrency}).all(function(o) {
    console.log('DONE!');
    return Promise.resolve();
  });
};

module.exports = WriteData;
