import axios from 'axios';
import prisma from '../database/client';
import { User } from 'discord.js';
import { config, PRODUCTS } from '../config';

export class PaymentService {
    /**
     * Creates a pending transaction and requests a payment link from PaKasir
     */
    static async createTransaction(user: User, productId: string) {
        const product = PRODUCTS[productId];
        if (!product) throw new Error('Invalid Product');

        // 0. Ensure User Exists in DB
        await prisma.user.upsert({
            where: { id: user.id },
            update: { username: user.username },
            create: {
                id: user.id,
                username: user.username
            }
        });

        // 1. Create Pending Record in DB
        const transaction = await prisma.payment.create({
            data: {
                userId: user.id,
                amount: product.price,
                status: 'PENDING',
                externalId: `TRX-${Date.now()}-${user.id.substring(0, 4)}` 
            }
        });

        // 2. Request to PaKasir
        try {
            const payload = {
                project: config.pakasir.projectSlug,
                order_id: transaction.id,
                amount: product.price,
                api_key: config.pakasir.apiKey
            };

            const response = await axios.post(`${config.pakasir.apiUrl}/transactioncreate/qris`, payload, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const paymentData = response.data.payment || response.data.data;
            const qrString = paymentData.payment_number;
            
            const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrString)}&size=300`;

            return {
                url: qrImageUrl,
                transactionId: transaction.id
            };

        } catch (error: any) {
            console.error('[PaymentService] Gateway Error:', error.response?.data || error.message);
            throw new Error('Payment Gateway unavailable.');
        }
    }

    /**
     * Verifies a webhook payload and returns the transaction details
     */
    static async handleWebhook(payload: any) {
        const { order_id, status } = payload;
        
        let transaction = await prisma.payment.findUnique({
            where: { id: order_id },
            include: { user: true }
        });

        if (!transaction) {
            throw new Error(`Transaction not found for ID: ${order_id}`);
        }

        if (transaction.status === 'PAID') {
            return { status: 'ALREADY_PROCESSED', transaction };
        }

        if (status === 'completed' || status === 'success') {
             const updated = await prisma.payment.update({
                 where: { id: transaction.id },
                 data: { status: 'PAID' }
             });
             return { status: 'SUCCESS', transaction: updated };
        }

        return { status: 'IGNORED', transaction };
    }
}
