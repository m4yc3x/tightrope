const pako = require('pako');

/**
 * Provides methods for compressing and decompressing data.
 */
class CompressionProvider {
    /**
     * Compresses the input string using deflate algorithm.
     * @param {string} input - The input string to compress.
     * @returns {string} - The compressed data.
     */
    static deflate(input) {
        return pako.deflate(input, { to: 'string' });
    }

    /**
     * Decompresses the input data using inflate algorithm.
     * @param {Uint8Array} input - The compressed data to decompress.
     * @returns {string} - The decompressed string.
     */
    static inflate(input) {
        return pako.inflate(input, { to: 'string' });
    }

    /**
     * Encodes the input string to Base64.
     * @param {string} input - The input string to encode.
     * @returns {string} - The Base64 encoded string.
     */
    static encode(input) {
        return Buffer.from(input).toString('base64');
    }

    /**
     * Decodes the Base64 encoded string to its original form.
     * @param {string} input - The Base64 encoded string to decode.
     * @returns {string} - The decoded string.
     */
    static decode(input) {
        return Buffer.from(input, 'base64');
    }

    /**
     * Compresses the input string using deflate algorithm and encodes it to Base64.
     * @param {string} input - The input string to compress.
     * @returns {string} - The compressed and encoded string.
     */
    static compress(input) {
        return this.encode(this.deflate(input));
    }

    /**
     * Decompresses the input string using inflate algorithm and decodes it from Base64.
     * @param {string} input - The input string to decompress.
     * @returns {string} - The decompressed and decoded string.
     */
    static decompress(input) {
        return this.inflate(this.decode(input));
    }
}

module.exports = CompressionProvider;

