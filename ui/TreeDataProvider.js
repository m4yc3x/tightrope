const vscode = require('vscode');

// Define the possible states of the connection
const State = {
	DISCONNECTED: "disconnected",
	CREATOR_CONNECTED: "creatorConnected",
	JOINER_CONNECTED: "joinerConnected"
};

/**
 * Provides data for the tree view in the VS Code UI, managing the state, status, host, peer list, and file structure.
 * It supports dynamic updates to the tree view based on changes in connection state or file structure.
 */
class TightropeTreeDataProvider {

  /**
   * Initializes the class with default values.
   */
  constructor(username, clientId) {
    // Event emitter for when tree data changes
    this._onDidChangeTreeData = new vscode.EventEmitter();
    // Public event tied to the private event emitter
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    // Initial state is disconnected
    this.state = State.DISCONNECTED;
		this.status = "Disconnected";
    this.username = "N/A";
    this.clientId = "N/A";
		this.host = "None";
		this.peerList = [];
    this.structure = {};
  }

  /**
   * Sets the current state and refreshes the tree view.
   * @param {string} newState - The new state to set.
   */
  setState(newState) {
    this.state = newState;
    this.refresh();
  }

  /**
   * Sets the current status and refreshes the tree view.
   * @param {string} newStatus - The new status to set.
   */
  setStatus(newStatus) {
    this.status = newStatus;
    this.refresh();
  }

  /**
   * Sets the current host and refreshes the tree view.
   * @param {string} newHost - The new host to set.
   */
  setHost(newHost) {
    this.host = newHost;
    this.refresh();
  }

  /**
   * Sets the current username and client ID and refreshes the tree view.
   * @param {string} username - The new username to set.
   * @param {string} clientId - The new client ID to set.
   */
  setIdentity(username, clientId) {
    this.username = username;
    this.clientId = clientId;
    this.refresh();
  }
  
  /**
   * Sets the current peer list and refreshes the tree view.
   * @param {Array} newPeerList - The new list of peers to set.
   */
	setPeerList(newPeerList) {
		this.peerList = newPeerList;
		this.refresh();
	}

  /**
   * Returns the tree item as is. Required method for TreeDataProvider.
   * @param {vscode.TreeItem} element - The tree item element.
   * @return {vscode.TreeItem} The tree item element unchanged.
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * Refreshes the tree by firing the change event.
   */
  refresh() {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Sets the file structure and refreshes the tree view.
   * @param {Object} structure - The new file structure to set.
   */
  setStructure(structure) {
    this.structure = structure;
    this.refresh();
  }

  /**
   * Retrieves the root children for the tree view based on the current state.
   * @return {Array<vscode.TreeItem>} The list of root children tree items.
   */
  getRootChildren() {
    // Create tree items
    let emptyItem = new vscode.TreeItem("", vscode.TreeItemCollapsibleState.None);
    let sendMessage = new vscode.TreeItem("Send Message", vscode.TreeItemCollapsibleState.None);
    let disconnectButton = new vscode.TreeItem("Disconnect", vscode.TreeItemCollapsibleState.None);
    let sharedFilesystem = new vscode.TreeItem("Shared Filesystem", vscode.TreeItemCollapsibleState.Collapsed);

    // Set commands
    sendMessage.command = { command: "tightrope.sendMessage", title: "Send Message" };
    disconnectButton.command = { command: "tightrope.disconnect", title: "Disconnect" };

    // Set icons
    disconnectButton.iconPath = new vscode.ThemeIcon('sign-out');
    sharedFilesystem.iconPath = new vscode.ThemeIcon('folder');

    // Create a "Peers" parent node
    let peersItem = new vscode.TreeItem("Peers", vscode.TreeItemCollapsibleState.Collapsed);
    peersItem.iconPath = new vscode.ThemeIcon('vm-active');

    let hostItem = new vscode.TreeItem(this.username + " - " + this.clientId, vscode.TreeItemCollapsibleState.None);
    hostItem.description = this.clientId;
    hostItem.iconPath = new vscode.ThemeIcon('server');
    peersItem.children = peersItem.children || [];
    peersItem.children.push(hostItem);

    // Populate the "Peers" node with subnodes for each peer
    this.peerList.forEach(peer => {
        let peerItem = new vscode.TreeItem(peer.username + " - " + peer.id, vscode.TreeItemCollapsibleState.None);
        peerItem.description = peer.status;
        peerItem.iconPath = new vscode.ThemeIcon('person');
        peersItem.children = peersItem.children || [];
        peersItem.children.push(peerItem);
    });

    // Handle different states to display different items
    switch (this.state) {
      case State.DISCONNECTED:
        return []; // empty for welcome view
      case State.CREATOR_CONNECTED:
        // Display the role of the user as session creator
        return [
          emptyItem,
          new vscode.TreeItem("Role: Session Creator", vscode.TreeItemCollapsibleState.None),
          new vscode.TreeItem("Status: " + this.status, vscode.TreeItemCollapsibleState.None),
          emptyItem,
          disconnectButton,
          emptyItem,
          peersItem,
          emptyItem,
          sharedFilesystem
        ];
      case State.JOINER_CONNECTED:
        // Display the role of the user as session peer
        return [
          emptyItem,
          new vscode.TreeItem("Role: Session Peer", vscode.TreeItemCollapsibleState.None),
          new vscode.TreeItem("Status: " + this.status, vscode.TreeItemCollapsibleState.None),
          emptyItem,
          disconnectButton,
          emptyItem,
          peersItem,
          emptyItem,
          sharedFilesystem
        ];
    }
  }

  /**
   * Retrieves the folder children for a given tree item.
   * @param {vscode.TreeItem} element - The tree item to retrieve children for.
   * @return {Array<vscode.TreeItem>} The list of folder children tree items.
   */
  getFolderChildren(element) {
    let children = [];

    // This function recursively adds folders and files to the parent array
    const addChildren = (folder, parentArray) => {
        // Add folders
        Object.keys(folder.folders || {}).forEach(subFolderName => {
            let subFolderItem = new vscode.TreeItem(subFolderName, vscode.TreeItemCollapsibleState.Collapsed);
            subFolderItem.iconPath = new vscode.ThemeIcon('folder');
            parentArray.push(subFolderItem);

            // Prepare an array for the sub-folder's children
            let subFolderChildren = [];
            addChildren(folder.folders[subFolderName], subFolderChildren);

            // Associate the sub-folder's children with the sub-folder item
            subFolderItem.children = subFolderChildren;
        });

        // Add files
        Object.keys(folder.files || {}).forEach(fileName => {
            let fileDetails = folder.files[fileName];
            let fileItem = new vscode.TreeItem(fileName, vscode.TreeItemCollapsibleState.None);
            fileItem.iconPath = new vscode.ThemeIcon('file');
            fileItem.command = { command: 'tightrope.openFile', arguments: [fileDetails.fullPath], title: "Open File" };
            parentArray.push(fileItem);
        });
    };

    // Determine the starting point for adding children based on the element
    if (element.label === "Shared Filesystem") {
        // If the element is the root, start from the top of the structure
        addChildren(this.structure, children);
    } else {
        // For nested folders, use the structure stored in the element
        if (element.children) {
            // Directly use the children array if it's a previously populated folder
            children = element.children;
        } else {
            // Otherwise, find the correct folder structure based on the element's label
            let folderContent = this.structure.folders[element.label] || {};
            addChildren(folderContent, children);
        }
    }

    return children;
  }

  /**
   * Returns the children for the tree view based on the current state or the provided element.
   * @param {vscode.TreeItem} element - The tree item to retrieve children for. If undefined, root children are returned.
   * @return {Array<vscode.TreeItem>} The list of children tree items.
   */
  getChildren(element) {
    // If no element is provided, we're at the root
    if (element === undefined) {
      return this.getRootChildren();
    } else {
      return this.getFolderChildren(element);
    }

    // Return an empty array if there are no children for the given element
    return [];
  }
}

// Export the class and state constants
module.exports = { TightropeTreeDataProvider, State };