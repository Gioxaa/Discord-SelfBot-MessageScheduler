import prisma from '../database/client';
import { WorkspaceService } from './workspace.service';
import { Logger } from '../utils/logger';

export class AdminService {
    
    static async getStats() {
        const totalUsers = await prisma.user.count();
        const totalAccounts = await prisma.account.count();
        const activeTasks = await prisma.task.count({ where: { status: 'RUNNING' } });
        const totalPayments = await prisma.payment.count({ where: { status: 'PAID' } });
        
        // Aggregate Total Messages
        const msgStats = await prisma.task.aggregate({ _sum: { totalSent: true } });
        const totalMessagesSent = msgStats._sum.totalSent || 0;

        // Calculate total revenue (Assuming amount is in Payment table)
        const payments = await prisma.payment.findMany({ where: { status: 'PAID' } });
        const revenue = payments.reduce((acc, curr) => acc + curr.amount, 0);

        return {
            totalUsers,
            totalAccounts,
            activeTasks,
            totalMessagesSent,
            totalPayments,
            revenue
        };
    }

    static async getUserInfo(userId: string) {
        return prisma.user.findUnique({
            where: { id: userId },
            include: {
                accounts: true,
                _count: {
                    select: { accounts: true, payments: true }
                }
            }
        });
    }

    static async addTime(userId: string, days: number) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error('User not found');

        let newExpiry = user.expiryDate ? new Date(user.expiryDate) : new Date();
        // If expired, start from now
        if (newExpiry < new Date()) newExpiry = new Date();
        
        newExpiry.setDate(newExpiry.getDate() + days);

        return prisma.user.update({
            where: { id: userId },
            data: { expiryDate: newExpiry }
        });
    }

    static async removeTime(userId: string, days: number) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.expiryDate) throw new Error('User has no active subscription');

        const newExpiry = new Date(user.expiryDate);
        newExpiry.setDate(newExpiry.getDate() - days);

        return prisma.user.update({
            where: { id: userId },
            data: { expiryDate: newExpiry }
        });
    }

    static async deleteWorkspace(userId: string, client: any) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.workspaceChannelId) throw new Error('User has no workspace');

        // 1. Delete Channel
        try {
            const channel = await client.channels.fetch(user.workspaceChannelId);
            if (channel) await channel.delete();
        } catch (e) {
            Logger.warn('Failed to delete channel (might already be deleted)', 'AdminService');
        }

        // 2. Update DB
        return prisma.user.update({
            where: { id: userId },
            data: {
                workspaceChannelId: null,
                logThreadId: null
            }
        });
    }
}
