// EncryptionService.js - End-to-End Encryption with AES-GCM
class EncryptionService {
    constructor() {
        this.enabled = false;
        this.key = null;
        this.passphrase = null;
    }

    // Derive encryption key from passphrase using PBKDF2
    async deriveKey(passphrase, salt) {
        const encoder = new TextEncoder();
        const passphraseKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(passphrase),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            passphraseKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    // Initialize encryption with passphrase
    async initialize(passphrase) {
        this.passphrase = passphrase;
        const salt = crypto.getRandomValues(new Uint8Array(16));
        this.key = await this.deriveKey(passphrase, salt);
        this.enabled = true;
        return { key: this.key, salt: Array.from(salt) };
    }

    // Set key from salt (for receiver)
    async setKeyFromSalt(passphrase, saltArray) {
        this.passphrase = passphrase;
        const salt = new Uint8Array(saltArray);
        this.key = await this.deriveKey(passphrase, salt);
        this.enabled = true;
    }

    // Encrypt data (ArrayBuffer)
    async encrypt(data) {
        if (!this.enabled || !this.key) {
            throw new Error('Encryption not initialized');
        }

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            this.key,
            data
        );

        // Return IV + encrypted data
        const result = new Uint8Array(iv.length + encrypted.byteLength);
        result.set(iv, 0);
        result.set(new Uint8Array(encrypted), iv.length);
        return result.buffer;
    }

    // Decrypt data (ArrayBuffer)
    async decrypt(data) {
        if (!this.enabled || !this.key) {
            throw new Error('Encryption not initialized');
        }

        const dataArray = new Uint8Array(data);
        const iv = dataArray.slice(0, 12);
        const encrypted = dataArray.slice(12);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            this.key,
            encrypted
        );

        return decrypted;
    }

    // Encrypt text message
    async encryptText(text) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        return await this.encrypt(data);
    }

    // Decrypt text message
    async decryptText(encrypted) {
        const decrypted = await this.decrypt(encrypted);
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    }

    // Disable encryption
    disable() {
        this.enabled = false;
        this.key = null;
        this.passphrase = null;
    }

    // Check if encryption is enabled
    isEnabled() {
        return this.enabled;
    }
}

export default new EncryptionService();
