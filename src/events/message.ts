import { Message } from 'discord.js';
import { config } from '../config';
import { renderStore } from '../views/store.view';

export async function onMessageCreate(message: Message) {
    if (message.content === '!deploy-store' && message.author.id === config.adminId) {
        if (message.channel.isSendable()) {
            const storeView = renderStore();
            await message.channel.send({ embeds: storeView.embeds, components: storeView.components });
            await message.delete();
        }
    }
}
