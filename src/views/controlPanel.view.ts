import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import prisma from '../database/client';

export async function renderControlPanel(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const accountCount = await prisma.account.count({ where: { userId } });
    const activeTaskCount = await prisma.task.count({ where: { account: { userId }, status: 'RUNNING' } });

    // Aggregate Total Traffic
    const totalStats = await prisma.task.aggregate({
        where: { account: { userId } },
        _sum: { totalSent: true }
    });
    const totalSent = totalStats._sum.totalSent || 0;

    // Calculate Duration
    let durationDisplay = '∞';
    if (user?.expiryDate) {
        const now = new Date();
        const expiry = new Date(user.expiryDate);
        const diffMs = expiry.getTime() - now.getTime();

        if (diffMs > 0) {
            const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            durationDisplay = `${days}d ${hours}h remaining`;
        } else {
            durationDisplay = 'Expired';
        }
    }

    const usernameDisplay = user?.username || userId;

    const embed = new EmbedBuilder()
        // .setAuthor({ name: '<a:Tick_green:1306061558303952937><a:Tick_green:1306061558303952937><a:Tick_green:1306061558303952937> <a:GREEN_CROWN:1306056562435035190> Auto Post Panel <a:GREEN_CROWN:1306056562435035190> <a:Tick_green:1306061558303952937><a:Tick_green:1306061558303952937><a:Tick_green:1306061558303952937>' })
        // .setTitle('**Auto Post Panel**')
        .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **AUTO POST PANEL** <a:GREEN_CROWN:1306056562435035190>
\u200b
**SUBSCRIPTION STATUS**
<a:arrow:1306059259615903826> Expires in  : **${durationDisplay}**

**INFRASTRUCTURE**
<a:arrow:1306059259615903826> Connected Accounts : **${accountCount}**
<a:arrow:1306059259615903826> Active Workers     : **${activeTaskCount}**
<a:arrow:1306059259615903826> Total Messages Sent      : **${totalSent.toLocaleString()}**
`)
        .setColor(0x57F287) // Discord Green (Clean)
        .setFooter({ text: 'AutoPost | Powered by Frey' })
        .setTimestamp()
        .setImage('https://cdn.discordapp.com/attachments/1420156741059874818/1453538221584551936/standard_1.gif?ex=6979fab5&is=6978a935&hm=91e3d4d0ed490273106ddf8b3d55562f4e450074f3afa51e28a61b18d1fe4f05&');

    const row1 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_add_account')
                .setLabel('Add Account')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_setup_task')
                .setLabel('New Task')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_view_tasks')
                .setLabel('Manage Tasks')
                .setStyle(ButtonStyle.Secondary)
        );

    const row2 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_manage_accounts')
                .setLabel('Manage Accounts')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_stop_all')
                .setLabel('Stop All')
                .setStyle(ButtonStyle.Secondary)
        );

    return { content: null, embeds: [embed], components: [row1, row2] };
}
