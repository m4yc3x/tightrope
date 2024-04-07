const vscode = require('vscode');
const editorActions = require('../ui/EditorActions');
const fs = require('fs');
const path = require('path');
const os = require('os');
const CompressionProvider = require('./CompressionProvider');

/**
 * Manages communication for the code-sharing extension, including sending and handling messages
 * over WebRTC data channels.
 */
class CommunicationManager {

    /**
     * The decoration type for the peer's selection range.
     */
    static decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'purple',
        color: 'white',
        borderRadius: '4px',
        opacity: '0.8',
        overviewRulerColor: 'lime',
        after: {
            contentText: '👀',
            margin: '-20px 0 0 0',
            color: 'white',
            border: 'solid 1px white',
            borderRadius: '6px',
        }
    });

    /**
     * Sends a Network File System (NFS) update to a peer via the data channel.
     * The update is chunked into segments to accommodate message size limitations.
     *
     * @param {RTCDataChannel} dataChannel - The WebRTC data channel for communication.
     * @param {string} structureJson - The JSON string representation of the file system structure.
     */
    static sendNFSUpdate(dataChannel, structureJson) {
        const MAX_CHUNK_SIZE = 14000; // 14KB
        const encodedStructure = Buffer.from(structureJson).toString('base64');
        const totalChunks = Math.ceil(encodedStructure.length / MAX_CHUNK_SIZE);
    
        for (let i = 0; i < totalChunks; i++) {
            const start = i * MAX_CHUNK_SIZE;
            const end = start + MAX_CHUNK_SIZE;
            const chunk = encodedStructure.substring(start, end);
            const chunkMessage = `nfsupdate ${i} ${totalChunks} ${chunk}`;
            dataChannel.send(chunkMessage);
        }
    }

    /**
     * Sends a file data update to a peer via the data channel.
     * The update is chunked into segments to accommodate message size limitations.
     *
     * @param {RTCDataChannel} dataChannel - The WebRTC data channel for communication.
     * @param {string} filePath - The file path of the file being sent.
     * @param {string} fileData - The file data to send.
     */
    static sendFileData(dataChannel, filePath, fileData) {
        const MAX_CHUNK_SIZE = 12000; // 14KB
        const totalChunks = Math.ceil(fileData.length / MAX_CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * MAX_CHUNK_SIZE;
            const end = start + MAX_CHUNK_SIZE;
            const chunk = fileData.substring(start, end);
            const chunkMessage = `fileData ${filePath} ${i} ${totalChunks} ${chunk}`;
            dataChannel.send(chunkMessage);
        }
    }

    /**
     * Sends a file data update to a peer via the data channel.
     * The update is chunked into segments to accommodate message size limitations.
     *
     * @param {RTCDataChannel} dataChannel - The WebRTC data channel for communication.
     * @param {string} filePath - The file path of the file being sent.
     * @param {string} fileData - The file data to send.
     */
    static sendEdit(dataChannel, filePath, change) {
        const changeObject = {
            range: {
                start: {
                    line: change.range.start.line,
                    character: change.range.start.character,
                },
                end: {
                    line: change.range.end.line,
                    character: change.range.end.character,
                }
            },
            text: change.text
        };

        const changeString = JSON.stringify(changeObject);
        const encodedChange = Buffer.from(changeString).toString('base64');
        const MAX_CHUNK_SIZE = 10000; // 10KB
        const totalChunks = Math.ceil(encodedChange.length / MAX_CHUNK_SIZE);
    
        for (let i = 0; i < totalChunks; i++) {
            const start = i * MAX_CHUNK_SIZE;
            const end = start + MAX_CHUNK_SIZE;
            const chunk = encodedChange.substring(start, end);
            const chunkMessage = `applyEdit ${filePath} ${i} ${totalChunks} ${chunk}`;
            dataChannel.send(chunkMessage);
        }
    }

    /**
     * Handles incoming messages from peers, parsing the message type and executing
     * the corresponding action.
     *
     * @param {string} message - The received message as a string.
     * @param {ConnectionProvider} ConnectionProvider - The connection provider instance managing the session.
     */
    static handleMessage(message, ConnectionProvider) {
        const messageParts = message.split(' ');

        switch (messageParts[0]) {

            case "ping":
                ConnectionProvider.dataChannel.send("pong");
                break;

            case 'pong':
                vscode.window.showInformationMessage('Pong!');
                break;

            case 'greeting':
				ConnectionProvider.peerList.push({id: messageParts[1], username: Buffer.from(messageParts[2], 'base64').toString('utf8')});
				ConnectionProvider.treeDataProvider.setPeerList(ConnectionProvider.peerList);
				ConnectionProvider.treeDataProvider.setStatus("Connected!");
				ConnectionProvider.treeDataProvider.setHost(messageParts[1]);

                vscode.window.showInformationMessage('Peer Connected: (' + Buffer.from(messageParts[2], 'base64').toString('utf8') + ": " + messageParts[1] + ") ");

                if (ConnectionProvider.creator) {
                    // Send the creator's file system
                    const structureJson = JSON.stringify(ConnectionProvider.structure.getStructure());
                    this.sendNFSUpdate(ConnectionProvider.dataChannel, structureJson);
                    setInterval(() => {
                        if (ConnectionProvider.structure.detectChanges()) {
                            const structureJson = JSON.stringify(ConnectionProvider.structure.getStructure());
                            this.sendNFSUpdate(ConnectionProvider.dataChannel, structureJson);
                        }
                    }, 5000);
                }

                break;

            case "disconnect":
                const index = ConnectionProvider.peerList.indexOf(messageParts[1]);
                if (index > -1) {
                    ConnectionProvider.peerList.splice(index, 1);
                }
                ConnectionProvider.treeDataProvider.setPeerList(ConnectionProvider.peerList);

                break;

            case "nfsupdate":
                // Assuming the message format is "nfsupdate nfsChunkIndex totalChunks chunkData"
                const nfsChunkIndex = parseInt(messageParts[1], 10);
                const nfsTotalChunks = parseInt(messageParts[2], 10);
                const nfsChunkData = messageParts.slice(3).join(' ');
    
                if (!ConnectionProvider.nfsUpdateChunks) {
                    ConnectionProvider.nfsUpdateChunks = new Array(nfsTotalChunks).fill(null);
                }
    
                ConnectionProvider.nfsUpdateChunks[nfsChunkIndex] = nfsChunkData;
    
                // Check if all chunks have been received
                const nfsAllChunksReceived = ConnectionProvider.nfsUpdateChunks.every(chunk => chunk !== null);
                if (nfsAllChunksReceived) {
                    const fullData = ConnectionProvider.nfsUpdateChunks.join('');
                    let structure = JSON.parse(Buffer.from(fullData, 'base64').toString('utf8'));
                    ConnectionProvider.treeDataProvider.setStructure(structure);
                    // Reset the chunks array for future updates
                    ConnectionProvider.nfsUpdateChunks = null;
                }
                break;
            
            case "requestFile":
                if (ConnectionProvider.creator && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                    const filePath = messageParts[1];
                    if (filePath.startsWith(workspaceRoot)) {
                        // File path is within the workspace, proceed with sending file data
                        const fileData = fs.readFileSync(filePath, 'utf8');
                        const encodedFileData = Buffer.from(fileData).toString('base64');
                        this.sendFileData(ConnectionProvider.dataChannel, filePath, encodedFileData);
                    } else {
                        vscode.window.showErrorMessage('Peer requested file outside of workspace.');
                        return;
                    }
                } else {
                    //vscode.window.showErrorMessage('Only the session creator can send files.');
                    return;
                }
                break;

            case "fileData":
                const filePath = messageParts[1];
                const fileChunkIndex = parseInt(messageParts[2], 10);
                const fileTotalChunks = parseInt(messageParts[3], 10);
                const fileChunkData = messageParts.slice(4).join(' ');
            
                if (!ConnectionProvider.fileDataChunks) {
                    ConnectionProvider.fileDataChunks = new Array(fileTotalChunks).fill(null);
                }
            
                ConnectionProvider.fileDataChunks[fileChunkIndex] = fileChunkData;
            
                // Check if all chunks have been received
                const fileAllChunksReceived = ConnectionProvider.fileDataChunks.every(chunk => chunk !== null);
                if (fileAllChunksReceived) {
                    const fileFullData = ConnectionProvider.fileDataChunks.join('');
                    let fileContent = Buffer.from(fileFullData, 'base64').toString('utf8');
                    const tempFilePath = path.join(os.tmpdir(), "tightrope-code", filePath);
                    fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
                    fs.writeFileSync(tempFilePath, fileContent);
                    vscode.workspace.openTextDocument(tempFilePath).then(document => {
                        vscode.window.showTextDocument(document, { preview: false });
                    });
                    // Reset the chunks array for future updates
                    ConnectionProvider.fileDataChunks = null;
                }
                break;

            case "applyEdit":
                const editChunkIndex = parseInt(messageParts[2], 10);
                const editTotalChunks = parseInt(messageParts[3], 10);
                const eFilePath = Buffer.from(messageParts[1], 'base64').toString('utf8');
                const editingChunkData = messageParts.slice(4).join(' ');
            
                if (!ConnectionProvider.editDataChunks) {
                    ConnectionProvider.editDataChunks = new Array(editTotalChunks).fill(null);
                }

                vscode.window.showInformationMessage("applyEdit received.");
            
                ConnectionProvider.editDataChunks[editChunkIndex] = editingChunkData;
            
                // Check if all chunks have been received
                const editAllChunksReceived = ConnectionProvider.editDataChunks.every(chunk => chunk !== null);
                if (editAllChunksReceived) {
                    const editFullData = ConnectionProvider.editDataChunks.join('');
                    let editObject = JSON.parse(Buffer.from(editFullData, 'base64').toString('utf8'));
            
                    vscode.window.showInformationMessage("Full chunk received.");
            
                    // Peer: Check if file is open in an active editor or exists in temp directory
                    const openEditor = vscode.window.visibleTextEditors.find(editor => path.basename(editor.document.uri.fsPath) == path.basename(eFilePath));
                    if (openEditor) {
                        // Apply edit to open document
                        const workSpaceEdit = new vscode.WorkspaceEdit();
                        const range = new vscode.Range(
                            new vscode.Position(editObject.range.start.line, editObject.range.start.character),
                            new vscode.Position(editObject.range.end.line, editObject.range.end.character)
                        );
                        workSpaceEdit.replace(openEditor.document.uri, range, editObject.text);
                        vscode.workspace.applyEdit(workSpaceEdit);
                    }
            
                    // Reset the chunks array for future updates
                    ConnectionProvider.editDataChunks = null;
                }
                break;

            case "selectionChange":
                const [_, receivedFilePath, receivedFileName, receivedParentFolder, sStartLine, sStartChar, sEndLine, sEndChar] = messageParts;
                const activeEditor = vscode.window.activeTextEditor;

                // TODO : CHECK PARENT FOLDER
                if ( activeEditor && path.basename(activeEditor.document.uri.fsPath) == receivedFileName ) {
                    // Inside the "selectionChange" case in the handleMessage function
                    
                    activeEditor.setDecorations(this.decorationType, []);

                    const range = new vscode.Range(new vscode.Position(parseInt(sStartLine), parseInt(sStartChar)), new vscode.Position(parseInt(sEndLine), parseInt(sEndChar)));
                    activeEditor.setDecorations(this.decorationType, [range]);
                }
                break;
        }
    }
}

module.exports = { CommunicationManager };

