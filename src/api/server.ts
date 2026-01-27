import express from 'express';
import { Client } from 'discord.js';
import { config } from '../config';
import { WebhookController } from './webhook.controller';

export function startServer(client: Client) {
    const app = express();
    app.use(express.json());

    app.post('/webhook/pakasir', (req, res) => WebhookController.handlePaKasir(req, res, client));

    app.listen(config.port, () => {
        console.log(`[Express] Server running on port ${config.port}`);
    });
}
