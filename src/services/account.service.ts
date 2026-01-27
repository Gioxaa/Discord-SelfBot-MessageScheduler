import prisma from '../database/client';
import { encrypt, decrypt } from '../utils/security';
import { Logger } from '../utils/logger';

export class AccountService {
    static async create(userId: string, name: string, token: string, avatar: string) {
        try {
            const encryptedToken = encrypt(token);
            const account = await prisma.account.create({
                data: {
                    userId,
                    token: encryptedToken,
                    name,
                    avatar
                }
            });
            Logger.info(`Account created for user ${userId}`, 'AccountService');
            return account;
        } catch (error) {
            Logger.error('Failed to create account', error, 'AccountService');
            throw error;
        }
    }

    static async getById(accountId: string) {
        try {
            return await prisma.account.findUnique({ where: { id: accountId } });
        } catch (error) {
            Logger.error('Failed to fetch account by ID', error, 'AccountService');
            throw error;
        }
    }

    static async getByUserId(userId: string) {
        try {
            return await prisma.account.findMany({ where: { userId } });
        } catch (error) {
            Logger.error('Failed to fetch accounts by UserID', error, 'AccountService');
            throw error;
        }
    }

    static getDecryptedToken(account: any): string {
        return decrypt(account.token);
    }
}
