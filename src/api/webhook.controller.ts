import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service';
import { WorkspaceService } from '../services/workspace.service';
import { config } from '../config';
import { Client } from 'discord.js';

export class WebhookController {
    static async handlePaKasir(req: Request, res: Response, client: Client) {
        console.log('[Webhook] Received payment notification:', req.body);
  
        try {
            const { status, transaction } = await PaymentService.handleWebhook(req.body, client);

            if (status === 'SUCCESS' && transaction) {
                console.log(`[Payment] Verified! Subscription extended for user ${transaction.userId}...`);
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
