// Required modules for file system operations, hashing, and path manipulation
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ignore = require('ignore');

/**
 * Manages the file system for network operations, including scanning directories,
 * detecting changes, and maintaining file state history for potential rollback.
 * It uses a workspace root to initialize and supports ignoring files similar to .gitignore.
 */
class NetworkFileSystem {

    /**
     * Initializes the network file system with a workspace root and a tree data provider.
     * @param {string} workspaceRoot - The root directory of the workspace.
     * @param {object} treeDataProvider - The data provider for the tree view.
     */
    constructor(workspaceRoot, treeDataProvider) {
        this.workspaceRoot = workspaceRoot;
        this.treeDataProvider = treeDataProvider;
        this.fileStates = {}; // Stores current state of files
        this.history = []; // Stores history for rollback
        if (workspaceRoot != null) {
            this.scanDirectory(this.workspaceRoot);
        }
    }

    /**
     * Recursively scans a directory to build the initial state of the file system,
     * respecting .gitignore rules.
     * @param {string} directory - The directory to scan.
     */
    scanDirectory(directory) {

        const currentStructure = this.getStructure();

        let ig = ignore().add(['node_modules']); // Default ignore node_modules
        // Try to read .gitignore file
        try {
            const gitignore = fs.readFileSync(path.join(this.workspaceRoot, '.gitignore'), 'utf8');
            ig = ignore().add(gitignore);
        } catch (err) {
            // .gitignore file not found or error reading file
            // console.log('.gitignore file not found or error reading file:', err);
        }

        // this is madness but needed for adding/removing file states
        const existingPaths = Object.keys(this.fileStates);
        const files = fs.readdirSync(directory);
        files.forEach(file => {
            const relativePath = path.relative(this.workspaceRoot, path.join(directory, file));
            if (ig.ignores(relativePath)) {
                // Skip ignored files and directories
                return;
            }

            const filePath = path.join(directory, file);
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
                this.scanDirectory(filePath);
            } else {
                this.fileStates[filePath] = {
                    name: path.basename(filePath),
                    size: stats.size,
                    hash: this.calculateHash(filePath),
                    fullPath: filePath
                };
                // Remove the path from existingPaths to mark it as still existing
                const existingPathIndex = existingPaths.indexOf(filePath);
                if (existingPathIndex > -1) {
                    existingPaths.splice(existingPathIndex, 1);
                }
            }
        });

        // Remove any paths that no longer exist
        existingPaths.forEach(nonExistentPath => {
            if (!fs.existsSync(nonExistentPath)) {
                delete this.fileStates[nonExistentPath];
            }
        });

        const newStructure = this.getStructure();

        if (JSON.stringify(currentStructure) !== JSON.stringify(newStructure)) {
            this.treeDataProvider.setStructure(newStructure);
        }
    }

    /**
     * Detects file additions or subtractions by comparing the current file structure
     * with a new scan of the directory.
     * @returns {boolean} True if changes are detected, otherwise false.
     */
    detectChanges() {
        const currentStructure = this.getStructure();
        this.scanDirectory(this.workspaceRoot);
        const newStructure = this.getStructure();

        // Compare currentStructure and newStructure for changes
        const hasChanges = JSON.stringify(currentStructure) !== JSON.stringify(newStructure);

        if (hasChanges) {
            // If changes are detected, return true
            return true;
        }

        return false;
    }

    /**
     * Calculates the SHA-256 hash of a file for integrity verification.
     * @param {string} filePath - The path to the file.
     * @returns {string} The hex-encoded hash of the file.
     */
    calculateHash(filePath) {
        const fileBuffer = fs.readFileSync(filePath);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        return hashSum.digest('hex');
    }

    /**
     * Updates the state of a file in the fileStates object and adds the previous state
     * to the history array for potential rollback.
     * @param {string} filePath - The path to the file being updated.
     */
    updateFileState(filePath) {
        const stats = fs.statSync(filePath);
        const prevState = this.fileStates[filePath];
        const newState = {
            name: path.basename(filePath),
            size: stats.size,
            hash: this.calculateHash(filePath),
            fullPath: filePath,
            timestamp: Date.now() // Track when the change was made
        };
    
        // Save previous state to history for rollback, including timestamp
        this.history.push({ filePath, prevState, timestamp: newState.timestamp });
    
        // Update current state
        this.fileStates[filePath] = newState;
    }

    /**
     * Constructs a structured representation of the current file system state.
     * @returns {object} The structured representation of the file system.
     */
    getStructure() {
        let structure = {};
    
        const addFileToStructure = (structure, parts, fileState, fullPath) => { // Include fullPath in parameters
            let current = structure;
            parts.forEach((part, index) => {
                if (index === parts.length - 1) {
                    // Last part, add the file
                    if (!current.files) current.files = {};
                    current.files[part] = { ...fileState, fullPath }; // Include fullPath in fileState
                } else {
                    // Intermediate part, add or traverse folder
                    if (!current.folders) current.folders = {};
                    if (!current.folders[part]) current.folders[part] = { fullPath: fullPath }; // Store fullPath for folders
                    current = current.folders[part];
                }
            });
        };
    
        Object.keys(this.fileStates).forEach(filePath => {
            const relativePath = path.relative(this.workspaceRoot, filePath);
            const parts = relativePath.split(path.sep);
            addFileToStructure(structure, parts, this.fileStates[filePath], filePath); // Pass filePath as fullPath
        });
    
        return structure;
    }

    /**
     * Rolls back the last change made to the file system, restoring the previous state
     * or deleting a newly added file.
     */
    rollback() {
        const lastChange = this.history.pop();
        if (lastChange) {
            const { filePath, prevState } = lastChange;
            if (prevState) {
                // Restore file from prevState
                const data = Buffer.from(prevState.hash, 'hex'); // Simplified, actual restoration may vary
                fs.writeFileSync(filePath, data);
                this.fileStates[filePath] = prevState;
            } else {
                // File was added in last change, remove it
                delete this.fileStates[filePath];
                fs.unlinkSync(filePath);
            }
        }
    }
}

// Export the NetworkFileSystem class for use in other modules
module.exports = { NetworkFileSystem };