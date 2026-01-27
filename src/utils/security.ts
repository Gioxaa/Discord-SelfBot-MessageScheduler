import crypto from 'crypto';
import { config } from '../config';

const ENCRYPTION_KEY = config.encryptionKey || 'default_key_32_chars_very_secure_!'; 
const IV_LENGTH = 16; // AES block size

export function encrypt(text: string): string {
  if (ENCRYPTION_KEY.length !== 32) {
    throw new Error('Encryption key must be 32 characters long');
  }
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text: string): string {
  if (ENCRYPTION_KEY.length !== 32) {
    throw new Error('Encryption key must be 32 characters long');
  }
  
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift()!, 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString();
}
