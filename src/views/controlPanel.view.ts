import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { AdminService } from '../services/admin.service';
import { Logger } from '../utils/logger';

export async function renderControlPanel(userId: string) {
    try {
        const data = await AdminService.getUserControlPanelData(userId);
        const { user, accountCount, activeTaskCount, totalMessagesSent } = data;

        // Calculate Duration
        let durationDisplay = '∞';
        let isExpired = false;

        if (user?.expiryDate) {
            const now = new Date();
            const expiry = new Date(user.expiryDate);
            const diffMs = expiry.getTime() - now.getTime();

            if (diffMs > 0) {
                const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                
                if (days === 0 && hours === 0) {
                    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                    if (minutes === 0) {
                        durationDisplay = '< 1m remaining';
                    } else {
                        durationDisplay = `${minutes}m remaining`;
                    }
                } else {
                    durationDisplay = `${days}d ${hours}h remaining`;
                }
            } else {
                durationDisplay = 'Expired';
                isExpired = true;
            }
        }

        const usernameDisplay = user?.username || userId;

        const embed = new EmbedBuilder()
            .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **AUTO POST PANEL** <a:GREEN_CROWN:1306056562435035190>
\u200b
**SUBSCRIPTION STATUS**
<a:arrow:1306059259615903826> Expires in  : **${durationDisplay}**
${isExpired ? '\n❌ **SUBSCRIPTION EXPIRED**\nPlease renew your plan to continue using the service.' : ''}
**INFRASTRUCTURE**
<a:arrow:1306059259615903826> Connected Accounts : **${accountCount}**
<a:arrow:1306059259615903826> Active Workers     : **${activeTaskCount}**
         <a:arrow:1306059259615903826> Total Messages Sent      : **${totalMessagesSent.toLocaleString()}**
`)
            .setColor(isExpired ? 0xED4245 : 0x57F287)
            .setFooter({ text: 'AutoPost | Powered by Frey' })
            .setTimestamp()
            .setImage('https://cdn.discordapp.com/attachments/1420156741059874818/1453538221584551936/standard_1.gif?ex=6979fab5&is=6978a935&hm=91e3d4d0ed490273106ddf8b3d55562f4e450074f3afa51e28a61b18d1fe4f05&');

        const row1 = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_add_account')
                    .setLabel('Add Account')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(isExpired),
                new ButtonBuilder()
                    .setCustomId('btn_setup_task')
                    .setLabel('New Task')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(isExpired),
                new ButtonBuilder()
                    .setCustomId('btn_view_tasks')
                    .setLabel('Manage Tasks')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(isExpired)
            );

        const row2 = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_manage_accounts')
                    .setLabel('Manage Accounts')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(isExpired),
                new ButtonBuilder()
                    .setCustomId('btn_stop_all')
                    .setLabel('Stop All')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(isExpired)
            );

        return { content: null, embeds: [embed], components: [row1, row2] };
    } catch (error) {
        Logger.error('Failed to render control panel', error, 'ControlPanelView');
        return {
            content: '❌ Failed to load control panel. Please try again.',
            embeds: [],
            components: []
        };
    }
}
