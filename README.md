# Tightrope README

Welcome to "Tightrope", an end-to-end (e2e) encrypted code sharing extension for Visual Studio Code (VSCode). Tightrope is designed to enhance collaborative coding experiences securely, leveraging WebRTC technology to establish direct, peer-to-peer connections between users. This ensures that code snippets or entire files shared through the extension are encrypted from the moment they leave the sender's environment until they are decrypted by the intended recipient.

## Features

Tightrope offers a range of features designed to make secure, collaborative coding simple and efficient:

- **End-to-End Encryption**: Ensures that all shared code is fully encrypted during transmission, providing maximum privacy and security.
- **Peer-to-Peer Code Sharing**: Utilizes WebRTC to enable direct code sharing between peers, minimizing latency and avoiding reliance on central servers.
- **Seamless Integration**: Offers an intuitive interface within VSCode for initiating and joining sharing sessions, managing connections, and interacting with shared code.
- **Real-Time Collaboration**: Supports real-time code editing and viewing, making it ideal for pair programming, code reviews, and collaborative debugging sessions.

> Tip: We are working on adding animations and screenshots to showcase these features in action!

## Requirements

Tightrope requires Visual Studio Code version 1.86.0 or higher. Ensure that your VSCode is up to date to enjoy all the features of Tightrope without any issues.

### Build Requirements

- Node.js v18.19.0
- npm v10.2.3
- node-pre-gyp (*npm install node-pre-gyp*)
- wrtc (*npm install wrtc*)
- ws (*npm install ws*)

Node Requirements: `npm install node-pre-gyp wrtc ws`

## Extension Settings

Tightrope contributes the following settings to enhance your code sharing experience:

- `tightrope.enable`: Enable/disable Tightrope extension.

## Known Issues

For a list of known issues, please visit our [GitHub issues page](https://github.com/your-github-repo/issues). We welcome contributions and issue reports to help improve Tightrope.

## Release Notes

Stay tuned for updates as we continue to enhance Tightrope and add new features.

### 0.0.1

- Initial release of Tightrope.
- Basic functionality for end-to-end encrypted code sharing using WebRTC.

---

## For more information

- [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
- [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy secure coding with Tightrope!**


Code Editing:
1. File Opening and Display: When a user clicks on a file in the tree view, you should send a message through the data channel requesting the file's content. Upon receiving the file content, open a new editor window or tab with this content. This can be achieved by using the vscode.workspace.openTextDocument and vscode.window.showTextDocument APIs.
2. Tracking and Broadcasting Edits: Use the vscode.workspace.onDidChangeTextDocument event to track changes made by the user. When a change is detected, serialize the change (including the file identifier, change range, new text, etc.) and broadcast it to other clients through the data channel.
3. Applying Remote Edits: When receiving an edit message, deserialize it and apply the changes to the corresponding open document using the vscode.workspace.applyEdit API.
4. Cursor Position and Selection: To share cursor positions and selections, listen to the vscode.window.onDidChangeTextEditorSelection event. Serialize the cursor position or selection range and send it to other clients. Apply received cursor positions or selections by creating decorations in the editor using the vscode.window.createTextEditorDecorationType and editor.setDecorations APIs.
5. Clipboard Synchronization: Utilize the VS Code clipboard API (vscode.env.clipboard) to read and write to the clipboard. When a user copies or cuts content, send this content to other clients. Upon receiving clipboard content from another client, you can either automatically update the local clipboard or provide a UI option for the user to accept the clipboard content.
6. Expansion for Future Features: Design your message protocol to be extensible. Use JSON for message serialization, and include a type field in each message to distinguish between different message types (e.g., file edits, cursor movements, clipboard content). This approach makes it easier to add new features and message types in the future.

Data Channel messages are sent as a string like this: "messageType data1 data2 data3 etc"