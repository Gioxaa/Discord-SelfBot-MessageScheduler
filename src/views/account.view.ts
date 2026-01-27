import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuOptionBuilder } from 'discord.js';
import prisma from '../database/client';

export async function renderAccountList(userId: string) {
    const accounts = await prisma.account.findMany({ where: { userId } });

    const embed = new EmbedBuilder()
        .setDescription(`
## <a:GREEN_CROWN:1306056562435035190> **ACCOUNT MANAGER** <a:GREEN_CROWN:1306056562435035190>
\u200b
**OVERVIEW**
> <a:arrow:1306059259615903826> Connected Accounts : **${accounts.length}**
\u200b
**YOUR ACCOUNTS**
${accounts.length > 0 ? accounts.map(acc => `<a:arrow:1306059259615903826> **${acc.name || 'Unnamed'}** \n   ID: \`${acc.id.substring(0, 18)}...\``).join('\n') : '> *No accounts connected yet.*'}
`)
        .setColor(0x57F287)
        .setFooter({ text: 'AutoPost | Powered by Frey' })
        .setTimestamp()
        .setImage('https://cdn.discordapp.com/attachments/1420156741059874818/1453538221584551936/standard_1.gif?ex=6979fab5&is=6978a935&hm=91e3d4d0ed490273106ddf8b3d55562f4e450074f3afa51e28a61b18d1fe4f05&');

    const components: any[] = [];

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
                .setCustomId('btn_back_menu') // Goes back to Main Control Panel
                .setLabel('Back to Menu')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_add_account')
                .setLabel('Add New Account')
                .setStyle(ButtonStyle.Primary)
        );

    components.push(buttonRow);

    return { embeds: [embed], components };
}

export async function renderAccountDetail(accountId: string, status?: { isValid: boolean, username?: string }) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
        return {
            content: 'Account not found.',
            embeds: [],
            components: []
        };
    }

    const embed = new EmbedBuilder()
        .setTitle(`Manage Account: ${account.name}`)
        .setColor(0x5865F2)
        .setThumbnail(account.avatar ? `https://cdn.discordapp.com/avatars/${account.id}/${account.avatar}.png` : null)
        .addFields(
            { name: 'Account ID', value: `\`${account.id}\``, inline: true },
            { name: 'Added On', value: `<t:${Math.floor(account.createdAt.getTime() / 1000)}:R>`, inline: true }
        );

    if (status) {
        embed.addFields({
            name: 'Token Status',
            value: status.isValid
                ? `[Valid] Logged in as ${status.username}`
                : `[Invalid] Token expired or flagged`,
            inline: false
        });
        embed.setColor(status.isValid ? 0x57F287 : 0xED4245);
    } else {
        embed.addFields({ name: 'Token Status', value: '[Unknown] Click Check Status', inline: false });
    }

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_account_back')
                .setLabel('Back to List')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`btn_check_account_${account.id}`)
                .setLabel('Check Status')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`btn_delete_account_${account.id}`)
                .setLabel('Delete Account')
                .setStyle(ButtonStyle.Danger)
        );

    return { embeds: [embed], components: [row] };
}