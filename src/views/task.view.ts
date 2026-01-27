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

    const statusIcon = status === 'RUNNING' ? '<a:on:1306062154616537109>' : '<a:offline:1306203222263988285>';

    const embed = new EmbedBuilder()
        .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **TASK CONFIGURATION** <a:GREEN_CROWN:1306056562435035190>
\u200b
**PROCESS STATUS**
<a:arrow:1306059259615903826> Status  : ${statusIcon} **${status}**
<a:arrow:1306059259615903826> Account : **${accountName}**

**TARGET & TIMING**
<a:arrow:1306059259615903826> Target  : <#${task.channelId}>
<a:arrow:1306059259615903826> Interval: **${minDelay}s - ${maxDelay}s**
<a:arrow:1306059259615903826> Sent    : **${task.totalSent.toLocaleString()}**

**MESSAGE CONTENT**
\`\`\`
${msgPreview}
\`\`\`
`)
        .setColor(0x57F287)
        .setFooter({ text: 'AutoPost | Powered by Frey' })
        .setTimestamp()
        .setImage('https://cdn.discordapp.com/attachments/1420156741059874818/1453538221584551936/standard_1.gif?ex=6979fab5&is=6978a935&hm=91e3d4d0ed490273106ddf8b3d55562f4e450074f3afa51e28a61b18d1fe4f05&');

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
