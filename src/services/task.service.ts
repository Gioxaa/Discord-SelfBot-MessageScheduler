import prisma from '../database/client';
import { Logger } from '../utils/logger';

interface CreateTaskDTO {
    accountId: string;
    guildId: string;
    guildName?: string;
    channelId: string;
    channelName?: string;
    channelSlowmode?: number;
    message: string;
    minDelay: number;
    maxDelay: number;
    dynamicDelay: boolean;
}

export class TaskService {
    static async create(data: CreateTaskDTO) {
        try {
            const task = await prisma.task.create({
                data: {
                    ...data,
                    status: 'STOPPED'
                }
            });
            Logger.info(`Task created for account ${data.accountId}`, 'TaskService');
            return task;
        } catch (error) {
            Logger.error('Failed to create task', error, 'TaskService');
            throw error;
        }
    }

    static async getById(taskId: string) {
        return prisma.task.findUnique({
            where: { id: taskId },
            include: { account: true }
        });
    }

    static async listRunningByUser(userId: string) {
        return prisma.task.findMany({
            where: {
                status: 'RUNNING',
                account: { userId }
            }
        });
    }

    static async delete(taskId: string) {
        try {
            await prisma.task.delete({ where: { id: taskId } });
            Logger.info(`Task ${taskId} deleted`, 'TaskService');
        } catch (error) {
            Logger.error(`Failed to delete task ${taskId}`, error, 'TaskService');
            throw error;
        }
    }

    static async updateStatus(taskId: string, status: 'RUNNING' | 'STOPPED') {
        return prisma.task.update({
            where: { id: taskId },
            data: { status }
        });
    }

    static async update(taskId: string, data: Partial<CreateTaskDTO>) {
        try {
            const task = await prisma.task.update({
                where: { id: taskId },
                data: data
            });
            Logger.info(`Task ${taskId} updated`, 'TaskService');
            return task;
        } catch (error) {
            Logger.error(`Failed to update task ${taskId}`, error, 'TaskService');
            throw error;
        }
    }

    static async getTasksByUserWithDetails(userId: string) {
        return prisma.task.findMany({
            where: {
                account: {
                    userId: userId
                }
            },
            include: {
                account: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
    }
}
