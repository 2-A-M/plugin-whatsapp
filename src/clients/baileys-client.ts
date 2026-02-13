import { EventEmitter } from 'events';
import type { IWhatsAppClient } from './interface';
import type { BaileysConfig, WhatsAppMessage, ConnectionStatus } from '../types';
import { BaileysAuthManager } from '../baileys/auth';
import { BaileysConnection } from '../baileys/connection';
import { QRCodeGenerator } from '../baileys/qr-code';
import { MessageAdapter } from '../baileys/message-adapter';

export class BaileysClient extends EventEmitter implements IWhatsAppClient {
  private config: BaileysConfig;
  private authManager: BaileysAuthManager;
  private connection: BaileysConnection;
  private qrGenerator: QRCodeGenerator;
  private adapter: MessageAdapter;

  constructor(config: BaileysConfig) {
    super();
    this.config = config;
    this.authManager = new BaileysAuthManager(config.authDir);
    this.connection = new BaileysConnection(this.authManager);
    this.qrGenerator = new QRCodeGenerator();
    this.adapter = new MessageAdapter();

    this.setupEventForwarding();
  }

  private setupEventForwarding() {
    // QR Code
    this.connection.on('qr', async (qr: string) => {
      const qrData = await this.qrGenerator.generate(qr);

      if (this.config.printQRInTerminal !== false) {
        console.log('\n=== Scan QR Code ===\n');
        console.log(qrData.terminal);
      }

      this.emit('qr', qrData);
    });

    // Connection status
    this.connection.on('connection', (status: ConnectionStatus) => {
      this.emit('connection', status);
      if (status === 'open') {
        this.emit('ready');
      }
    });

    // Messages
    this.connection.on('messages', (messages: any[]) => {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          const unified = this.adapter.toUnified(msg);
          this.emit('message', unified);
        }
      }
    });
  }

  async start(): Promise<void> {
    await this.connection.connect();
  }

  async stop(): Promise<void> {
    await this.connection.disconnect();
  }

  async sendMessage(message: WhatsAppMessage): Promise<any> {
    const socket = this.connection.getSocket();
    if (!socket) {
      throw new Error('Not connected to WhatsApp');
    }

    const content = this.adapter.toBaileys(message);
    return socket.sendMessage(message.to, content);
  }

  async verifyWebhook(token: string): Promise<boolean> {
    throw new Error('verifyWebhook is not supported with Baileys. Use Cloud API instead.');
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connection.getStatus();
  }
}
