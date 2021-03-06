/**
 * Copyright 2016 IBM All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
// This is Sample end-to-end standalone program that focuses on exercising all
// parts of the fabric APIs in a happy-path scenario
'use strict';

var log4js = require('log4js');
var logger = log4js.getLogger('DEPLOY');
var config = require('./config.json');
var helper = require('./helper.js');
var hfc = require('fabric-client');

var path = require('path');
var util = require('util');
var utils = require('fabric-client/lib/utils.js');
var Peer = require('fabric-client/lib/Peer.js');
var Orderer = require('fabric-client/lib/Orderer.js');
var EventHub = require('fabric-client/lib/EventHub.js');
var helper = require('./helper.js');

logger.setLevel('DEBUG');

var client = new hfc();
var chain;
var eventhub;
var chaincodeID;
var channelID;
var CHAINCODE_PATH;
var peers = [];
var webUser = null;
var tx_id = null;
var nonce = null;
process.env.GOPATH = config.goPath;

init();

function init() {
	chain = client.newChain(config.chainName);
	chaincodeID = config.chaincodeID;
	channelID = config.channelID;
	CHAINCODE_PATH = config.chaincodePath;
	setupNetwork();
}

function setupNetwork() {
	chain.addOrderer(new Orderer(config.orderer.orderer_url));
	eventhub = new EventHub();
	eventhub.setPeerAddr(config.events[0].event_url);
	eventhub.connect();
	for (var i = 0; i < config.peers.length; i++) {
		peers.push(new Peer(config.peers[i].peer_url));
		chain.addPeer(peers[i]);
	}
}

hfc.newDefaultKeyValueStore({
	path: config.keyValueStore
}).then(function(store) {
	client.setStateStore(store);
	var users = config.users;

	return helper.getSubmitter(client);
}).then(
		function(admin) {
			logger.info('Successfully enrolled user \'admin\'');
			webUser = admin;

			logger.info('Executing Deploy');
			tx_id = helper.getTxId();
			nonce = utils.getNonce();
			var args = helper.getArgs(config.deployRequest.args);
			// send proposal to endorser
			var request = {
				chaincodePath: CHAINCODE_PATH,
				chaincodeId: chaincodeID,
				fcn: config.deployRequest.functionName,
				args: args,
				chainId: channelID,
				txId: tx_id,
				nonce: nonce,
				'dockerfile-contents': config.dockerfile_contents
			};
			return chain.sendDeploymentProposal(request);
		},
		function(err) {
			logger.error('Failed to enroll user \'admin\'. ' + err);
		}
).then(
	function(results) {
		return helper.processProposal(chain, results, 'deploy');
	},
	function(err) {
		logger.error('Failed to send deployment proposal due to error: ' + err.stack ? err.stack : err);
	}
).then(
	function(response) {
		if (response.status === 'SUCCESS') {
			logger.info('Successfully sent deployment transaction to the orderer.');
			return new Promise((resolve, reject) => {
				var handle = setTimeout(reject, parseInt(config.waitTime));

				eventhub.registerTxEvent(tx_id.toString(), (tx) => {
					logger.info('The chaincode transaction has been successfully committed');
					clearTimeout(handle);
					eventhub.disconnect();
					resolve();
				});
			});
		} else {
			process.exit();
			logger.error('Failed to order the deployment endorsement. Error code: ' + response.status);
		}
	}
).catch(
	function(err) {
		eventhub.disconnect();
		logger.error('Failed to send deployment e due to error: ' + err.stack ? err.stack : err);
	}
);
