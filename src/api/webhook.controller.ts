import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service';
import { WorkspaceService } from '../services/workspace.service';
import { config } from '../config';
import { Client } from 'discord.js';

export class WebhookController {
    static async handlePaKasir(req: Request, res: Response, client: Client) {
        console.log('[Webhook] Received payment notification:', req.body);
  
        try {
            const { status, transaction } = await PaymentService.handleWebhook(req.body);

            if (status === 'SUCCESS' && transaction) {
                if (!config.guildId) {
                    console.error('[Payment] Missing GUILD_ID in env');
                    res.status(500).send('Config Error');
                    return;
                }

                console.log(`[Payment] Verified! Unlocking workspace for user ${transaction.userId}...`);
                
                // Determine duration based on amount paid (Simple logic for now)
                let duration = 7;
                if (transaction.amount >= 30000) duration = 30; // 30 Days product

                await WorkspaceService.createWorkspace(client, config.guildId, transaction.userId, duration);
                console.log(`[Payment] Workspace unlocked.`);
            } else if (status === 'ALREADY_PROCESSED') {
                console.log('[Payment] Transaction already processed.');
            } else {
                console.log(`[Payment] Ignored status: ${status}`);
            }
            
            res.status(200).send('OK');

        } catch (err: any) {
            console.error('[Webhook Error]', err.message);
            res.status(500).send('Error');
        }
    }
}
