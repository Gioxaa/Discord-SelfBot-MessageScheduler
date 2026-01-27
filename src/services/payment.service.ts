import { Logger } from '../utils/logger';
import axios from 'axios';
import prisma from '../database/client';
import { User, Client } from 'discord.js';
import { config, PRODUCTS } from '../config';
import { AdminService } from './admin.service';
import { WorkspaceService } from './workspace.service';

export class PaymentService {
    /**
     * Creates a pending transaction and requests a payment link from PaKasir
     */
    static async createTransaction(user: User, productId: string) {
        Logger.info(`[Payment] Starting transaction for ${user.id} (${user.username})`, 'PaymentService');

        // Validate Config
        if (!config.pakasir.apiKey || !config.pakasir.projectSlug) {
            throw new Error('Payment system is not configured (Missing API Key/Slug).');
        }

        const product = PRODUCTS[productId];
        if (!product) throw new Error('Invalid Product');

        if (isNaN(product.price)) {
            throw new Error('Invalid Product Price configuration.');
        }

        try {
            // 0. Rate Limiting (Anti-Spam)
            if (user.id !== config.adminId) {
                const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
                const recentTxCount = await prisma.payment.count({
                    where: {
                        userId: user.id,
                        createdAt: { gte: oneMinuteAgo }
                    }
                });

                if (recentTxCount >= 3) {
                    throw new Error('You are creating transactions too fast. Please wait a moment.');
                }
            }

            // 1. Ensure User Exists & Check Pending
            await prisma.user.upsert({
                where: { id: user.id },
                update: { username: user.username },
                create: {
                    id: user.id,
                    username: user.username || 'Unknown'
                }
            });

            const pendingTx = await prisma.payment.findFirst({
                where: { userId: user.id, status: 'PENDING' }
            });

            if (pendingTx) {
                // Return special error to trigger Cancel button
                throw new Error(`You have a pending transaction (ID: ${pendingTx.externalId}). Please pay or cancel it first.`);
            }

            // 1. Create Pending Record in DB
            Logger.info('[Payment] Creating DB Record...', 'PaymentService');
            const transaction = await prisma.payment.create({
                data: {
                    userId: user.id,
                    amount: product.price,
                    status: 'PENDING',
                    externalId: `TRX-${Date.now()}-${user.id.substring(0, 4)}`
                }
            });
            Logger.info(`[Payment] DB Record Created: ${transaction.id}`, 'PaymentService');

            // 2. Request to PaKasir
            const payload = {
                project: config.pakasir.projectSlug,
                order_id: transaction.id,
                amount: product.price,
                api_key: config.pakasir.apiKey
            };

            Logger.info('[Payment] Sending request to PaKasir...', 'PaymentService');
            const response = await axios.post(`${config.pakasir.apiUrl}/transactioncreate/qris`, payload, {
                headers: { 'Content-Type': 'application/json' }
            });

            // Safer check for response data
            const paymentData = response.data?.payment || response.data?.data;
            if (!paymentData) {
                Logger.error('[Payment] Invalid Gateway Response', response.data, 'PaymentService');
                throw new Error('Invalid response from Payment Gateway (No data)');
            }

            const qrString = paymentData.payment_number || paymentData.qr_string;
            if (!qrString) {
                throw new Error('QRIS generation failed (No payment_number)');
            }

            const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrString)}&size=300`;

            Logger.info('[Payment] Transaction Success', 'PaymentService');
            return {
                url: qrImageUrl,
                transactionId: transaction.id
            };

        } catch (error: any) {
            // Log full error
            Logger.error('[Payment] Create Transaction Failed', error, 'PaymentService');

            // Handle Axios Error
            if (axios.isAxiosError(error)) {
                const apiError = error.response?.data?.message || error.response?.data?.error || error.message;
                // Try to mark as failed if transaction was created (We need transaction ID but it's local scope)
                // Since we are inside a try block that covers creation, we can't easily access 'transaction' 
                // unless we defined it outside.
                // However, finding the latest PENDING transaction for this user is a good fallback.
                try {
                    const latest = await prisma.payment.findFirst({
                        where: { userId: user.id, status: 'PENDING' },
                        orderBy: { createdAt: 'desc' }
                    });
                    if (latest) {
                        await prisma.payment.update({
                            where: { id: latest.id },
                            data: { status: 'FAILED' }
                        });
                    }
                } catch (dbErr) { /* Ignore */ }

                throw new Error(`Payment Gateway Error: ${apiError}`);
            }

            // Rethrow non-axios errors (e.g. Pending Transaction check)
            throw error;
        }
    }

    static async cancelTransaction(transactionId: string) {
        const transaction = await prisma.payment.findUnique({
            where: { id: transactionId }
        });

        if (!transaction) throw new Error('Transaction not found');
        if (transaction.status !== 'PENDING') return; // Already processed

        // Call PaKasir API to cancel
        try {
            const payload = {
                project: config.pakasir.projectSlug,
                order_id: transaction.id,
                amount: transaction.amount,
                api_key: config.pakasir.apiKey
            };

            await axios.post(`${config.pakasir.apiUrl}/transactioncancel`, payload, {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            console.error('[PaymentService] Failed to cancel at Gateway:', e.response?.data || e.message);
            // We continue to mark as cancelled locally so user is not stuck, 
            // but log the error. In strict mode we might throw.
        }

        return prisma.payment.update({
            where: { id: transactionId },
            data: { status: 'CANCELLED' }
        });
    }

    static async checkTransactionStatus(transactionId: string, client: Client) {
        const transaction = await prisma.payment.findUnique({
            where: { id: transactionId }
        });

        if (!transaction) throw new Error('Transaction not found');
        if (transaction.status === 'PAID') return 'PAID';
        if (transaction.status === 'CANCELLED') return 'CANCELLED';

        // Manual Check to PaKasir
        try {
            const response = await axios.get(`${config.pakasir.apiUrl}/transaction/${transaction.id}`, {
                headers: { 'Authorization': `Bearer ${config.pakasir.apiKey}` }
            });

            const data = response.data.data || response.data;
            if (data.status === 'success' || data.status === 'completed' || data.payment_status === 'paid') {
                await this.processSuccessfulPayment(transaction, client);
                return 'PAID';
            }
        } catch (e) {
            // Silent fail on API check
        }

        return 'PENDING';
    }

    static async handleWebhook(payload: any, client: Client) {
        const { order_id, status } = payload;

        let transaction = await prisma.payment.findUnique({
            where: { id: order_id },
            include: { user: true }
        });

        if (!transaction) throw new Error(`Transaction not found: ${order_id}`);
        if (transaction.status === 'PAID') return { status: 'ALREADY_PROCESSED', transaction };

        if (status === 'completed' || status === 'success') {
            await this.processSuccessfulPayment(transaction, client);
            return { status: 'SUCCESS', transaction };
        }

        return { status: 'IGNORED', transaction };
    }

    static async processSuccessfulPayment(transaction: any, client: Client) {
        // 1. Update Status
        await prisma.payment.update({
            where: { id: transaction.id },
            data: { status: 'PAID' }
        });

        // 2. Add Time
        const days = transaction.amount >= 30000 ? 30 : 7;
        await AdminService.addTime(transaction.userId, days);

        // 3. Ensure Workspace Exists
        if (config.guildId) {
            await WorkspaceService.createWorkspace(client, config.guildId, transaction.userId, days);
        }
    }
}