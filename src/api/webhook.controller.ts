import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service';
import { Client } from 'discord.js';
import { Logger } from '../utils/logger';

export class WebhookController {
    static async handlePaKasir(req: Request, res: Response, client: Client) {
        Logger.info('Received payment notification', 'Webhook');

        try {
            const { amount, order_id, status, payment_method, completed_at } = req.body;

            // Validasi dasar
            if (!amount || !order_id || !status) {
                Logger.warn('Invalid webhook payload - missing required fields', 'Webhook');
                res.status(400).send('Bad Request');
                return;
            }

            // Proses webhook (PaymentService sudah handle duplicate check)
            const result = await PaymentService.handleWebhook(req.body, client);

            if (result.status === 'SUCCESS' && result.transaction) {
                Logger.info(`Payment verified! Subscription extended for user ${result.transaction.userId}`, 'Webhook');
            } else if (result.status === 'ALREADY_PROCESSED') {
                Logger.info('Transaction already processed (preventing duplicate)', 'Webhook');
            } else if (result.status === 'IGNORED') {
                Logger.debug(`Ignored payment status: ${status}`, 'Webhook');
            }
            
            res.status(200).send('OK');

        } catch (err: any) {
            Logger.error('Webhook processing failed', err, 'Webhook');
            res.status(500).send('Error');
        }
    }
}
