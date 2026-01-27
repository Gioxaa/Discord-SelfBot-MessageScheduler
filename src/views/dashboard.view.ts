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
    const activeCount = tasks.filter(t => t.status === 'RUNNING').length;
    const inactiveCount = tasks.length - activeCount;

    const embed = new EmbedBuilder()
        .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK MANAGER** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROCESS OVERVIEW**
> <a:on:1306062154616537109> Active Workers : **${activeCount}**
> <a:offline:1306203222263988285> Inactive Workers : **${inactiveCount}**
> <a:arrow:1306059259615903826> Total Workers  : **${tasks.length}**
\u200b
`)
        .setColor(0x57F287)
        .setFooter({ text: 'AutoPost | Powered by Frey' })
        .setTimestamp()
        .setImage('https://cdn.discordapp.com/attachments/1420156741059874818/1453538221584551936/standard_1.gif?ex=6979fab5&is=6978a935&hm=91e3d4d0ed490273106ddf8b3d55562f4e450074f3afa51e28a61b18d1fe4f05&');

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_manage_task')
        .setPlaceholder('Select a task to configure');

    // Limit to 10 tasks (25 fields limit / 1 field per task = 25 tasks, but let's keep it clean)
    const displayTasks = tasks.slice(0, 10);

    displayTasks.forEach((task, index) => {
        const isRunning = task.status === 'RUNNING';
        const statusIcon = isRunning ? '<a:on:1306062154616537109>' : '<a:offline:1306203222263988285>';
        const accountName = task.account.name || 'Unnamed';
        // Use guildName/channelName from DB if available, fallback to ID
        const guildDisplay = task.guildName || 'Unknown Server';
        const channelDisplay = task.channelName ? `#${task.channelName}` : `<#${task.channelId}>`;
        const slowmodeDisplay = task.channelSlowmode ? `(${task.channelSlowmode}s)` : '';

        // Format Interval
        const intervalDisplay = `${formatDuration(task.minDelay / 1000)} - ${formatDuration(task.maxDelay / 1000)}`;

        // Single Field per Task (Clean & Compact with Emojis)
        embed.addFields({
            name: `${statusIcon} **${accountName}**`,
            value: `<a:arrow:1306059259615903826> Server : **${guildDisplay}**\n<a:arrow:1306059259615903826> Channel : ${channelDisplay} ${slowmodeDisplay}\n<a:arrow:1306059259615903826> Interval : \`${intervalDisplay}\`\n<a:arrow:1306059259615903826> Sent : **${task.totalSent.toLocaleString()}**`,
            inline: false
        });

        selectMenu.addOptions({
            label: `${accountName} -> ${task.guildName?.substring(0, 20) || 'Server'}`,
            description: `Status: ${task.status}`,
            value: task.id,
            emoji: isRunning ? { id: '1306062154616537109', animated: true } : { id: '1306203222263988285', animated: true }
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
