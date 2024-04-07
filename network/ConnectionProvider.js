// Required modules for VS Code API, WebSocket, WebRTC, and internal modules
const vscode = require('vscode');
const WebSocket = require('ws');
const wrtc = require('wrtc');
const network = require('./CommunicationManager');
const nfs = require('./NetworkFileSystem');

// Configuration for signaling server and STUN servers
const signalingServerUrl = "ws://chabber.top:6789";
const stunServers = {
	iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// Role definitions for session participants
const Role = {
    CREATOR: 'creator',
    JOINER: 'joiner'
}

/**
 * Manages connections between peers in a code-sharing session using WebRTC and signaling server.
 * It handles the creation and management of WebRTC PeerConnections, DataChannels, and signaling.
 */
class ConnectionProvider {

    /**
     * Initializes a new instance of the ConnectionProvider class.
     * 
     * @param {TightropeTreeDataProvider} treeDataProvider - The tree data provider for updating the UI.
     * @param {string} role - The role of the current instance (CREATOR or JOINER).
     * @param {string} [username=null] - The username for the session. A random username is generated if not provided.
     * @param {string} [hostId=null] - The ID of the host to connect to. Required for JOINER role.
     */
    constructor(treeDataProvider, role, username = null, hostId = null) {
        if (username == "" || username == null) username = "user"+this.generateRandomID(6);

        this.role = role;
        this.creator = (role == Role.CREATOR);
        this.treeDataProvider = treeDataProvider;
        this.clientId = this.generateRandomID();
        this.username = username;
		this.peerList = [];
		this.hostId = hostId;
        this.signalingServerUrl = signalingServerUrl;
        this.connection = null; // WebRTC PeerConnection
        this.dataChannel = null; // WebRTC DataChannel
        this.nfsUpdateChunks = null;
        this.fileDataChunks = null;
        this.editChunkData = null;
        this.ws = new WebSocket(signalingServerUrl); // WebSocket connection to the signaling server

        // Set up network file system
        if (this.role == Role.CREATOR) {
            if (vscode.workspace.workspaceFolders.length < 1) {
                vscode.window.showErrorMessage('No workspace folder found!');
                return;
            }
            this.structure = new nfs.NetworkFileSystem(vscode.workspace.workspaceFolders[0].uri.fsPath, this.treeDataProvider);
        } else {
            this.structure = new nfs.NetworkFileSystem(null, this.treeDataProvider);
        }

        this.treeDataProvider.setStatus('Connecting to signaling server...');

        this.ws.on('open', () => {
            // Register with the signaling server
            this.sendToSignalingServer({
                type: 'register',
                id: this.clientId
            });

            this.treeDataProvider.setStatus('Ready, awaiting peer...');
            
            if (this.role == Role.CREATOR) {
                vscode.env.clipboard.writeText(this.clientId);
                vscode.window.showInformationMessage('Copied share-key to clipboard: ' + this.clientId);
            } else if (this.role == Role.JOINER && this.hostId != null) {
				this.createOffer(this.hostId).then(() => {
					this.treeDataProvider.setStatus('Offer sent to host.');
				}).catch((error) => {
					console.error('Error sending offer to host:', error);
					this.treeDataProvider.setStatus('Error sending offer to host.');
				});
			}

            this.treeDataProvider.setIdentity(this.username, this.clientId);
        });

        this.ws.on('message', async (message) => {
            const data = JSON.parse(message);
            switch (data.type) {
                case 'offer':
                    await this.handleOffer(data.offer, data.from);
                    this.treeDataProvider.setStatus('Received an offer!');
                    break;
                case 'answer':
                    await this.handleAnswer(data.answer);
                    this.treeDataProvider.setStatus('Received an answer!');
                    break;
                case 'candidate':
                    await this.handleCandidate(data.candidate);
                    this.treeDataProvider.setStatus('Received a candidate!');
                    break;
                default:
                    console.log('Unknown message type:', data.type);
                    this.treeDataProvider.setStatus(`Received a unknown signal: ${data.type}!`);
            }
        });
    }

    /**
     * Generates a random ID string.
     * 
     * @param {number} [length=16] - The length of the ID to generate.
     * @returns {string} A random ID string.
     */
    generateRandomID(length = 16) {
        const characters = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefghkmnopqrsuvwxyz023456789';
        let result = '';
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }

    /**
     * Sends a message to the signaling server via WebSocket.
     * 
     * @param {Object} message - The message to send.
     */
    sendToSignalingServer(message) {
        this.ws.send(JSON.stringify(message));
    }

    /**
     * Creates a WebRTC offer for connecting to a host.
     * 
     * @param {string} host - The ID of the host to connect to.
     * @returns {Promise<void>} A promise that resolves when the offer is sent.
     */
    async createOffer(host) { //joiner entry
        this.connection = new wrtc.RTCPeerConnection(stunServers);
        this.dataChannel = this.connection.createDataChannel("dataChannel", { maxMessageSize: 1e9 });

		this.dataChannel.onopen = () => {
			this.treeDataProvider.setStatus("Sent a greeting!");
			this.dataChannel.send("greeting " + this.clientId + " " + Buffer.from(this.username).toString('base64'));
		};

		this.dataChannel.onmessage = async (event) => {
			//vscode.window.showInformationMessage('Received Message: ' + event.data);
			await network.CommunicationManager.handleMessage(event.data, this);
		};

        this.connection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendToSignalingServer({
                    type: 'candidate',
                    candidate: event.candidate,
                    to: host,
					from: this.clientId
                });
                this.treeDataProvider.setStatus("Sent a candidate!");
            }
        };

        const offer = await this.connection.createOffer();
        await this.connection.setLocalDescription(offer);

        this.sendToSignalingServer({
            type: 'offer',
            offer: offer,
            to: host,
			from: this.clientId
        });
        this.treeDataProvider.setStatus("Sent an offer!");
    }

    /**
     * Handles an offer received from a peer.
     * 
     * @param {RTCSessionDescriptionInit} offer - The offer received.
     * @param {string} from - The ID of the peer that sent the offer.
     * @returns {Promise<void>} A promise that resolves when the offer is handled.
     */
    async handleOffer(offer, from) { // creator entry
        this.connection = new wrtc.RTCPeerConnection(stunServers);
        this.connection.ondatachannel = (event) => {
            this.dataChannel = event.channel;

			this.dataChannel.onopen = () => {
                this.treeDataProvider.setStatus("Sent a greeting!");
				this.dataChannel.send("greeting " + this.clientId + " " + Buffer.from(this.username).toString('base64'));
			};

			this.dataChannel.onmessage = async (event) => {
                //vscode.window.showInformationMessage('Received Message: ' + event.data);
				await network.CommunicationManager.handleMessage(event.data, this, this.creator);
			};
        };
		
        this.connection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendToSignalingServer({
                    type: 'candidate',
                    candidate: event.candidate,
                    to: from,
					from: this.clientId
                });
                this.treeDataProvider.setStatus("Sent a candidate!");
            }
        };

        await this.connection.setRemoteDescription(new wrtc.RTCSessionDescription(offer));
        const answer = await this.connection.createAnswer();
        await this.connection.setLocalDescription(answer);

        this.sendToSignalingServer({
            type: 'answer',
            answer: answer,
            to: from,
			from: this.clientId
        });
        this.treeDataProvider.setStatus("Sent an answer!");
    }

    /**
     * Handles an answer received from a peer.
     * 
     * @param {RTCSessionDescriptionInit} answer - The answer received.
     * @returns {Promise<void>} A promise that resolves when the answer is handled.
     */
    async handleAnswer(answer) {
        await this.connection.setRemoteDescription(new wrtc.RTCSessionDescription(answer));
    }

    /**
     * Handles a new ICE candidate received from a peer.
     * 
     * @param {RTCIceCandidateInit} candidate - The ICE candidate received.
     * @returns {Promise<void>} A promise that resolves when the candidate is added to the connection.
     */
    async handleCandidate(candidate) {
        await this.connection.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
    }

    
    /**
     * Requests file data from a peer through the data channel.
     * 
     * @param {string} filePath - The path of the file being requested.
     * @returns {void}
     */
    requestFileData(filePath) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send("requestFile " + filePath);
        } else {
            console.error("Data channel is not open. Cannot send file request.");
        }
    }

    /**
     * Sends a disconnect message through the data channel.
     */
    sendDisconnect() {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send("disconnect " + this.clientId);
        }
    }
}

// Export the ConnectionProvider class and Role object for use in other modules
module.exports = { ConnectionProvider, Role };

