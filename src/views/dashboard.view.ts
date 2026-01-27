import { EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../database/client';
import { formatDuration } from '../utils/timeHelper';

export async function renderDashboard(userId: string) {
    // 1. Fetch User's Accounts & Tasks
    const tasks = await prisma.task.findMany({
        where: {
            account: {
                userId: userId
            }
        },
        include: {
            account: true
        }
    });

    if (tasks.length === 0) {
        const emptyRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_back_menu')
                    .setLabel('⬅️ Back to Menu')
                    .setStyle(ButtonStyle.Secondary)
            );

        return {
            content: '📭 No tasks found. Create one first!',
            embeds: [],
            components: [emptyRow]
        };
    }

    // 2. Build Embed
    const embed = new EmbedBuilder()
        .setDescription(`> **Active Tasks**\nMonitoring **${tasks.length}** running processes.`)
        .setColor(0x2B2D31);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_manage_task')
        .setPlaceholder('Select a task to configure');

    // Limit to 10 tasks (25 fields limit / 1 field per task = 25 tasks, but let's keep it clean)
    const displayTasks = tasks.slice(0, 10);

    displayTasks.forEach((task, index) => {
        const statusIcon = task.status === 'RUNNING' ? '🟢' : '⚫';
        const accountName = task.account.name || 'Unnamed';
        // Use guildName/channelName from DB if available, fallback to ID
        const guildDisplay = task.guildName || 'Unknown Server';
        const channelDisplay = task.channelName ? `#${task.channelName}` : `<#${task.channelId}>`;
        const slowmodeDisplay = task.channelSlowmode ? `(Slowmode: ${task.channelSlowmode}s)` : '';
        
        // Format Interval
        const intervalDisplay = `${formatDuration(task.minDelay/1000)} - ${formatDuration(task.maxDelay/1000)}`;

        // Single Field per Task (Clean & Compact - NO EXTRA EMOJIS)
        embed.addFields({
            name: `${statusIcon} ${accountName}`,
            value: `> 📂 Server: ${guildDisplay}\n> #️⃣ Channel: ${channelDisplay} ${slowmodeDisplay}\n> ⏱️ Interval: ${intervalDisplay}`,
            inline: false
        });

        selectMenu.addOptions({
            label: `${accountName} -> ${task.channelId}`,
            description: `${task.status}`,
            value: task.id,
            emoji: task.status === 'RUNNING' ? '🟢' : '⚫'
        });
    });

    if (tasks.length > 10) {
        embed.setFooter({ text: `...and ${tasks.length - 10} more tasks.` });
    }

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
    
    // Removed "Back to Menu" button as requested

    return {
        content: null,
        embeds: [embed],
        components: [row]
    };
}
