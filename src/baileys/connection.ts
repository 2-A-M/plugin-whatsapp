import makeWASocket, { DisconnectReason, WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { EventEmitter } from 'events';
import type { BaileysAuthManager } from './auth';
import type { ConnectionStatus } from '../types';

export class BaileysConnection extends EventEmitter {
  private socket?: WASocket;
  private authManager: BaileysAuthManager;
  private connectionStatus: ConnectionStatus = 'close';

  constructor(authManager: BaileysAuthManager) {
    super();
    this.authManager = authManager;
  }

  async connect() {
    const state = await this.authManager.initialize();

    this.socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Chrome (Linux)', '', ''],
    });

    this.setupEventHandlers();
    return this.socket;
  }

  private setupEventHandlers() {
    if (!this.socket) return;

    // QR Code & Connection
    this.socket.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        this.emit('qr', qr);
      }

      if (connection) {
        this.connectionStatus = connection;
        this.emit('connection', connection);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

        // Handle specific error codes
        if (statusCode === 405) {
          console.error('WhatsApp rejected the connection (405). This usually means:');
          console.error('  - Baileys version is outdated');
          console.error('  - WhatsApp protocol has changed');
          console.error('  - Browser info is rejected by WhatsApp');
          this.emit('error', new Error('WhatsApp connection rejected (405). Try updating @whiskeysockets/baileys'));
          return; // Don't reconnect on 405
        }

        // 515 = QR code timeout, this is expected
        const isQRTimeout = statusCode === 515;
        if (isQRTimeout) {
          console.log('QR code timed out, generating new one...');
        }

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        // Only emit error for unexpected errors (not QR timeout)
        if (lastDisconnect?.error && !isQRTimeout) {
          console.error('Connection error:', lastDisconnect.error.message || lastDisconnect.error);
        }

        if (shouldReconnect && statusCode !== 405) {
          const delay = isQRTimeout ? 1000 : 3000;
          console.log(`Reconnecting in ${delay/1000} seconds...`);
          // Add delay before reconnecting
          await new Promise(resolve => setTimeout(resolve, delay));
          try {
            await this.connect();
          } catch (err) {
            console.error('Reconnection failed:', err);
          }
        }
      }
    });

    // Save credentials
    this.socket.ev.on('creds.update', async () => {
      await this.authManager.save();
    });

    // Messages
    this.socket.ev.on('messages.upsert', ({ messages }) => {
      this.emit('messages', messages);
    });
  }

  getSocket() {
    return this.socket;
  }

  getStatus() {
    return this.connectionStatus;
  }

  async disconnect() {
    if (this.socket) {
      // Remove all event listeners from the Baileys event emitter
      this.socket.ev.removeAllListeners();

      // Close the WebSocket connection (preserves session for next connection)
      this.socket.ws.close();

      this.socket = undefined;
      this.connectionStatus = 'close';
    }
  }
}
