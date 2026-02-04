import express from 'express';
import { Client } from 'discord.js';
import { config } from '../config';
import { WebhookController } from './webhook.controller';
import { Logger } from '../utils/logger';

export function startServer(client: Client) {
    const app = express();
    
    // JSON parser standard
    app.use(express.json());
    
    // Health check endpoint
    app.get('/health', (_req, res) => {
        res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Webhook endpoint
    app.post('/webhook/pakasir', (req, res) => WebhookController.handlePaKasir(req, res, client));

    const server = app.listen(config.port, () => {
        Logger.info(`Server running on port ${config.port}`, 'Express');
    });

    // Return server instance untuk graceful shutdown
    return server;
}

