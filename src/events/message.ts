import { Message } from 'discord.js';
import { config } from '../config';
import { renderStore } from '../views/store.view';
import { Logger } from '../utils/logger';

export async function onMessageCreate(message: Message) {
    try {
        if (message.content === '!deploy-store' && message.author.id === config.adminId) {
            if (message.channel.isSendable()) {
                const storeView = renderStore();
                await message.channel.send({ embeds: storeView.embeds, components: storeView.components });
                await message.delete();
            }
        }
    } catch (error) {
        Logger.error('Message Handler Error', error, 'MessageHandler');
    }
}

