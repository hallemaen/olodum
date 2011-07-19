/* TODO : 
 - refactor ipv4/ipv6/ns ? (=> use an object ?)
 - develop and isolate a resolver
 - use a configuration file (wait for vvo's one)
 - log with a syslog-like utility in PROD env (ain ?)

process.env.NODE_DEV only accessible in sudo if added to the user env variable then exported :
$ NODE_ENV=dev
$ export NODE_ENV
$ sudo visudo
=> add this line
Defaults        env_keep += "NODE_ENV"
*/

// requires
var os = require('os');
var exec = require('child_process').exec;
var ndns = require('./lib/ndns');
var dnsServer = ndns.createServer('udp4');
var client = ndns.createClient('udp4');

// Const
var TTL = 5; // default TTL in DEV env
var REMOTE_HOST = "208.67.222.222" //openDNS
var REMOTE_PORT = 53;
var BIND_PORT = 53;
var isDev = (process.env.NODE_ENV === 'dev');
var osType = os.type();

// growl notification for DEV ENV
//growl = require('growl');

function log(msg) {
	if (isDev) {
		//growl.notify(msg, { title: 'Fasterize Local DNS Server'})
		console.log(Date() + msg)
	}
	else {
		//syslog(msg)
		console.log(Date() + msg)
	}
};

function exitServer () {
	log('Detected closing signal.');
  	child = exec('Networksetup -setdnsservers "AirPort" "Empty"', function (error) {
		if (error !== null) {
			log('exec error: ' + error);
  	    }
  	    log('Networksetup rules has been removed');
	    log('Stopping Olodum Server');
	    process.exit(0);
  	});
};


//if ENV DEV, register as a local DNS (ENV DEV = mac os / Wifi)
if (isDev) {
	// Change DNS Server IP with networksetup
	child = exec('networksetup -setdnsservers "AirPort" 127.0.0.1', function (error) {
		if (error !== null) {
			log('exec error: ' + error);
		}
		log('Networksetup rules has been added');
	});
}

// Temp : IP in the code, not in a global conf
var ipv4s = [];
if (!isDev) {
	TTL=300;
	ipv4s.push('31.222.176.200');
	//ipv4s.push('31.222.176.201');
}
else {
	ipv4s.push('127.0.0.1');
}
var ipv6s = [];
//ipv6s.push('2002:0:0:0:0:0:1fde:b0c8');
var nss = [];
nss.push('ns1.fasterized.com');
var ips;
var first;


var olodum = function (){
	var mainListener = function (req, res) {
		// duplicate query headers in response
	    res.setHeader(req.header);

		//process all subqueries
	    for (var i = 0; i < req.q.length; i++) {
			//parse query and add it to the response object
			res.addQuestion(req.q[i]);

			//set some response headers
			res.header.aa = 1;         // authoritative answer
			res.header.ra = 0;
			res.header.qr = 1;			// Message type = response
			res.header.rd = 0;
			res.header.arcount = 0;		// number of Additional Records
	
			// domain name queried
			var name = (req.q[0].name === '.' ? '' : req.q[0].name);

			// only respond to query ending with fasterized.com, otherwise proxy request
			if (!isDev) {
				var type = req.q[i].type
				// This server only respond to A or AAAA or NS query
				if (type == ndns.ns_type.ns_t_a || (type == ndns.ns_type.ns_t_aaaa && ipv6s.length > 0) || (type == ndns.ns_type.ns_t_ns) ) {
					res.header.nscount = 1;		// number of NS records
					//add all records in ips array to response 
					if (type == ndns.ns_type.ns_t_a) {
						ips = ipv4s;
						first = "A";
					}
					else if (type == ndns.ns_type.ns_t_aaaa) {
						ips = ipv6s;
						first = "A";
					}
					else if (type == ndns.ns_type.ns_t_ns) {
						ips = nss;
					}
					//set unmber of Resource Record
					res.header.ancount = ips.length;
					for (var j = 0; j < ips.length; j++) {
						res.addRR(name,TTL,"IN",p_type_syms[type],ips[j]);
					} 
					//add an NS record for Authority Response or A record for NS query
					if (first === 'A') {
						res.addRR(name, 10, "IN", "NS", 'ns1.fasterized.com');					
					}
					else {
						res.addRR('ns1.fasterized.com', 10, "IN", "A", '31.222.176.247');
					}
				}
				//send 0 response to queries other than A / AAAA / NS
				else {
					res.header.ancount = 0;
				}
				res.send();
			}
			//DEV env : proxy request DNS except "fasterized.com" domains
			else {
				var c_req = client.request(REMOTE_PORT, REMOTE_HOST);
				//set Recursive Desire bit (to resolve CNAME for example)
				req.setHeader({rd: 1});
			    c_req.on("response", function (c_res) {
					//hook DNS response with local IP if "fasterized.com" domain
					for (var j = 0 ; j < c_res.rr.length ; j++) {
						if (c_res.rr[j].type !== 2 && c_res.rr[j].name.indexOf('.fasterized.com') !== -1) {
							c_res.rr[j].rdata.a = '127.0.0.1'
							c_res.rr[j].rdata[0] = '127.0.0.1'
						}
					}
					res.send(c_res);
			    });
			    c_req.send(req);
			}
		}
	}

	dnsServer.on("request", mainListener);
	log('Starting process '+ process.pid +' in environment : ' + process.env.NODE_ENV + ' on port ' + BIND_PORT);
	return function () {
		dnsServer.bind(BIND_PORT);
		//if DEV env, unregister local DNS server on exit else just trap exception
		if (isDev) {
			process.stdin.resume();
			process.on('SIGINT', exitServer);
			process.on('SIGTERM', exitServer);
		}
		else {
			process.on('uncaughtException', function (err) {
				log('Caught exception: ' + err);
			});
		}
	}
}();

exports.olodum = olodum;
