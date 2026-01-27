import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function renderTaskPanel(task: any) {
    const status = task.status;
    
    // Sanitize Inputs
    const accountName = (task.account && task.account.name) ? task.account.name : 'Unknown Account';
    const minDelay = Math.floor(task.minDelay / 1000);
    const maxDelay = Math.floor(task.maxDelay / 1000);
    
    // Truncate message to avoid Embed limit (1024 chars)
    let msgPreview = task.message || '';
    if (msgPreview.length > 1000) {
        msgPreview = msgPreview.substring(0, 997) + '...';
    }
    if (!msgPreview) msgPreview = '(No Content)';

    const embed = new EmbedBuilder()
        .setDescription(`> **Task Configuration**\nCurrently viewing settings for this task.`)
        .setColor(status === 'RUNNING' ? 0x57F287 : 0xED4245)
        .addFields(
            { name: 'Status', value: status === 'RUNNING' ? 'Running' : 'Stopped', inline: true },
            { name: 'Account', value: accountName, inline: true },
            { name: 'Target', value: `<#${task.channelId}>`, inline: true },
            { name: 'Interval', value: `${minDelay}s - ${maxDelay}s`, inline: true },
            { name: 'Message Preview', value: `\`\`\`${msgPreview}\`\`\``, inline: false }
        );

    const row = new ActionRowBuilder<ButtonBuilder>();
    
    row.addComponents(
        new ButtonBuilder()
            .setCustomId('btn_back_menu')
            .setLabel('⬅️ Back to Menu')
            .setStyle(ButtonStyle.Secondary)
    );
    
    if (status === 'RUNNING') {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_stop_task_${task.id}`)
                .setLabel('Stop Process')
                .setStyle(ButtonStyle.Danger)
        );
    } else {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_resume_task_${task.id}`)
                .setLabel('Start Process')
                .setStyle(ButtonStyle.Success)
        );
    }

    // Edit Buttons Row
    const editRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_edit_msg_${task.id}`)
                .setLabel('Edit Message')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`btn_edit_delay_${task.id}`)
                .setLabel('Edit Delay')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`btn_preview_task_${task.id}`)
                .setLabel('Preview Message')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`btn_delete_task_${task.id}`)
                .setLabel('Delete')
                .setStyle(ButtonStyle.Secondary)
        );

    return { embed, row, editRow };
}
