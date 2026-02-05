import { Logger } from '../utils/logger';
import axios from 'axios';
import prisma from '../database/client';
import { User, Client } from 'discord.js';
import { config, PRODUCTS } from '../config';
import { WorkspaceService } from './workspace.service';
import { renderPaymentSuccess } from '../views/payment.view';

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

            // 1. Ensure User Exists & Check Pending with Transaction to prevent race condition
            const transaction = await prisma.$transaction(async (tx) => {
                await tx.user.upsert({
                    where: { id: user.id },
                    update: { username: user.username },
                    create: {
                        id: user.id,
                        username: user.username || 'Unknown'
                    }
                });

                const pendingTx = await tx.payment.findFirst({
                    where: { userId: user.id, status: 'PENDING' }
                });

                if (pendingTx) {
                    throw new Error(`You have a pending transaction (ID: ${pendingTx.externalId}). Please pay or cancel it first.`);
                }

                // Create Pending Record in DB
                Logger.info('[Payment] Creating DB Record...', 'PaymentService');
                const newTransaction = await tx.payment.create({
                    data: {
                        userId: user.id,
                        amount: product.price,
                        status: 'PENDING',
                        externalId: `TRX-${Date.now()}-${user.id.substring(0, 4)}`
                    }
                });
                
                return newTransaction;
            });

            Logger.info(`[Payment] DB Record Created: ${transaction.id}`, 'PaymentService');

            // 2. Request to PaKasir dengan timeout 10 detik
            const payload = {
                project: config.pakasir.projectSlug,
                order_id: transaction.id,
                amount: product.price,
                api_key: config.pakasir.apiKey
            };

            Logger.info('[Payment] Sending request to PaKasir...', 'PaymentService');
            const response = await axios.post(`${config.pakasir.apiUrl}/transactioncreate/qris`, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000 // 10 detik timeout
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
            Logger.error('Failed to cancel at Gateway', e, 'PaymentService');
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

        // Manual Check to PaKasir dengan timeout 10 detik
        try {
            const response = await axios.get(`${config.pakasir.apiUrl}/transactiondetail`, {
                params: {
                    project: config.pakasir.projectSlug,
                    order_id: transactionId,
                    amount: transaction.amount,
                    api_key: config.pakasir.apiKey
                },
                timeout: 10000 // 10 detik timeout
            });

            const data = response.data?.transaction || response.data?.data || response.data;
            if (data.status === 'success' || data.status === 'completed' || data.payment_status === 'paid') {
                // Gunakan handleWebhook yang sudah atomic untuk mencegah race condition
                const result = await this.handleWebhook(
                    { order_id: transactionId, status: 'completed' }, 
                    client
                );
                return result.status === 'SUCCESS' || result.status === 'ALREADY_PROCESSED' ? 'PAID' : 'PENDING';
            }
        } catch (e) {
            // Silent fail on API check
            Logger.debug(`Transaction status check failed for ${transaction.id}: ${e instanceof Error ? e.message : 'Unknown error'}`, 'PaymentService');
        }

        return 'PENDING';
    }

    static async handleWebhook(payload: any, client: Client) {
        const { order_id, status } = payload;

        // Gunakan transaction dengan atomic check-and-update untuk mencegah race condition
        const result = await prisma.$transaction(async (tx) => {
            const transaction = await tx.payment.findUnique({
                where: { id: order_id },
                include: { user: true }
            });

            if (!transaction) throw new Error(`Transaction not found: ${order_id}`);
            
            // Check INSIDE transaction - atomic, mencegah double payment
            if (transaction.status === 'PAID') {
                return { status: 'ALREADY_PROCESSED' as const, transaction, days: 0 };
            }

            if (status !== 'completed' && status !== 'success') {
                return { status: 'IGNORED' as const, transaction, days: 0 };
            }

            // Process payment atomically
            const product = Object.values(PRODUCTS).find(p => p.price === transaction.amount);
            const days = product ? product.durationDays : 7;

            // Update payment status
            await tx.payment.update({
                where: { id: transaction.id },
                data: { status: 'PAID' }
            });

            // Update user expiry dalam transaction yang sama
            if (transaction.user) {
                const now = new Date();
                const currentExpiry = transaction.user.expiryDate && transaction.user.expiryDate > now 
                    ? transaction.user.expiryDate 
                    : now;
                const newExpiry = new Date(currentExpiry);
                newExpiry.setDate(newExpiry.getDate() + days);

                await tx.user.update({
                    where: { id: transaction.userId },
                    data: { expiryDate: newExpiry }
                });
            }

            return { status: 'SUCCESS' as const, transaction, days };
        });

        // Side effects di luar transaction (Discord API calls)
        if (result.status === 'SUCCESS') {
            Logger.info(`[Payment] Transaction ${result.transaction.id} marked as PAID, added ${result.days} days`, 'PaymentService');
            await this.handlePostPaymentSideEffects(result.transaction, client, result.days);
        }

        return result;
    }

    /**
     * Handle side effects setelah payment sukses (Discord API calls)
     * Dipisah dari transaction karena external API tidak boleh di dalam DB transaction
     */
    private static async handlePostPaymentSideEffects(transaction: any, client: Client, days: number) {
        // 1. Ensure Workspace Exists
        if (config.guildId) {
            try {
                await WorkspaceService.createWorkspace(client, config.guildId, transaction.userId);
            } catch (wsError) {
                Logger.error(`[Payment] Failed to create workspace for ${transaction.userId}`, wsError, 'PaymentService');
            }
        }

        // 2. Update Invoice Message (DM) to Success
        if (transaction.invoiceMessageId) {
            try {
                const user = await client.users.fetch(transaction.userId);
                const dmChannel = await user.createDM();
                const msg = await dmChannel.messages.fetch(transaction.invoiceMessageId);
                
                if (msg) {
                    const product = Object.values(PRODUCTS).find(p => p.durationDays === days);
                    const productName = product ? product.name : 'Premium Plan';
                    const successView = renderPaymentSuccess(productName, transaction.amount, transaction.id);
                    await msg.edit(successView);
                    Logger.info(`[Payment] Updated DM Invoice for ${transaction.userId}`, 'PaymentService');
                }
            } catch (e) {
                Logger.warn(`[Payment] Failed to update DM Invoice for ${transaction.userId}`, 'PaymentService');
            }
        }
    }

    /**
     * @deprecated Use handleWebhook instead - kept for backward compatibility
     */
    static async processSuccessfulPayment(transaction: any, client: Client) {
        // Delegate ke handleWebhook untuk konsistensi dan atomic operation
        return this.handleWebhook({ order_id: transaction.id, status: 'completed' }, client);
    }
}