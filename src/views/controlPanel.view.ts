import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../database/client';

export async function renderControlPanel(userId: string) {
    const accountCount = await prisma.account.count({ where: { userId } });
    const activeTaskCount = await prisma.task.count({ where: { account: { userId }, status: 'RUNNING' } });

    const embed = new EmbedBuilder()
        .setDescription(`> **Control Panel**\nWelcome to your private workspace.\n\n\` SYSTEM STATUS \`\n• Accounts: **${accountCount}**\n• Running Tasks: **${activeTaskCount}**\n• Status: **ONLINE**`)
        .setColor(0x2B2D31);

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_add_account')
                .setLabel('Add Account')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('btn_setup_task')
                .setLabel('New Task')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('btn_view_tasks')
                .setLabel('Manage Tasks')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_stop_all')
                .setLabel('Stop All')
                .setStyle(ButtonStyle.Danger)
        );

    return { content: null, embeds: [embed], components: [row] };
}
