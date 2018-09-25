var path = require('path');

exports.logMsg = function (msg) {
  var d = new Date();
  d = d.toDateString() + ' ' + d.toLocaleTimeString();
  console.log(d + '\t' + msg)
};


