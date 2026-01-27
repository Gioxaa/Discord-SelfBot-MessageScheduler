import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { PRODUCTS } from '../config';

export function renderStore() {
    const embed = new EmbedBuilder()
        .setTitle('<a:GREEN_CROWN:1306056562435035190>  **AUTO POST**  <a:GREEN_CROWN:1306056562435035190>')
        .setDescription(`
\u200b
**FEATURES**
<a:arrow:1306059259615903826> **Full Auto-Post System** (Message Scheduler)
<a:arrow:1306059259615903826> **Auto Fetch System** (Fetch Server & Channel)
<a:arrow:1306059259615903826> **Dynamic Cooldown Detection** (Auto Detect Cooldown)
<a:arrow:1306059259615903826> **Multi-Account Support** (Independent Workers)
<a:arrow:1306059259615903826> **24/7 Cloud Stability** (No PC needed)

**PRICING PLANS**
${Object.values(PRODUCTS).map(p => `<a:arrow:1306059259615903826> **${p.name}** : Rp ${p.price.toLocaleString('id-ID')} / ${p.durationDays} Days`).join('\n')}
`)
        .setColor('Purple') // Discord Green
        .setFooter({ text: 'AutoPost | Powered by Frey' })
        .setTimestamp()
        .setImage('https://cdn.discordapp.com/attachments/1420156741059874818/1453538221584551936/standard_1.gif?ex=6979fab5&is=6978a935&hm=91e3d4d0ed490273106ddf8b3d55562f4e450074f3afa51e28a61b18d1fe4f05&');

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_buy_7_DAYS')
                .setLabel('Weekly Pass')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_buy_30_DAYS')
                .setLabel('Monthly Pass')
                .setStyle(ButtonStyle.Secondary)
        );

    return { content: null, embeds: [embed], components: [row] };
}
