import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuOptionBuilder } from 'discord.js';
import { AccountService } from '../services/account.service';
import { Logger } from '../utils/logger';

export async function renderAccountList(userId: string) {
    try {
        const accounts = await AccountService.getByUserId(userId);

        const embed = new EmbedBuilder()
            .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **ACCOUNT MANAGER** <a:GREEN_CROWN:1306056562435035190>
\u200b
**OVERVIEW**
> <a:arrow:1306059259615903826> Connected Accounts : **${accounts.length}**
\u200b
**YOUR ACCOUNTS**
${accounts.length > 0 ? accounts.map(acc => `<a:arrow:1306059259615903826> **${acc.name || 'Unnamed'}** 
   ID: \`${acc.id.substring(0, 18)}...\``).join('\n') : '> *No accounts connected yet.*'}
`)
            .setColor(0x57F287)
            .setFooter({ text: 'AutoPost | Powered by Frey' })
            .setTimestamp()
            .setImage('https://cdn.discordapp.com/attachments/1420156741059874818/1453538221584551936/standard_1.gif?ex=6979fab5&is=6978a935&hm=91e3d4d0ed490273106ddf8b3d55562f4e450074f3afa51e28a61b18d1fe4f05');

        const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

        if (accounts.length > 0) {
            const select = new StringSelectMenuBuilder()
                .setCustomId('select_manage_account')
                .setPlaceholder('Select an account to manage');

            accounts.slice(0, 25).forEach(acc => {
                select.addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(acc.name || 'Unnamed Account')
                        .setValue(acc.id)
                        .setDescription(`ID: ${acc.id.substring(0, 10)}...`)
                );
            });

            components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
        } else {
            embed.setDescription('You have no connected accounts.');
        }

        const buttonRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_back_menu')
                    .setLabel('Back to Menu')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('btn_add_account')
                    .setLabel('Add New Account')
                    .setStyle(ButtonStyle.Primary)
            );

        components.push(buttonRow);

        return { embeds: [embed], components };
    } catch (error) {
        Logger.error('Failed to render account list', error, 'AccountView');
        return {
            content: '❌ Failed to load accounts. Please try again.',
            embeds: [],
            components: []
        };
    }
}

export async function renderAccountDetail(accountId: string, status?: { isValid: boolean, username?: string }) {
    try {
        const account = await AccountService.getById(accountId);

        if (!account) {
            return {
                content: 'Account not found.',
                embeds: [],
                components: []
            };
        }

        // Determine status display with emoji
        let statusDisplay = '<a:arrow:1306059259615903826> Status : **Unknown** *(Click Check Status)*';
        let statusColor = 0x5865F2;

        if (status) {
            if (status.isValid) {
                statusDisplay = `<a:Tick_green:1306061558303952937> Status : **Valid** *(Logged in as ${status.username})*`;
                statusColor = 0x57F287;
            } else {
                statusDisplay = `<a:alert:1306298772124336178> Status : **Invalid** *(Token expired or flagged)*`;
                statusColor = 0xED4245;
            }
        }

        const embed = new EmbedBuilder()
            .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **MANAGE ACCOUNT** <a:GREEN_CROWN:1306056562435035190>
\u200b
**ACCOUNT INFO**
<a:arrow:1306059259615903826> Name : **${account.name}**
<a:arrow:1306059259615903826> ID : \`${account.id}\`
<a:arrow:1306059259615903826> Added : <t:${Math.floor(account.createdAt.getTime() / 1000)}:R>
\u200b
**TOKEN STATUS**
${statusDisplay}
`)
            .setColor(statusColor)
            .setThumbnail(account.avatar ? `https://cdn.discordapp.com/avatars/${account.id}/${account.avatar}.png` : null)
            .setFooter({ text: 'AutoPost | Powered by Frey' })
            .setTimestamp()
            .setImage('https://cdn.discordapp.com/attachments/1420156741059874818/1453538221584551936/standard_1.gif?ex=6979fab5&is=6978a935&hm=91e3d4d0ed490273106ddf8b3d55562f4e450074f3afa51e28a61b18d1fe4f05');

        // Build buttons dynamically
        const buttons: ButtonBuilder[] = [
            new ButtonBuilder()
                .setCustomId('btn_account_back')
                .setLabel('Back to List')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`btn_check_account_${account.id}`)
                .setLabel('Check Status')
                .setStyle(ButtonStyle.Primary)
        ];

        // CONDITIONAL: Only show Update Token when token is invalid
        if (status && !status.isValid) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`btn_update_token_${account.id}`)
                    .setLabel('Update Token')
                    .setStyle(ButtonStyle.Success)
            );
        }

        // Delete always last
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`btn_delete_account_${account.id}`)
                .setLabel('Delete Account')
                .setStyle(ButtonStyle.Danger)
        );

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

        return { embeds: [embed], components: [row] };
    } catch (error) {
        Logger.error('Failed to render account detail', error, 'AccountView');
        return {
            content: '❌ Failed to load account details. Please try again.',
            embeds: [],
            components: []
        };
    }
}
