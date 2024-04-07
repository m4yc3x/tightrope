const vscode = require('vscode');
const UI = require('./ui/TreeDataProvider');
const cp = require('./network/ConnectionProvider');
const network = require('./network/CommunicationManager');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Initialize the tree data provider for the extension's view
let treeDataProvider = new UI.TightropeTreeDataProvider();
// Variable to hold the connection provider instance
let connectionProvider;

/**
 * This function is called when the extension is activated.
 * It sets up the UI components, registers commands, and handles their callbacks.
 * 
 * @param {vscode.ExtensionContext} context - The context in which the extension is executed.
 */
function activate(context) {

	// UI SETUP

	// Create a TreeView with the ID 'tightropeTreeView' using the treeDataProvider
	vscode.window.createTreeView('tightropeTreeView', { treeDataProvider });

	// Add the treeDataProvider to the context's subscriptions to ensure proper disposal
	context.subscriptions.push(treeDataProvider);

	// COMMAND REGISTRATIONS

	// Register command for creating a new session
	let createSession = vscode.commands.registerCommand('tightrope.createSession', function () {
		// Retrieve the saved username
		const savedUsername = vscode.workspace.getConfiguration().get('tightrope.username');
  
		// Show an input box with the saved username as the default value
		vscode.window.showInputBox({ 
		  prompt: 'Enter your username for the session', 
		  value: savedUsername 
		}).then((username) => {
		  // Save the entered username for future sessions
		  vscode.workspace.getConfiguration().update('tightrope.username', username, vscode.ConfigurationTarget.Global);
		  
		  // Show a message indicating that the user is creating a session
		  vscode.window.showInformationMessage('Creating Tightrope Session...');

		  // Update the state to reflect that the creator is connected
		  treeDataProvider.setState(UI.State.CREATOR_CONNECTED);

		  // Initialize the connection provider as a CREATOR with the provided username
		  connectionProvider = new cp.ConnectionProvider(treeDataProvider, cp.Role.CREATOR, username);
		});
	});

	// Register command for joining an existing session
	let joinSession = vscode.commands.registerCommand('tightrope.joinSession', function () {
		const savedUsername = vscode.workspace.getConfiguration().get('tightrope.username');

		// Prompt the user to enter their username
		vscode.window.showInputBox({ 
			prompt: 'Enter your username for the session', 
			value: savedUsername 
		  }).then((username) => {
			// Prompt the user to enter the Host Share-Key
			vscode.window.showInputBox({ prompt: 'Enter Host Share-Key to join the session' }).then((hostId) => {
				if (!hostId) {
					// If no Host Share-Key is provided, show an error message
					vscode.window.showErrorMessage('Host Share-Key is required to join a session.');
					return;
				}

				// Save the entered username for future sessions
				vscode.workspace.getConfiguration().update('tightrope.username', username, vscode.ConfigurationTarget.Global);

				// Show a message indicating that the user is joining a session
				vscode.window.showInformationMessage('Joining Tightrope Session...');

				// Update the state to reflect that the joiner is connected
				treeDataProvider.setState(UI.State.JOINER_CONNECTED);

				// Initialize the connectionProvider as a JOINER with the provided username and hostId
				connectionProvider = new cp.ConnectionProvider(treeDataProvider, cp.Role.JOINER, username, hostId);
			});
		});
	});

	// Register command for sending a message
	let sendMessage = vscode.commands.registerCommand('tightrope.sendMessage', function () {
		// Prompt the user to enter a message
		vscode.window.showInputBox({ prompt: 'Enter message to send' }).then((message) => {
			if (!message) {
				// If no message is entered, show an error message
				vscode.window.showErrorMessage('Message is required to send.');
				return;
			}
			// Send the message through the dataChannel of the connectionProvider
			connectionProvider.dataChannel.send(message);
		});
	});

	// Register command for disconnecting from the session
	let disconnect = vscode.commands.registerCommand('tightrope.disconnect', function () {
		// Show a message indicating that the user is disconnecting
		vscode.window.showInformationMessage('Disconnecting from Tightrope Session...');
		// Update the state to DISCONNECTED
		treeDataProvider.setState(UI.State.DISCONNECTED);

		// Send a disconnect message with the clientId through the dataChannel
		connectionProvider.sendDisconnect();

		// Close the WebRTC connection and the WebSocket connection
		if (connectionProvider.connection)
			connectionProvider.connection.close();

		if (connectionProvider.ws)
			connectionProvider.ws.close();
	});

	// Register command for opening a file
	let openFileCommand = vscode.commands.registerCommand('tightrope.openFile', async (fullPath) => {
		try {
			//vscode.window.showInformationMessage('Opening file: ' + fullPath);
			if (connectionProvider.role === cp.Role.CREATOR) {
				// Host opens the file fully in an editor
				const document = await vscode.workspace.openTextDocument(fullPath);
				await vscode.window.showTextDocument(document, { preview: false });
			} else if (connectionProvider.role === cp.Role.JOINER) {
				// Peer requests file data
				// This is a placeholder for requesting file data. Implement according to your data channel communication logic.
				connectionProvider.requestFileData(fullPath);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Error opening file: ${error.message}`);
		}
    });

	// Fire the editor selection event over a data channel
	vscode.window.onDidChangeTextEditorSelection(event => {
		if (connectionProvider && connectionProvider.dataChannel) {
			const selection = event.selections[0];
			const filePath = event.textEditor.document.uri.fsPath;
			const fileName = path.basename(filePath);
			const parentFolder = path.dirname(filePath);
			const message = `selectionChange ${filePath} ${fileName} ${parentFolder} ${selection.start.line} ${selection.start.character} ${selection.end.line} ${selection.end.character}`;
			connectionProvider.dataChannel.send(message);
		}
	});

	// Fire the editor text change event over a data channel
	vscode.workspace.onDidChangeTextDocument(event => {
		if (connectionProvider && connectionProvider.dataChannel) {
			const document = event.document;
			const filePath = Buffer.from(document.uri.fsPath).toString('base64');
			event.contentChanges.forEach(change => {
				network.sendEdit(connectionProvider.dataChannel, filePath, change);
			});
		}
	});

	// Add the commands to the context's subscriptions for proper disposal
	context.subscriptions.push(createSession, joinSession, sendMessage, disconnect, openFileCommand);
}

/**
 * This method is called when the extension is deactivated.
 * It ensures that the extension cleans up its connections properly.
 */
function deactivate() {
	// Disconnect
	if (connectionProvider) {
		// Send a disconnect message to the other client
		connectionProvider.sendDisconnect();

		// Close the WebRTC connection and the WebSocket connection
		if (connectionProvider.connection)
			connectionProvider.connection.close();

		if (connectionProvider.ws)
			connectionProvider.ws.close();
	}

	// Remove temp directory if it exists
	const tempDirPath = path.join(os.tmpdir(), "tightrope-code");
	if (fs.existsSync(tempDirPath)) {
		fs.rmdirSync(tempDirPath, { recursive: true });
	}
}

// Export the activate and deactivate functions so that VS Code can call them
module.exports = {
	activate,
	deactivate,
	treeDataProvider
}